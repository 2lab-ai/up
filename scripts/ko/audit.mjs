// Step 5c: meaning-only audit. The reviewer model (≠ translator) re-reads every file sentence by sentence
// looking only for meaning changes the first review may have missed. Findings → translator patch
// (exact find/replace) → gates → anchors → one re-audit of patched files; a patch that raises the
// finding count or fails the gates is reverted. Results merge into scripts/ko/review-report.json (`audit`).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createMessage, setLogFile } from "./lib/llm.mjs";
import { checkFile } from "./lib/gates.mjs";
import { relevantRows, renderRows } from "./lib/glossary.mjs";
import { runAnchors } from "./anchors.mjs";
import { loadGlossary } from "./translate.mjs";
import { ISSUE_SCHEMA, REVIEW_REPORT_PATH, parseIssues } from "./review.mjs";
import { applyEdits, patchCall } from "./polish.mjs";
import { cachePath, isChineseSource, KO_DIR, ownedFiles, PROMPT_VERSION, readJson, readSource, readText, REVIEWER, ROOT, sha256, WORK, writeJson } from "./config.mjs";

const AUDIT_PROMPT = readText(join(KO_DIR, "prompts", "audit.md"));
const STYLE = readText(join(KO_DIR, "prompts", "style-guide.md"));
const MEANING = new Set(["omission", "addition", "mistranslation", "untranslated", "glossary"]);

export async function auditCall({ path, source, translation, glossaryTable, round }) {
  const system = `${AUDIT_PROMPT}\n\n<style_guide>\n${STYLE}\n</style_guide>\n\n<glossary>\n${glossaryTable}\n</glossary>`;
  const user = `<source path="${path}">\n${source}\n</source>\n\n<translation path="${path}">\n${translation}\n</translation>\n\n문장 단위로 끝까지 대조하고 {"issues": [...]} JSON만 출력하라.`;
  const key = sha256([PROMPT_VERSION, REVIEWER.model, REVIEWER.effort, "audit", system, user].join("\u0000"));
  const file = cachePath("audit", key);
  const cached = readJson(file, null);
  if (cached) return cached;
  const result = await createMessage(
    {
      model: REVIEWER.model,
      max_tokens: REVIEWER.max_tokens,
      output_config: { effort: REVIEWER.effort, format: { type: "json_schema", schema: ISSUE_SCHEMA } },
      fallbacks: REVIEWER.fallbacks,
      system: [{ type: "text", text: system }],
      messages: [{ role: "user", content: user }],
    },
    { label: `audit-r${round}:${path}`, headers: { "anthropic-beta": REVIEWER.beta } },
  );
  if (result.stopReason === "refusal") throw new Error(`${path}: audit refusal ${JSON.stringify(result.stopDetails || {})}`);
  const issues = parseIssues(result.text).filter((i) => MEANING.has(i.type));
  const record = { key, path, round, model: result.model, usage: result.usage, issues };
  writeJson(file, record);
  return record;
}

export async function runAudit({ only = null } = {}) {
  setLogFile(join(WORK, "logs", "llm.jsonl"));
  const report = readJson(REVIEW_REPORT_PATH, { summary: {}, files: {} });
  const glossary = loadGlossary();
  const files = ownedFiles().filter((p) => !only || only.includes(p));
  const ctx = new Map();
  for (const path of files) {
    const source = readSource(path);
    const zhSource = isChineseSource(source);
    ctx.set(path, { source, zhSource, glossaryTable: renderRows(relevantRows(glossary.rows, source, { zhSource })) });
  }
  files.sort((a, b) => ctx.get(b).source.length - ctx.get(a).source.length);
  const patched = [];
  let done = 0;
  await Promise.all(
    files.map(async (path) => {
      const c = ctx.get(path);
      const entry = (report.files[path] ??= {});
      try {
        const translation = readFileSync(join(ROOT, path), "utf8");
        const a1 = await auditCall({ path, ...c, translation, round: 1 });
        entry.audit = { model: a1.model, before: a1.issues.length, issues_before: a1.issues };
        if (a1.issues.length) {
          const patch = await patchCall({ path, source: c.source, translation, glossaryTable: c.glossaryTable, issues: a1.issues, stage: "audit-fix" });
          const { text, applied, skipped } = applyEdits(translation, patch.edits);
          const gateBefore = checkFile({ source: c.source, output: translation, zhSource: c.zhSource });
          const gateAfter = checkFile({ source: c.source, output: text, zhSource: c.zhSource });
          Object.assign(entry.audit, { fix_model: patch.model, edits_proposed: patch.edits.length, edits_applied: applied.length, edits_skipped: skipped.length, skipped });
          if (gateAfter.defects.length > gateBefore.defects.length) entry.audit.rejected = gateAfter.defects.join(" | ").slice(0, 300);
          else if (applied.length) {
            writeFileSync(join(ROOT, path), text);
            c.previous = translation;
            patched.push(path);
          }
        }
        done += 1;
        console.log(`[audit ${done}/${files.length}] ${path} findings=${a1.issues.length}${entry.audit.edits_applied !== undefined ? ` applied=${entry.audit.edits_applied}/${entry.audit.edits_proposed}` : ""}${entry.audit.rejected ? " REJECTED" : ""}`);
      } catch (error) {
        done += 1;
        entry.audit = { error: String(error.message) };
        console.log(`[audit ${done}/${files.length}] ERROR ${path}: ${error.message.slice(0, 300)}`);
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
        const a2 = await auditCall({ path, ...c, translation, round: 2 });
        if (a2.issues.length > entry.audit.before) {
          writeFileSync(join(ROOT, path), c.previous);
          entry.audit.reverted = `re-audit findings ${a2.issues.length} > ${entry.audit.before}`;
          reverted.push(path);
        } else {
          entry.audit.after = a2.issues.length;
          entry.audit.issues_after = a2.issues;
        }
        done += 1;
        console.log(`[audit-r2 ${done}/${patched.length}] ${path} findings=${a2.issues.length}${entry.audit.reverted ? " → reverted" : ""}`);
      } catch (error) {
        done += 1;
        entry.audit.after_error = String(error.message);
        console.log(`[audit-r2 ${done}/${patched.length}] ERROR ${path}: ${error.message.slice(0, 300)}`);
      }
    }),
  );
  if (reverted.length) runAnchors({ write: true });
  const audited = Object.values(report.files).filter((e) => e.audit && !e.audit.error);
  report.summary.audit = {
    model: REVIEWER.model,
    files_audited: audited.length,
    files_with_findings: audited.filter((e) => e.audit.before).length,
    findings_before: audited.reduce((n, e) => n + e.audit.before, 0),
    files_patched: patched.length - reverted.length,
    edits_applied: audited.reduce((n, e) => n + (e.audit.reverted ? 0 : e.audit.edits_applied || 0), 0),
    findings_after: audited.reduce((n, e) => n + (e.audit.after ?? e.audit.before), 0),
    reverted,
    errors: Object.entries(report.files).filter(([, e]) => e.audit?.error).map(([k, e]) => ({ file: k, error: e.audit.error })),
  };
  writeJson(REVIEW_REPORT_PATH, report);
  return report.summary.audit;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const onlyIndex = process.argv.indexOf("--only");
  console.log(JSON.stringify(await runAudit({ only: onlyIndex > -1 ? process.argv.slice(onlyIndex + 1) : null }), null, 2));
}
