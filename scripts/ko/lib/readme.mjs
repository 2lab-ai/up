// Root README.md is, upstream, a generated mirror of docs/README.md (scripts/sync-readme.mjs @ 7478ac2:
// same text, links rewritten to repository paths). Rebuild it from the translated home page so the two
// never drift; the language line keeps upstream's repository link.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../config.mjs";

export function toRepositoryReadme(source) {
  return source
    .replace("한국어 | [English](en/)", "한국어 | [English](docs/en/README.md)")
    .replace(/\]\((assets|threads|templates|reference)\//g, "](docs/$1/")
    .replace(/src="\.\/assets\//g, 'src="./docs/assets/')
    .replace(/href="\.\/downloads\//g, 'href="./docs/public/downloads/')
    .replace(/\]\(projects\.md\)/g, "](docs/projects.md)")
    .replace(/href="\.\/(threads\/[^"]+|templates\/[^"]+|projects)"/g, (_match, path) => `href="./docs/${path}.md"`);
}

export function mirrorReadme() {
  const expected = toRepositoryReadme(readFileSync(join(ROOT, "docs/README.md"), "utf8"));
  const current = readFileSync(join(ROOT, "README.md"), "utf8");
  if (current !== expected) writeFileSync(join(ROOT, "README.md"), expected);
  return { changed: current !== expected };
}
