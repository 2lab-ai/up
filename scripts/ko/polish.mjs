// Step 5b: SHOULD-only polish. Files whose round-1 review had SHOULD issues but no MUST issue get a
// patch-mode revision by the translator model (exact find/replace edits, applied only when each `find`
// occurs exactly once), then gates → anchors → one re-review. A patch that raises the MUST count or
// fails the gates is reverted. Results are merged into scripts/ko/review-report.json.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createMessage, setLogFile } from "./lib/llm.mjs";
import { checkFile } from "./lib/gates.mjs";
import { relevantRows, renderRows } from "./lib/glossary.mjs";
import { runAnchors } from "./anchors.mjs";
import { loadGlossary } from "./translate.mjs";
import { REVIEW_REPORT_PATH, counts, reviewCall } from "./review.mjs";
import { cachePath, isChineseSource, KO_DIR, PROMPT_VERSION, readJson, readSource, readText, ROOT, sha256, TRANSLATOR, WORK, writeJson } from "./config.mjs";

const POLISH_PROMPT = readText(join(KO_DIR, "prompts", "polish.md"));
const STYLE = readText(join(KO_DIR, "prompts", "style-guide.md"));
const EDIT_SCHEMA = {
  type: "object",
  properties: {
    edits: {
      type: "array",
      items: {
        type: "object",
        properties: { issue: { type: "integer" }, find: { type: "string" }, replace: { type: "string" } },
        required: ["issue", "find", "replace"],
        additionalProperties: false,
      },
    },
  },
  required: ["edits"],
  additionalProperties: false,
};

export async function patchCall({ path, source, translation, glossaryTable, issues, stage = "polish" }) {
  const system = `${POLISH_PROMPT}\n\n<style_guide>\n${STYLE}\n</style_guide>\n\n<glossary>\n${glossaryTable}\n</glossary>`;
  const numbered = issues.map((issue, index) => ({ index, ...issue }));
  const user = `<source path="${path}">\n${source}\n</source>\n\n<translation path="${path}">\n${translation}\n</translation>\n\n<review_issues>\n${JSON.stringify(numbered, null, 1)}\n</review_issues>`;
  const key = sha256([PROMPT_VERSION, TRANSLATOR.model, stage, system, user].join("\u0000"));
  const file = cachePath(stage, key);
  const cached = readJson(file, null);
  if (cached) return cached;
  const result = await createMessage(
    {
      model: TRANSLATOR.model,
      max_tokens: 64000,
      output_config: { effort: TRANSLATOR.effort, format: { type: "json_schema", schema: EDIT_SCHEMA } },
      system: [{ type: "text", text: system }],
      messages: [{ role: "user", content: user }],
    },
    { label: `${stage}:${path}` },
  );
  if (result.stopReason !== "end_turn") throw new Error(`${path}: polish stop_reason=${result.stopReason}`);
  const record = { key, path, model: result.model, usage: result.usage, edits: JSON.parse(result.text).edits };
  writeJson(file, record);
  return record;
}

export function applyEdits(text, edits) {
  let out = text;
  const applied = [];
  const skipped = [];
  for (const edit of edits) {
    if (!edit.find || edit.find === edit.replace) {
      skipped.push({ ...edit, reason: "empty or no-op" });
      continue;
    }
    const first = out.indexOf(edit.find);
    if (first < 0 || out.indexOf(edit.find, first + 1) >= 0) {
      skipped.push({ ...edit, reason: first < 0 ? "find not found" : "find not unique" });
      continue;
    }
    out = out.slice(0, first) + edit.replace + out.slice(first + edit.find.length);
    applied.push(edit);
  }
  return { text: out, applied, skipped };
}

export async function runPolish({ only = null } = {}) {
  setLogFile(join(WORK, "logs", "llm.jsonl"));
  const report = readJson(REVIEW_REPORT_PATH, null);
  if (!report) throw new Error("run review first");
  const glossary = loadGlossary();
  const targets = Object.entries(report.files)
    .filter(([path, e]) => !e.error && !e.fixed && e.before?.SHOULD > 0 && (!only || only.includes(path)))
    .map(([path]) => path);
  const ctx = new Map();
  let done = 0;
  const patched = [];
  await Promise.all(
    targets.map(async (path) => {
      const source = readSource(path);
      const zhSource = isChineseSource(source);
      const glossaryTable = renderRows(relevantRows(glossary.rows, source, { zhSource }));
      const translation = readFileSync(join(ROOT, path), "utf8");
      const entry = report.files[path];
      try {
        const patch = await patchCall({ path, source, translation, glossaryTable, issues: entry.issues_before });
        const { text, applied, skipped } = applyEdits(translation, patch.edits);
        const before = checkFile({ source, output: translation, zhSource });
        const after = checkFile({ source, output: text, zhSource });
        entry.polish = { model: patch.model, edits_proposed: patch.edits.length, edits_applied: applied.length, edits_skipped: skipped.length, skipped };
        if (after.defects.length > before.defects.length) {
          entry.polish.rejected = `gate defects ${after.defects.length}: ${after.defects.join(" | ").slice(0, 300)}`;
        } else if (applied.length) {
          writeFileSync(join(ROOT, path), text);
          ctx.set(path, { source, zhSource, glossaryTable, previous: translation });
          patched.push(path);
        }
        done += 1;
        console.log(`[polish ${done}/${targets.length}] ${path} applied=${applied.length}/${patch.edits.length} skipped=${skipped.length}${entry.polish.rejected ? " REJECTED" : ""}`);
      } catch (error) {
        done += 1;
        entry.polish = { error: String(error.message) };
        console.log(`[polish ${done}/${targets.length}] ERROR ${path}: ${error.message.slice(0, 300)}`);
      }
    }),
  );
  runAnchors({ write: true });
  done = 0;
  const reverted = [];
  await Promise.all(
    patched.map(async (path) => {
      const c = ctx.get(path);
      const entry = report.files[path];
      try {
        const translation = readFileSync(join(ROOT, path), "utf8");
        const r2 = await reviewCall({ path, source: c.source, translation, glossaryTable: c.glossaryTable, round: 2 });
        const after = counts(r2.issues);
        if (after.MUST > entry.before.MUST) {
          writeFileSync(join(ROOT, path), c.previous);
          entry.polish.reverted = `re-review MUST ${after.MUST} > ${entry.before.MUST}`;
          reverted.push(path);
        } else {
          entry.after = after;
          entry.issues_after = r2.issues;
          entry.reviewer_served_by_after = r2.model;
          entry.fixed = true;
          entry.revision_reason = "SHOULD";
        }
        done += 1;
        console.log(`[polish-r2 ${done}/${patched.length}] ${path} MUST=${after.MUST} SHOULD=${after.SHOULD}${entry.polish.reverted ? " → reverted" : ""}`);
      } catch (error) {
        done += 1;
        entry.polish.after_error = String(error.message);
        console.log(`[polish-r2 ${done}/${patched.length}] ERROR ${path}: ${error.message.slice(0, 300)}`);
      }
    }),
  );
  if (reverted.length) runAnchors({ write: true });
  const entries = Object.values(report.files).filter((e) => !e.error);
  const cur = (e) => e.after ?? e.before;
  Object.assign(report.summary, {
    files_revised: entries.filter((e) => e.fixed).length,
    files_polished_should: entries.filter((e) => e.revision_reason === "SHOULD").length,
    polish_reverted: reverted,
    must_after: entries.reduce((n, e) => n + cur(e).MUST, 0),
    should_after: entries.reduce((n, e) => n + cur(e).SHOULD, 0),
    files_with_must_after: Object.entries(report.files).filter(([, e]) => !e.error && cur(e).MUST).map(([k]) => k),
  });
  writeJson(REVIEW_REPORT_PATH, report);
  return report.summary;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const onlyIndex = process.argv.indexOf("--only");
  console.log(JSON.stringify(await runPolish({ only: onlyIndex > -1 ? process.argv.slice(onlyIndex + 1) : null }), null, 2));
}
