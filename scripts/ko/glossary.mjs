// Step 1: build scripts/ko/glossary.md (zh | en | ko) with one translator-model call.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createMessage, setLogFile } from "./lib/llm.mjs";
import { analyze, countHan } from "./lib/markdown.mjs";
import {
  cachePath,
  git,
  KO_DIR,
  ownedFiles,
  PROMPT_VERSION,
  readEnglishReference,
  readJson,
  readSource,
  readText,
  sha256,
  SOURCE_REF,
  TRANSLATOR,
  WORK,
  writeJson,
  writeText,
} from "./config.mjs";

export const GLOSSARY_PATH = join(KO_DIR, "glossary.md");

function frontmatterValue(entries, path) {
  return entries.find((e) => e.path === path)?.value ?? "";
}

async function sourceNavigation() {
  const file = join(WORK, "navigation.source.mjs");
  mkdirSync(WORK, { recursive: true });
  writeFileSync(file, git(["show", `${SOURCE_REF}:docs/.vitepress/navigation.mjs`]));
  return import(`${pathToFileURL(file).href}?ref=${SOURCE_REF}`);
}

function bibliographyHeadings() {
  const config = git(["show", `${SOURCE_REF}:docs/.vitepress/config.mts`]);
  const block = config.match(/bibliographyHeadings = new Set\(\[([\s\S]*?)\]\)/);
  return block ? [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((t) => countHan(t)) : [];
}

export async function buildGlossaryInput() {
  const { zhNavigation, enNavigation } = await sourceNavigation();
  const navRows = [];
  zhNavigation.forEach((group, gi) => {
    navRows.push(`| group | ${group.text} | ${enNavigation[gi]?.text ?? ""} |`);
    group.items.forEach((item, ii) => navRows.push(`| item | ${item.text} | ${enNavigation[gi]?.items[ii]?.text ?? ""} |`));
  });

  const titleRows = [];
  const headingFiles = new Map();
  for (const path of ownedFiles().filter((p) => p.startsWith("docs/"))) {
    const zh = analyze(readSource(path));
    const enRef = readEnglishReference(path);
    const en = enRef ? analyze(enRef.text) : null;
    const fields = ["title", "prev.text", "next.text"];
    for (const field of fields) {
      const value = frontmatterValue(zh.frontmatter.entries, field);
      if (value) titleRows.push(`| ${path} | ${field} | ${value} | ${en ? frontmatterValue(en.frontmatter.entries, field) : ""} |`);
    }
    const h1 = zh.headings.find((h) => h.level === 1);
    if (h1) titleRows.push(`| ${path} | H1 | ${h1.text} | ${en?.headings.find((h) => h.level === 1)?.text ?? ""} |`);
    zh.headings.forEach((h, i) => {
      if (h.level === 1) return;
      const enText = en && en.headings.length === zh.headings.length ? en.headings[i].text : "";
      if (!headingFiles.has(h.text)) headingFiles.set(h.text, { files: new Set(), en: enText });
      headingFiles.get(h.text).files.add(path);
    });
  }
  const recurring = [...headingFiles.entries()]
    .filter(([, v]) => v.files.size > 1)
    .sort((a, b) => b[1].files.size - a[1].files.size)
    .map(([zh, v]) => `| ${zh} | ${v.en} | ${v.files.size} |`);
  const biblio = bibliographyHeadings().map((zh) => `| ${zh} | ${headingFiles.get(zh)?.en ?? ""} | search-excluded |`);

  const doc = (path, text) => `<document path="${path}">\n${text}\n</document>`;
  return [
    "아래 입력으로 용어집을 만들어라.",
    "## 사이드바 내비게이션 (kind | zh | en)",
    `| kind | zh | en |\n|---|---|---|\n${navRows.join("\n")}`,
    "## 모든 페이지의 제목 필드 (path | field | zh | en)",
    `| path | field | zh | en |\n|---|---|---|---|\n${titleRows.join("\n")}`,
    "## 반복 소제목 (zh | en | 파일 수) + 검색 제외 소제목",
    `| zh | en | files |\n|---|---|---|\n${[...recurring, ...biblio].join("\n")}`,
    "## 원문 문서",
    doc("docs/reference/glossary.md", readSource("docs/reference/glossary.md")),
    doc("docs/en/reference/glossary.md", readSource("docs/en/reference/glossary.md")),
    doc("docs/SUMMARY.md", readSource("docs/SUMMARY.md")),
    doc("docs/en/SUMMARY.md", readSource("docs/en/SUMMARY.md")),
    doc("docs/README.md", readSource("docs/README.md")),
  ].join("\n\n");
}

export function validateGlossary(text) {
  const problems = [];
  if (!text.startsWith("# 한국어판 용어집")) problems.push("missing title line");
  let rows = 0;
  for (const line of text.split("\n")) {
    if (!/^\|/.test(line) || /^\|\s*-/.test(line) || /^\|\s*zh\s*\|/.test(line)) continue;
    const cells = line.replace(/\\\|/g, "\u0000").split("|").slice(1, -1).map((c) => c.replace(/\u0000/g, "|").trim());
    rows += 1;
    if (cells.length !== 3) problems.push(`bad column count: ${line}`);
    else if (countHan(cells[2])) problems.push(`Han in ko cell: ${line}`);
  }
  for (const pinned of ["| \u4eba\u751f\u8fdb\u9636\u6307\u5357 | Life Level-up Guide | 인생 레벨업 가이드 |", "| \u97e9\u5148\u51ef | Han Xiankai | 한셴카이 |"]) {
    if (!text.includes(pinned)) problems.push(`pinned row missing: ${pinned}`);
  }
  return { rows, problems };
}

export async function runGlossary({ force = false } = {}) {
  setLogFile(join(WORK, "logs", "llm.jsonl"));
  const system = readText(join(KO_DIR, "prompts", "glossary.md"));
  const input = await buildGlossaryInput();
  const key = sha256([PROMPT_VERSION, TRANSLATOR.model, system, input].join("\u0000"));
  const cacheFile = cachePath("glossary", key);
  let cached = readJson(cacheFile, null);
  if (!cached || force) {
    const result = await createMessage(
      {
        model: TRANSLATOR.model,
        max_tokens: TRANSLATOR.max_tokens,
        output_config: { effort: TRANSLATOR.effort },
        system: [{ type: "text", text: system }],
        messages: [{ role: "user", content: input }],
      },
      { label: "glossary" },
    );
    if (result.stopReason !== "end_turn") throw new Error(`glossary stop_reason=${result.stopReason}`);
    cached = { key, model: result.model, usage: result.usage, text: result.text.trim() };
    writeJson(cacheFile, cached);
  }
  writeFileSync(join(WORK, "glossary.raw.md"), `${cached.text}\n`);
  const check = validateGlossary(cached.text);
  console.log(`glossary: ${check.rows} rows, ${check.problems.length} problems (served by ${cached.model})`);
  for (const p of check.problems.slice(0, 40)) console.log(`  - ${p}`);
  return { text: cached.text, check };
}

// Step 1b: one pass over the whole Chinese corpus for names/terms the first pass could not see.
// Returns the supplement rows; mergeSupplement() appends only zh terms not already in the glossary.
export async function runGlossarySupplement({ force = false } = {}) {
  setLogFile(join(WORK, "logs", "llm.jsonl"));
  const system = readText(join(KO_DIR, "prompts", "glossary-supplement.md"));
  const existing = readText(GLOSSARY_PATH);
  const corpus = ownedFiles()
    .filter((p) => p.startsWith("docs/") || p === "README.md" || p === "MAINTENANCE.md" || p === "ISSUE_TRIAGE.md")
    .map((p) => `<document path="${p}">\n${readSource(p)}\n</document>`)
    .join("\n");
  const input = `<existing_glossary>\n${existing}\n</existing_glossary>\n\n<corpus>\n${corpus}\n</corpus>\n\n기존 용어집에 없는 항목만 보충 표로 출력하라.`;
  const key = sha256([PROMPT_VERSION, TRANSLATOR.model, system, input].join("\u0000"));
  const cacheFile = cachePath("glossary-supplement", key);
  let cached = readJson(cacheFile, null);
  if (!cached || force) {
    const result = await createMessage(
      {
        model: TRANSLATOR.model,
        max_tokens: TRANSLATOR.max_tokens,
        output_config: { effort: TRANSLATOR.effort },
        system: [{ type: "text", text: system }],
        messages: [{ role: "user", content: input }],
      },
      { label: "glossary-supplement" },
    );
    if (result.stopReason !== "end_turn") throw new Error(`glossary supplement stop_reason=${result.stopReason}`);
    cached = { key, model: result.model, usage: result.usage, text: result.text.trim() };
    writeJson(cacheFile, cached);
  }
  writeFileSync(join(WORK, "glossary-supplement.raw.md"), `${cached.text}\n`);
  return cached;
}

export function mergeSupplement(glossaryText, supplementText) {
  const known = new Set(
    glossaryText
      .split("\n")
      .filter((l) => /^\|/.test(l))
      .map((l) => l.replace(/\\\|/g, "\u0000").split("|")[1]?.trim())
      .filter(Boolean),
  );
  const sections = new Map();
  let section = null;
  for (const line of supplementText.split("\n")) {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    if (!section || !/^\|/.test(line) || /^\|\s*:?-{2,}/.test(line) || /^\|\s*zh\s*\|/.test(line)) continue;
    const cells = line.replace(/\\\|/g, "\u0000").split("|").slice(1, -1);
    const zh = cells[0]?.trim();
    if (cells.length !== 3 || !zh || known.has(zh) || countHan(cells[2].replace(/\u0000/g, "|"))) continue;
    known.add(zh);
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section).push(line);
  }
  let out = glossaryText.replace(/\s+$/, "");
  let added = 0;
  for (const [name, rows] of sections) {
    const header = `## ${name}`;
    const index = out.split("\n").findIndex((l) => l.trim() === header);
    if (index >= 0) {
      const lines = out.split("\n");
      let end = index + 1;
      while (end < lines.length && !/^##\s/.test(lines[end])) end += 1;
      while (end > index + 1 && !lines[end - 1].trim()) end -= 1;
      lines.splice(end, 0, ...rows);
      out = lines.join("\n");
    } else {
      out += `\n\n${header}\n\n| zh | en | ko |\n|---|---|---|\n${rows.join("\n")}`;
    }
    added += rows.length;
  }
  return { text: `${out}\n`, added };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--supplement")) {
    const supplement = await runGlossarySupplement({ force: process.argv.includes("--force") });
    const merged = mergeSupplement(readText(GLOSSARY_PATH), supplement.text);
    console.log(`supplement: ${merged.added} new rows (served by ${supplement.model})`);
    if (process.argv.includes("--write")) writeText(GLOSSARY_PATH, merged.text);
  } else {
    const { text } = await runGlossary({ force: process.argv.includes("--force") });
    if (process.argv.includes("--write")) {
      writeText(GLOSSARY_PATH, `${text}\n`);
      console.log(`wrote ${GLOSSARY_PATH}`);
    }
  }
}
