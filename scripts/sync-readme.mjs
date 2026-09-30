#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceFile = join(ROOT, "docs/README.md");
const targetFile = join(ROOT, "README.md");

// The repository README mirrors the site home page with links rewritten to repository paths.
export function toRepositoryReadme(source) {
  return source
    .replace(/\]\((assets|threads|templates|reference)\//g, "](docs/$1/")
    .replace(/src="\.\/assets\//g, 'src="./docs/assets/')
    .replace(/href="\.\/downloads\//g, 'href="./docs/public/downloads/')
    .replace(/\]\(projects\.md\)/g, "](docs/projects.md)")
    .replace(/href="\.\/(threads\/[^\"]+|templates\/[^\"]+|projects)"/g, (_match, path) =>
      `href="./docs/${path}.md"`,
    );
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const expected = toRepositoryReadme(readFileSync(sourceFile, "utf8"));
  const actual = readFileSync(targetFile, "utf8");

  if (actual !== expected) {
    if (checkOnly) {
      console.error("README.md: docs/README.md와 동기화되지 않았습니다. npm run sync를 실행하세요");
      process.exit(1);
    }
    writeFileSync(targetFile, expected);
    console.log("updated README.md");
  } else {
    console.log("README mirror is in sync");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
