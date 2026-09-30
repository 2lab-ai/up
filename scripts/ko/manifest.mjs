// Step 6: scripts/ko/manifest.json — upstream commit + per-file source/output hashes, so a later upstream
// sync re-translates only files whose source changed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isChineseSource, KO_DIR, ownedFiles, PROMPT_VERSION, readJson, readSource, readText, REVIEWER, ROOT, sha256, TRANSLATOR, UPSTREAM, WORK, writeJson } from "./config.mjs";

export const MANIFEST_PATH = join(KO_DIR, "manifest.json");

export function promptHash() {
  const files = ["translator.md", "style-guide.md", "reviewer.md", "polish.md", "audit.md", "glossary.md", "glossary-supplement.md"].map((f) =>
    readText(join(KO_DIR, "prompts", f)),
  );
  return sha256(files.join("\u0000"));
}

export function runManifest() {
  const translateState = readJson(join(WORK, "state", "translate.json"), { files: {} });
  const review = readJson(join(KO_DIR, "review-report.json"), { files: {} });
  // Hand adjudication after the automatic passes (recorded in review-report.json summary.adjudication).
  const adjudication = review.summary?.adjudication ?? {};
  const reaudited = new Map((adjudication.verification_audit ?? []).map((v) => [v.file, v.findings]));
  const handFixed = new Set((adjudication.fixed_by_hand ?? []).map((f) => f.file));
  const files = {};
  for (const path of ownedFiles()) {
    const source = readSource(path);
    const output = readFileSync(join(ROOT, path), "utf8");
    const t = translateState.files[path] || {};
    const r = review.files?.[path] || {};
    files[path] = {
      source_lang: isChineseSource(source) ? "zh-CN" : "en",
      source_sha256: sha256(source),
      output_sha256: sha256(output),
      english_reference: path.startsWith("docs/") ? `docs/en/${path.slice(5)}` : null,
      translate_attempts: t.attempts ?? null,
      gate_defects: t.defects?.length ?? null,
      review_must_before: r.before?.MUST ?? null,
      review_must_after: r.after ? r.after.MUST : (r.before?.MUST ?? null),
      revised_after_review: Boolean(r.fixed),
      audit_findings_before: r.audit?.before ?? null,
      audit_findings_after: reaudited.has(path) ? reaudited.get(path) : r.audit ? (r.audit.after ?? r.audit.before ?? null) : null,
      hand_fixed: handFixed.has(path),
    };
  }
  const manifest = {
    upstream: { repo: UPSTREAM.repo, commit: UPSTREAM.commit, content_license: "CC BY-NC 4.0", code_license: "MIT" },
    generated_at: new Date().toISOString(),
    prompt_version: PROMPT_VERSION,
    prompt_sha256: promptHash(),
    glossary_sha256: sha256(readText(join(KO_DIR, "glossary.md"))),
    models: {
      translator: { model: TRANSLATOR.model, effort: TRANSLATOR.effort, max_tokens: TRANSLATOR.max_tokens },
      reviewer: { model: REVIEWER.model, effort: REVIEWER.effort, fallbacks: REVIEWER.fallbacks },
    },
    untouched: ["LICENSE-CODE.md", "SUMMARY.md", "docs/SUMMARY.md", "docs/en/**"],
    file_count: Object.keys(files).length,
    files,
  };
  writeJson(MANIFEST_PATH, manifest);
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const m = runManifest();
  console.log(`manifest: ${m.file_count} files, upstream ${m.upstream.commit}`);
}
