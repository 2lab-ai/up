#!/usr/bin/env node

// Word lists share one English term body; this script owns their Korean frontmatter and closing note.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "docs/threads/word-list");
const checkOnly = process.argv.includes("--check");
const VOCABULARY_CHAPTER = "../part-1/2-vocabulary.md";

// Keep the term body only: drop frontmatter and any closing note that points back to the vocabulary chapter.
function termBody(source) {
  const paragraphs = source
    .replace(/^---\n[\s\S]*?\n---\n+/, "")
    .trim()
    .split(/\n{2,}/);
  while (paragraphs.length > 1 && paragraphs.at(-1).includes(`(${VOCABULARY_CHAPTER})`)) paragraphs.pop();
  return paragraphs.join("\n\n").trim();
}

function koreanPage(source) {
  const body = termBody(source);
  const title = body.match(/^#\s+(.+)$/m)?.[1] || "영어";
  return `---
title: ${title} 단어 목록
description: ${title} 분야에서 가치가 높은 영어 용어를 모은 참고 목록. 실제 과제에서 항목을 골라 발음\u00b7연어\u00b7회상\u00b7문맥 속 사용을 연습한다.
updated: 2026-08-16
---

${body}

이 페이지는 찾아보는 목록이지 외워야 할 분량이 아니다. [어휘 편](${VOCABULARY_CHAPTER})과 함께 실제 과제에서 항목을 골라 발음, 뜻, 연어, 능동 회상, 문맥 속 사용을 연습하라.
`;
}

let changed = false;
for (const name of readdirSync(SOURCE).filter((file) => file.endsWith(".md")).sort()) {
  const sourceFile = join(SOURCE, name);
  const source = readFileSync(sourceFile, "utf8");
  const expected = koreanPage(source);
  if (source === expected) continue;
  changed = true;
  if (checkOnly) {
    console.error(`${sourceFile.replace(`${ROOT}/`, "")}: 단어장 메타데이터가 동기화되지 않았습니다`);
  } else {
    writeFileSync(sourceFile, expected);
    console.log(`updated ${sourceFile.replace(`${ROOT}/`, "")}`);
  }
}

if (checkOnly && changed) process.exit(1);
if (!changed) console.log("word lists are in sync");
