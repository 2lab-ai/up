// Steps 2–3: translate every owned file in place, then run the mechanical gates.
// One automatic retry per file with the concrete defect list; resumable via .ko-work/cache/translate.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createMessage, setLogFile } from "./lib/llm.mjs";
import { checkFile, normalizeOutput } from "./lib/gates.mjs";
import { parseGlossary, relevantRows, renderRows } from "./lib/glossary.mjs";
import {
  cachePath,
  isChineseSource,
  KO_DIR,
  ownedFiles,
  PROMPT_VERSION,
  readEnglishReference,
  readJson,
  readSource,
  readText,
  ROOT,
  sha256,
  TRANSLATOR,
  WORK,
  writeJson,
} from "./config.mjs";

export const STATE_PATH = join(WORK, "state", "translate.json");
const STYLE = readText(join(KO_DIR, "prompts", "style-guide.md"));
const TRANSLATOR_PROMPT = readText(join(KO_DIR, "prompts", "translator.md"));

export function translatorSystem(glossaryTable) {
  return `${TRANSLATOR_PROMPT}\n\n<style_guide>\n${STYLE}\n</style_guide>\n\n<glossary>\n${glossaryTable}\n</glossary>`;
}

export function translatorUser({ path, source, zhSource, english, previous, defects, reviewIssues }) {
  const parts = [`<source path="${path}" lang="${zhSource ? "zh-CN" : "en"}">\n${source}\n</source>`];
  if (english) {
    parts.push(
      `<english_reference path="${english.path}" role="REFERENCE ONLY">\n${english.text}\n</english_reference>\n` +
        "english_reference는 뜻을 확인하는 참고용이다. 중국어 원문이 기준이며 구조·내용·분량은 원문을 따른다.",
    );
  }
  if (previous) parts.push(`<previous_translation>\n${previous}\n</previous_translation>`);
  if (defects?.length) {
    parts.push(
      `<defects>\n직전 번역(previous_translation)이 기계 검사에서 아래 결함으로 떨어졌다. 모든 결함을 고치고, 나머지 부분은 직전 번역을 유지하라.\n- ${defects.join("\n- ")}\n</defects>`,
    );
  }
  if (reviewIssues?.length) {
    parts.push(
      `<review_issues>\n다른 모델의 교차 검토가 직전 번역(previous_translation)에서 아래 문제를 찾았다. MUST는 반드시 고치고, SHOULD는 옳다고 판단될 때만 반영하라. 지적되지 않은 부분은 직전 번역을 유지하라.\n${JSON.stringify(reviewIssues, null, 1)}\n</review_issues>`,
    );
  }
  parts.push(
    zhSource
      ? "위 <source> 파일 전체를 한국어로 번역해 완성된 파일 내용만 출력하라."
      : "위 <source>(영어) 파일 전체를 한국어로 번역해 완성된 파일 내용만 출력하라.",
  );
  return parts.join("\n\n");
}

export function loadGlossary() {
  const glossaryPath = join(KO_DIR, "glossary.md");
  return { rows: parseGlossary(glossaryPath), hash: sha256(readText(glossaryPath)) };
}

export async function translateCall({ path, source, zhSource, english, glossaryTable, previous, defects, reviewIssues, stage }) {
  const system = translatorSystem(glossaryTable);
  const user = translatorUser({ path, source, zhSource, english, previous, defects, reviewIssues });
  const key = sha256([PROMPT_VERSION, TRANSLATOR.model, TRANSLATOR.effort, stage, system, user].join("\u0000"));
  const file = cachePath("translate", key);
  const cached = readJson(file, null);
  if (cached) return { ...cached, cached: true };
  const result = await createMessage(
    {
      model: TRANSLATOR.model,
      max_tokens: TRANSLATOR.max_tokens,
      output_config: { effort: TRANSLATOR.effort },
      system: [{ type: "text", text: system }],
      messages: [{ role: "user", content: user }],
    },
    { label: `${stage}:${path}` },
  );
  if (result.stopReason !== "end_turn") throw new Error(`${path}: stop_reason=${result.stopReason} ${JSON.stringify(result.stopDetails || {})}`);
  const record = { key, path, stage, model: result.model, usage: result.usage, text: result.text };
  writeJson(file, record);
  return record;
}

// Translate → gates → (one retry with defects) → write best attempt in place.
export async function translateFile(path, { glossary, onlyIfMissing = false } = {}) {
  const source = readSource(path);
  const zhSource = isChineseSource(source);
  const english = zhSource ? readEnglishReference(path) : null;
  const rows = relevantRows(glossary.rows, source, { zhSource });
  const glossaryTable = renderRows(rows);
  const attempts = [];
  let previous = null;
  let defects = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const stage = attempt === 1 ? "translate" : "translate-retry";
    const call = await translateCall({ path, source, zhSource, english, glossaryTable, previous, defects, stage });
    const { text, quotedValues } = normalizeOutput(source, call.text);
    const gate = checkFile({ source, output: text, zhSource });
    attempts.push({ attempt, text, gate, model: call.model, usage: call.usage, cached: Boolean(call.cached), quotedValues });
    if (!gate.defects.length) break;
    previous = text;
    defects = gate.defects;
  }
  const best = attempts.reduce((a, b) => (b.gate.defects.length <= a.gate.defects.length ? b : a));
  writeFileSync(join(ROOT, path), best.text);
  return {
    path,
    zhSource,
    sourceSha256: sha256(source),
    outputSha256: sha256(best.text),
    glossaryRows: rows.length,
    attempts: attempts.length,
    model: best.model,
    defects: best.gate.defects,
    warnings: best.gate.warnings,
    metrics: best.gate.metrics,
    quotedValues: best.quotedValues,
    usage: attempts.map((a) => ({ attempt: a.attempt, cached: a.cached, ...a.usage })),
  };
}

// A file already translated from the same source, glossary and prompt version is skipped (unless
// force): the working tree may hold later review/polish/audit/hand edits that a cached re-write would undo.
function upToDate(entry, source, glossary) {
  return (
    entry &&
    !entry.error &&
    entry.sourceSha256 === sha256(source) &&
    entry.glossarySha256 === glossary.hash &&
    entry.promptVersion === PROMPT_VERSION &&
    existsSync(join(ROOT, entry.path)) &&
    !/\p{Script=Han}/u.test(readFileSync(join(ROOT, entry.path), "utf8"))
  );
}

export async function runTranslate({ only = null, force = false } = {}) {
  setLogFile(join(WORK, "logs", "llm.jsonl"));
  const glossary = loadGlossary();
  const files = ownedFiles().filter((p) => !only || only.includes(p));
  const sizes = new Map(files.map((p) => [p, readSource(p).length]));
  files.sort((a, b) => sizes.get(b) - sizes.get(a));
  const state = readJson(STATE_PATH, { files: {} });
  let done = 0;
  const started = Date.now();
  await Promise.all(
    files.map(async (path) => {
      if (!force && upToDate(state.files[path], readSource(path), glossary)) {
        done += 1;
        console.log(`[${done}/${files.length}] skip ${path} (up to date; --force to redo)`);
        return;
      }
      try {
        const result = await translateFile(path, { glossary });
        state.files[path] = { ...result, glossarySha256: glossary.hash, promptVersion: PROMPT_VERSION, at: new Date().toISOString() };
        done += 1;
        const flag = result.defects.length ? `FAIL(${result.defects.length})` : "ok";
        console.log(`[${done}/${files.length}] ${flag} ${path} attempts=${result.attempts} ratio=${result.metrics.ratio} ${Math.round((Date.now() - started) / 1000)}s`);
      } catch (error) {
        done += 1;
        state.files[path] = { path, error: String(error.message), at: new Date().toISOString() };
        console.log(`[${done}/${files.length}] ERROR ${path}: ${error.message.slice(0, 300)}`);
      }
      writeJson(STATE_PATH, state);
    }),
  );
  return state;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const onlyIndex = process.argv.indexOf("--only");
  const only = onlyIndex > -1 ? process.argv.slice(onlyIndex + 1) : null;
  const state = await runTranslate({ only, force: process.argv.includes("--force") });
  const values = Object.values(state.files);
  console.log(`translated=${values.filter((v) => !v.error).length} failing=${values.filter((v) => v.defects?.length).length} errors=${values.filter((v) => v.error).length}`);
}
