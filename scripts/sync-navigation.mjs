#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { navigation } from "../docs/.vitepress/navigation.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const checkOnly = process.argv.includes("--check");

const UNPUBLISHED_DIRS = new Set([".vitepress", "public", "assets"]);

function markdownSources(dir, prefix = "", output = []) {
  for (const name of readdirSync(dir)) {
    if (UNPUBLISHED_DIRS.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      markdownSources(path, join(prefix, name), output);
      continue;
    }
    if (!name.endsWith(".md") || name === "SUMMARY.md") continue;
    output.push(join(prefix, name));
  }
  return output;
}

function validateNavigation(groups) {
  const seenLinks = new Set();
  for (const group of groups) {
    if (!group.text || !Array.isArray(group.items)) {
      throw new Error("내비게이션 그룹에 text 또는 items가 없습니다");
    }
    for (const item of group.items) {
      if (!item.text || !item.link || !item.source) {
        throw new Error(`내비게이션 항목의 필드가 불완전합니다: ${JSON.stringify(item)}`);
      }
      if (seenLinks.has(item.link)) {
        throw new Error(`내비게이션에 중복 링크가 있습니다: ${item.link}`);
      }
      seenLinks.add(item.link);

      const source = resolve(DOCS, item.source);
      if (!source.startsWith(`${DOCS}/`) || !existsSync(source)) {
        throw new Error(`내비게이션 source가 존재하지 않습니다: ${item.source}`);
      }
    }
  }
}

validateNavigation(navigation);

function validateNavigationCoverage() {
  const publicSources = new Set(markdownSources(DOCS));
  const navigationSources = new Set(navigation.flatMap((group) => group.items.map((item) => item.source)));

  for (const source of publicSources) {
    if (!navigationSources.has(source)) {
      throw new Error(`공개 Markdown이 내비게이션에 없습니다: ${source}`);
    }
  }
  for (const source of navigationSources) {
    if (!publicSources.has(source)) {
      throw new Error(`내비게이션 source가 공개 Markdown이 아닙니다: ${source}`);
    }
  }
}

validateNavigationCoverage();

function summary(groups, prefix = "") {
  const lines = ["# 차례", ""];
  for (const group of groups) {
    lines.push(`## ${group.text}`, "");
    for (const item of group.items) {
      lines.push(`- [${item.text}](${prefix}${item.source})`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

const outputs = new Map([
  [join(ROOT, "SUMMARY.md"), summary(navigation, "docs/")],
  [join(ROOT, "docs/SUMMARY.md"), summary(navigation)],
]);

let changed = false;
for (const [file, expected] of outputs) {
  const actual = readFileSync(file, "utf8");
  if (actual === expected) continue;
  changed = true;
  if (checkOnly) {
    console.error(`${file.replace(`${ROOT}/`, "")}: 내비게이션 요약이 동기화되지 않았습니다`);
  } else {
    writeFileSync(file, expected);
    console.log(`updated ${file.replace(`${ROOT}/`, "")}`);
  }
}

if (checkOnly && changed) process.exit(1);
if (!changed) console.log("navigation summaries are in sync");
