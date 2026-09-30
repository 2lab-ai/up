// Shared settings and repo helpers for the Korean translation pipeline.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const KO_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(KO_DIR, "../..");
export const WORK = process.env.KO_WORK_DIR || join(ROOT, ".ko-work");

export const UPSTREAM = { repo: "https://github.com/byoungd/up", commit: "7478ac2" };
// Source text always comes from the upstream commit (the working tree holds the Korean output).
export const SOURCE_REF = process.env.KO_SOURCE_REF || UPSTREAM.commit;

export const TRANSLATOR = { model: "claude-opus-5-5", effort: "high", max_tokens: 128000 };
export const REVIEWER = {
  model: "claude-fable-5-1",
  effort: "high",
  max_tokens: 64000,
  // Refusal fallback (server-side, array form) to a model that is still not the translator.
  fallbacks: [{ model: "claude-opus-4-8" }],
  beta: "server-side-fallback-2026-06-01",
};
export const PROMPT_VERSION = "ko-v1";

// Root-level files translated in place (SUMMARY.md files are generated from navigation.mjs — not ours).
export const ROOT_FILES = [
  "README.md",
  "MAINTENANCE.md",
  "ISSUE_TRIAGE.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "SUPPORT.md",
  "ATTRIBUTIONS.md",
  "LICENSE.md",
  "LICENSE-CONTENT.md",
  "legacy/docsify-snapshot.md",
  "book-assets/fonts/README.md",
];
export const EXCLUDED = new Set(["docs/SUMMARY.md", "SUMMARY.md", "LICENSE-CODE.md"]);

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export function git(args) {
  return execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

// Owned file list at the source ref: docs/**/*.md except docs/en/** and SUMMARY, plus ROOT_FILES.
export function ownedFiles(ref = SOURCE_REF) {
  const docs = git(["ls-tree", "-r", "--name-only", ref, "--", "docs"])
    .split("\n")
    .filter((p) => p.endsWith(".md") && !p.startsWith("docs/en/") && !p.includes("/node_modules/") && !EXCLUDED.has(p))
    .sort();
  return [...docs, ...ROOT_FILES];
}

export function readSource(path, ref = SOURCE_REF) {
  return git(["show", `${ref}:${path}`]);
}

export function readEnglishReference(path, ref = SOURCE_REF) {
  if (!path.startsWith("docs/")) return null;
  const enPath = `docs/en/${path.slice("docs/".length)}`;
  try {
    return { path: enPath, text: git(["show", `${ref}:${enPath}`]) };
  } catch {
    return null;
  }
}

export const isChineseSource = (text) => (text.match(/\p{Script=Han}/gu) || []).length >= 20;

// Tracked pipeline files (glossary, prompts, reports) keep Han ideographs only as escapes, so the Korean
// repository carries no Chinese text. Every reader decodes them: prompts, glossary rows, hashes, and cache
// keys are identical to the unescaped originals. Markdown uses \u{hex}; JSON uses standard \uXXXX escapes.
const HAN = /\p{Script=Han}/u;
const HAN_ESCAPE = /\\u\{([0-9a-fA-F]{4,5})\}/g;

export function decodeHan(text) {
  return text.replace(HAN_ESCAPE, (match, hex) => {
    const character = String.fromCodePoint(Number.parseInt(hex, 16));
    return HAN.test(character) ? character : match;
  });
}

export function encodeHan(text) {
  return text.replace(/\p{Script=Han}/gu, (character) => `\\u{${character.codePointAt(0).toString(16)}}`);
}

export function readText(path) {
  return decodeHan(readFileSync(path, "utf8"));
}

export function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodeHan(text));
}

const escapeHanInJson = (json) =>
  json.replace(/\p{Script=Han}/gu, (character) =>
    Array.from(character, (_, index) => `\\u${character.charCodeAt(index).toString(16).padStart(4, "0")}`).join(""),
  );

export function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${escapeHanInJson(JSON.stringify(value, null, 2))}\n`);
}

export function cachePath(stage, key) {
  return join(WORK, "cache", stage, `${key}.json`);
}
