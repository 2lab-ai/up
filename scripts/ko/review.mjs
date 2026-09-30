// Step 5: cross-model review (reviewer ≠ translator). MUST issues → translator revises → gates → anchors → re-review once.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createMessage, setLogFile } from "./lib/llm.mjs";
import { checkFile, normalizeOutput } from "./lib/gates.mjs";
import { relevantRows, renderRows } from "./lib/glossary.mjs";
import { runAnchors } from "./anchors.mjs";
import { loadGlossary, translateCall } from "./translate.mjs";
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
  REVIEWER,
  ROOT,
  sha256,
  TRANSLATOR,
  WORK,
  writeJson,
} from "./config.mjs";

export const REVIEW_REPORT_PATH = join(KO_DIR, "review-report.json");
const STATE_PATH = join(WORK, "state", "review.json");
const REVIEWER_PROMPT = readText(join(KO_DIR, "prompts", "reviewer.md"));
const STYLE = readText(join(KO_DIR, "prompts", "style-guide.md"));
const SEVERITIES = new Set(["MUST", "SHOULD"]);
const TYPES = new Set(["omission", "addition", "mistranslation", "untranslated", "glossary", "tone", "format"]);

if (REVIEWER.model === TRANSLATOR.model) throw new Error("reviewer model must differ from translator model");

export const ISSUE_SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["MUST", "SHOULD"] },
          type: { type: "string", enum: [...TYPES] },
          source_excerpt: { type: "string" },
          ko_excerpt: { type: "string" },
          suggested_fix: { type: "string" },
        },
        required: ["severity", "type", "source_excerpt", "ko_excerpt", "suggested_fix"],
        additionalProperties: false,
      },
    },
  },
  required: ["issues"],
  additionalProperties: false,
};

export function parseIssues(text) {
  let raw;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    const start = text.search(/[[{]/);
    const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
    if (start < 0 || end < start) throw new Error(`reviewer output has no JSON: ${text.slice(0, 200)}`);
    raw = JSON.parse(text.slice(start, end + 1));
  }
  if (raw && !Array.isArray(raw) && Array.isArray(raw.issues)) raw = raw.issues;
  if (!Array.isArray(raw)) throw new Error("reviewer JSON has no issues array");
  return raw
    .filter((i) => i && typeof i === "object")
    .map((i) => ({
      severity: SEVERITIES.has(String(i.severity).toUpperCase()) ? String(i.severity).toUpperCase() : "SHOULD",
      type: TYPES.has(i.type) ? i.type : "tone",
      source_excerpt: String(i.source_excerpt ?? ""),
      ko_excerpt: String(i.ko_excerpt ?? ""),
      suggested_fix: String(i.suggested_fix ?? ""),
    }));
}

export async function reviewCall({ path, source, translation, glossaryTable, round }) {
  const system = `${REVIEWER_PROMPT}\n\n<style_guide>\n${STYLE}\n</style_guide>\n\n<glossary>\n${glossaryTable}\n</glossary>`;
  const user = `<source path="${path}">\n${source}\n</source>\n\n<translation path="${path}">\n${translation}\n</translation>\n\n두 파일을 끝까지 대조하고 {"issues": [...]} JSON만 출력하라.`;
  const key = sha256([PROMPT_VERSION, REVIEWER.model, REVIEWER.effort, system, user].join("\u0000"));
  const file = cachePath("review", key);
  const cached = readJson(file, null);
  if (cached) return { ...cached, cached: true };
  let lastError;
  for (let parseAttempt = 1; parseAttempt <= 2; parseAttempt += 1) {
    const result = await createMessage(
      {
        model: REVIEWER.model,
        max_tokens: REVIEWER.max_tokens,
        output_config: { effort: REVIEWER.effort, format: { type: "json_schema", schema: ISSUE_SCHEMA } },
        fallbacks: REVIEWER.fallbacks,
        system: [{ type: "text", text: system }],
        messages: [{ role: "user", content: user }],
      },
      { label: `review-r${round}:${path}`, headers: { "anthropic-beta": REVIEWER.beta } },
    );
    if (result.stopReason === "refusal") throw new Error(`${path}: reviewer refusal ${JSON.stringify(result.stopDetails || {})}`);
    try {
      const issues = parseIssues(result.text);
      const record = { key, path, round, model: result.model, usage: result.usage, issues };
      writeJson(file, record);
      return record;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export const counts = (issues) => ({
  MUST: issues.filter((i) => i.severity === "MUST").length,
  SHOULD: issues.filter((i) => i.severity === "SHOULD").length,
});

async function fixFile({ path, source, zhSource, english, glossaryTable, translation, issues }) {
  // Revision by the translator model with the reviewer's issue list, then the same gate/retry loop as step 3.
  let previous = translation;
  let reviewIssues = issues;
  let defects = null;
  const attempts = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const call = await translateCall({
      path,
      source,
      zhSource,
      english,
      glossaryTable,
      previous,
      defects,
      reviewIssues,
      stage: attempt === 1 ? "review-fix" : "review-fix-retry",
    });
    const { text } = normalizeOutput(source, call.text);
    const gate = checkFile({ source, output: text, zhSource });
    attempts.push({ text, gate, model: call.model });
    if (!gate.defects.length) break;
    previous = text;
    defects = gate.defects;
    reviewIssues = null;
  }
  const best = attempts.reduce((a, b) => (b.gate.defects.length <= a.gate.defects.length ? b : a));
  const beforeGate = checkFile({ source, output: translation, zhSource });
  // Never trade a gate-clean file for one that fails the gates.
  if (best.gate.defects.length > beforeGate.defects.length) return { applied: false, defects: best.gate.defects, model: best.model };
  writeFileSync(join(ROOT, path), best.text);
  return { applied: true, defects: best.gate.defects, model: best.model, attempts: attempts.length };
}

export async function runReview({ only = null } = {}) {
  setLogFile(join(WORK, "logs", "llm.jsonl"));
  const glossary = loadGlossary();
  const files = ownedFiles().filter((p) => !only || only.includes(p));
  const state = readJson(STATE_PATH, { files: {} });
  const ctx = new Map();
  for (const path of files) {
    const source = readSource(path);
    const zhSource = isChineseSource(source);
    ctx.set(path, { path, source, zhSource, english: zhSource ? readEnglishReference(path) : null, glossaryTable: renderRows(relevantRows(glossary.rows, source, { zhSource })) });
  }
  const sizes = new Map(files.map((p) => [p, ctx.get(p).source.length]));
  files.sort((a, b) => sizes.get(b) - sizes.get(a));
  let done = 0;
  const report = { files: {} };

  // Round 1: review everything; files with MUST issues get one translator revision.
  const toRereview = [];
  await Promise.all(
    files.map(async (path) => {
      const c = ctx.get(path);
      try {
        const translation = readFileSync(join(ROOT, path), "utf8");
        const r1 = await reviewCall({ ...c, translation, round: 1 });
        const entry = { reviewer_served_by: r1.model, before: counts(r1.issues), issues_before: r1.issues, fixed: false, after: null };
        if (entry.before.MUST) {
          const fix = await fixFile({ ...c, translation, issues: r1.issues });
          entry.fixed = fix.applied;
          entry.fix_model = fix.model;
          entry.fix_gate_defects = fix.defects;
          if (fix.applied) toRereview.push(path);
        }
        report.files[path] = entry;
        state.files[path] = { r1: { model: r1.model, ...entry.before }, at: new Date().toISOString() };
        done += 1;
        console.log(`[r1 ${done}/${files.length}] ${path} MUST=${entry.before.MUST} SHOULD=${entry.before.SHOULD}${entry.before.MUST ? (entry.fixed ? " → revised" : " → revision rejected") : ""} (${r1.model}${r1.cached ? ", cached" : ""})`);
      } catch (error) {
        done += 1;
        report.files[path] = { error: String(error.message) };
        console.log(`[r1 ${done}/${files.length}] ERROR ${path}: ${error.message.slice(0, 300)}`);
      }
      writeJson(STATE_PATH, state);
    }),
  );

  // Gates 3–4 again after revisions: anchors are recomputed from the new headings.
  const anchors = runAnchors({ write: true });
  console.log(`anchors after revision: rewrites=${anchors.rewrites.length} unresolved=${anchors.unresolved.length} misaligned=${anchors.misaligned.length}`);

  // Round 2: re-review revised files once.
  done = 0;
  await Promise.all(
    toRereview.map(async (path) => {
      const c = ctx.get(path);
      try {
        const translation = readFileSync(join(ROOT, path), "utf8");
        const r2 = await reviewCall({ ...c, translation, round: 2 });
        report.files[path].after = counts(r2.issues);
        report.files[path].issues_after = r2.issues;
        report.files[path].reviewer_served_by_after = r2.model;
        done += 1;
        console.log(`[r2 ${done}/${toRereview.length}] ${path} MUST=${report.files[path].after.MUST} SHOULD=${report.files[path].after.SHOULD}`);
      } catch (error) {
        done += 1;
        report.files[path].after_error = String(error.message);
        console.log(`[r2 ${done}/${toRereview.length}] ERROR ${path}: ${error.message.slice(0, 300)}`);
      }
    }),
  );

  const entries = Object.values(report.files).filter((e) => !e.error);
  const sum = (pick) => entries.reduce((n, e) => n + pick(e), 0);
  const summary = {
    translator: TRANSLATOR.model,
    reviewer: REVIEWER.model,
    reviewer_served_by: [...new Set(entries.flatMap((e) => [e.reviewer_served_by, e.reviewer_served_by_after].filter(Boolean)))],
    files_reviewed: entries.length,
    files_with_must_before: entries.filter((e) => e.before.MUST).length,
    must_before: sum((e) => e.before.MUST),
    should_before: sum((e) => e.before.SHOULD),
    files_revised: entries.filter((e) => e.fixed).length,
    must_after: sum((e) => (e.after ? e.after.MUST : e.before.MUST)),
    should_after: sum((e) => (e.after ? e.after.SHOULD : e.before.SHOULD)),
    files_with_must_after: entries.filter((e) => (e.after ? e.after.MUST : e.before.MUST)).map((e) => Object.keys(report.files).find((k) => report.files[k] === e)),
    errors: Object.entries(report.files).filter(([, e]) => e.error).map(([k, e]) => ({ file: k, error: e.error })),
  };
  writeJson(REVIEW_REPORT_PATH, { summary, files: report.files });
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const onlyIndex = process.argv.indexOf("--only");
  const summary = await runReview({ only: onlyIndex > -1 ? process.argv.slice(onlyIndex + 1) : null });
  console.log(JSON.stringify(summary, null, 2));
}
