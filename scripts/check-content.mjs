#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { toRepositoryReadme } from "./sync-readme.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const errors = [];
const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".cache",
  ".codex-artifact-work",
  "outputs",
  "playwright-report",
  "test-results",
  ".ko-work",
]);
// The translation pipeline (prompts, glossary, reports) is tooling, not published content.
const IGNORE_PATHS = new Set([join(ROOT, "scripts", "ko")]);
const PUBLIC_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);
const PUBLIC_ASSET_EXTENSIONS = new Set([...PUBLIC_IMAGE_EXTENSIONS, ".svg"]);
const TEXT_SOURCE_EXTENSIONS = new Set([".md", ".mjs", ".mts", ".ts", ".css"]);
const FORBIDDEN_TRACKED_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
const PUBLICATION_TIME_ZONE = "Asia/Seoul";

function dateInTimeZone(timeZone) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

const publicationToday = dateInTimeZone(PUBLICATION_TIME_ZONE);

function addError(file, line, message) {
  errors.push({ file: relative(ROOT, file), line, message });
}

function walk(dir, extensions, output = []) {
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (IGNORE_PATHS.has(path)) continue;
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, extensions, output);
    else if (extensions.has(extname(name).toLowerCase())) output.push(path);
  }
  return output;
}

const isExternal = (target) =>
  /^(https?:|mailto:|tel:|data:|\/\/)/i.test(target);

function stripOptionalTitle(target) {
  return target.replace(/\s+["'].*$/, "").trim();
}

function routeToFile(route) {
  const clean = route
    .replace(/^\/+/, "")
    .replace(/\/$/, "")
    .replace(/\/index$/, "")
    .replace(/\/README$/, "");
  if (!clean) return join(DOCS, "README.md");
  return join(DOCS, `${clean}.md`);
}

function resolveTarget(file, rawTarget) {
  let target = stripOptionalTitle(rawTarget);
  if (!target || isExternal(target) || target.startsWith("#")) return null;
  const pathPart = target.split("#")[0].split("?")[0];
  if (!pathPart) return null;
  if (pathPart.startsWith("/")) return routeToFile(pathPart);
  try {
    return resolve(dirname(file), decodeURIComponent(pathPart));
  } catch {
    return resolve(dirname(file), pathPart);
  }
}

function localTargetExists(path) {
  if (existsSync(path)) return true;
  if (path.startsWith(`${DOCS}${sep}`)) {
    const publicPath = join(DOCS, "public", relative(DOCS, path));
    if (existsSync(publicPath)) return true;
  }
  if (!extname(path) && existsSync(`${path}.md`)) return true;
  if (!extname(path) && existsSync(join(path, "README.md"))) return true;
  return false;
}

const MARKDOWN_LINK = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
const HTML_HREF = /href\s*=\s*["']([^"']+)["']/gi;
const HTML_IMAGE = /<img\b([^>]*)>/gi;
const GENERIC_ALT = new Set(["image", "img", "photo", "picture", "hotel", "이미지", "사진", "그림", "호텔"]);

function checkAltText(file, line, alt) {
  if (!alt?.trim()) {
    addError(file, line, "이미지에 의미 있는 alt 텍스트가 없습니다");
    return;
  }
  if (GENERIC_ALT.has(alt.trim().toLowerCase())) {
    addError(file, line, `이미지 alt가 지나치게 일반적입니다: "${alt.trim()}"`);
  }
}

function checkLinksAndAlt(file) {
  const lines = readFileSync(file, "utf8").split("\n");
  let inFence = false;
  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const targets = [];
    MARKDOWN_LINK.lastIndex = 0;
    let match;
    while ((match = MARKDOWN_LINK.exec(line))) {
      if (match[1] === "!") checkAltText(file, index + 1, match[2]);
      targets.push(match[3]);
    }
    HTML_HREF.lastIndex = 0;
    while ((match = HTML_HREF.exec(line))) targets.push(match[1]);
    HTML_IMAGE.lastIndex = 0;
    while ((match = HTML_IMAGE.exec(line))) {
      const alt = match[1].match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1];
      checkAltText(file, index + 1, alt);
    }

    for (const target of targets) {
      const resolved = resolveTarget(file, target);
      if (resolved && !localTargetExists(resolved)) {
        addError(
          file,
          index + 1,
          `링크 대상이 없습니다: ${target} -> ${relative(ROOT, resolved)}`,
        );
      }
    }
  });
}

function parseFrontmatter(file) {
  const text = readFileSync(file, "utf8");
  const block = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!block) return null;
  const values = {};
  for (const line of block[1].split("\n")) {
    const match = line.match(/^([a-zA-Z][\w-]*):\s*(.+)$/);
    if (match) values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function checkFrontmatter(file) {
  if (file.endsWith("SUMMARY.md")) return;
  const text = readFileSync(file, "utf8");
  const rawBlock = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
  if (rawBlock) {
    rawBlock.split("\n").forEach((line, index) => {
      const value = line.match(/^[a-zA-Z][\w-]*:\s*(.+)$/)?.[1]?.trim();
      if (value && !/^['"]/.test(value) && /:\s/.test(value)) {
        addError(file, index + 2, "콜론이 들어간 frontmatter 텍스트 값은 따옴표로 감싸야 합니다");
      }
    });
  }
  const frontmatter = parseFrontmatter(file);
  if (!frontmatter) {
    addError(file, 1, "공개 페이지에 frontmatter가 없습니다");
    return;
  }
  for (const key of ["title", "description", "updated"]) {
    if (!frontmatter[key]) addError(file, 1, `frontmatter에 ${key}가 없습니다`);
  }
  if (/\/(7-ai|1-ai-learning|2-ai-development-and-resource-layer)\.md$/.test(file)) {
    if (!frontmatter.sources_checked) {
      addError(file, 1, "AI 페이지에 sources_checked가 없습니다");
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(frontmatter.sources_checked)) {
      addError(file, 1, "sources_checked는 YYYY-MM-DD 형식이어야 합니다");
    }
  }
  if (frontmatter.updated && !/^\d{4}-\d{2}-\d{2}$/.test(frontmatter.updated)) {
    addError(file, 1, "updated는 YYYY-MM-DD 형식이어야 합니다");
  }
  if (frontmatter.updated && /^\d{4}-\d{2}-\d{2}$/.test(frontmatter.updated)) {
    if (frontmatter.updated > publicationToday) {
      addError(file, 1, `updated는 프로젝트 시간대 ${PUBLICATION_TIME_ZONE}의 오늘 날짜보다 늦을 수 없습니다`);
    }
  }
  if (frontmatter.description && frontmatter.description.length < 24) {
    addError(file, 1, "description이 너무 짧아 페이지 내용을 구분할 수 없습니다");
  }

  if (/\/(7-ai|1-ai-learning|2-ai-development-and-resource-layer)\.md$/.test(file) && frontmatter.sources_checked) {
    const age = Date.now() - Date.parse(`${frontmatter.sources_checked}T00:00:00Z`);
    const maxAge = 120 * 24 * 60 * 60 * 1000;
    if (age > maxAge) addError(file, 1, "AI 제품 자료를 120일 넘게 재확인하지 않았습니다");
  }
}

function checkManualBookPager(file) {
  const source = relative(DOCS, file).split(sep).join("/");
  const isBookPage = /^threads\/part-[0-6]\//.test(source) || source === "projects.md";
  if (!isBookPage) return;

  const manualPager = /^(?:이전 글|다음 글|다음 부|다음 파트|홈으로 돌아가기|처음으로)\s*[：:]/;
  readFileSync(file, "utf8").split("\n").forEach((line, index) => {
    if (manualPager.test(line.trim())) {
      addError(file, index + 1, "본문에 이전 글/다음 글 링크를 직접 쓰지 마세요. 이어 읽기는 공통 페이지 하단 내비게이션이 만듭니다");
    }
  });
}

function checkPartOneClosing(file) {
  const source = relative(DOCS, file).split(sep).join("/");
  if (!/^threads\/part-1\/(0-cefr|grammar|[1-7]-.+)\.md$/.test(source)) return;

  const headings = [...readFileSync(file, "utf8").matchAll(/^## (.+)$/gm)].map((heading) => heading[1]);
  const expected = /^맺음말\s*[：:]/;
  if (!expected.test(headings.at(-1) || "")) {
    addError(file, 1, "제1부 핵심 장은 맺음말로 끝나야 합니다. 척도, 출처, 훈련 목록에서 멈추지 마세요");
  }
}

function checkKeyLiteraryClosing(file) {
  const source = relative(DOCS, file).split(sep).join("/");
  // Korean closing headings from scripts/ko/heading-map.json.
  const expectedClosings = new Map([
    ["threads/part-2/my-story.md", /^맺음말: 다시 시작은 승리의 귀환이 아니다$/],
    ["threads/part-2/narrative-and-evidence.md", /^맺음말: 이야기를 삶으로 돌려보내기$/],
    ["threads/part-2/entrepreneurship.md", /^맺음말: 야심이 현실을 통과하게 하라$/],
    ["threads/part-3/1-ai-learning.md", /^맺음말: 능력을 사람에게 남기기$/],
  ]);
  const expected = expectedClosings.get(source);
  if (!expected) return;

  const headings = [...readFileSync(file, "utf8").matchAll(/^## (.+)$/gm)].map((heading) => heading[1]);
  if (!expected.test(headings.at(-1) || "")) {
    addError(file, 1, "핵심 이야기 장과 AI 장은 지정된 문학적 맺음말로 끝나야 합니다. 업데이트, 목차, 출처 설명에서 멈추지 마세요");
  }
}

function checkEntrepreneurshipStyle(file) {
  const source = relative(DOCS, file).split(sep).join("/");
  if (source !== "threads/part-2/entrepreneurship.md") return;

  const text = readFileSync(file, "utf8");
  // Korean counterparts of the upstream markers (is-not / but-rather / truly).
  const contrastMarkers = ["아니다", "아니라", "진정한", "진짜"].reduce(
    (total, marker) => total + (text.match(new RegExp(marker, "g")) || []).length,
    0,
  );
  if (contrastMarkers > 8) {
    addError(file, 1, "창업 편에 이항 대비 문형이 너무 많습니다. 장면, 행동, 구체적 결과로 이야기를 밀고 나가세요");
  }
}

const STALE_PATTERNS = [
  ["#/", "Docsify 해시 라우트가 남아 있습니다"],
  ["byoungd.github.io", "원본 사이트 주소가 남아 있습니다. 사이트 주소는 https://dosi.dev/up/ , 원작 표기는 https://github.com/byoungd/up 을 쓰세요"],
  ["biezou.com", "원본의 제3자 AI 중계 서비스 추천은 한국어판에 싣지 않습니다"],
  ["397865076", "공개된 개인 QQ 번호"],
  ["user.qzone.qq.com", "공개된 개인 공간 링크"],
  ["douyin-qr", "공개된 QR 코드 자산"],
  ["2026-06 판", "만료된 버전 표기"],
  ["youtube.com/user/", "옛 YouTube 사용자 경로"],
  ["pan.baidu.com/s/1i5OLIIT", "만료된 클라우드 드라이브 링크"],
  ["v.youku.com", "만료된 Youku 링크"],
  ["zhuanlan.zhihu.com/p/444211376", "접근이 제한된 옛 Zhihu 링크"],
  ["zhuanlan.zhihu.com/p/653380203", "접근이 제한된 옛 Zhihu 링크"],
  ["10.1076/edre.7.1.403.3989", "만료되었거나 잘못된 어휘 연구 DOI"],
  ["10.1111/j.1467-9922.2011.00676.x", "다른 논문을 가리키는 잘못된 어휘 연구 DOI"],
  ["scholarspace.manoa.hawaii.edu/items/dfe724c0-c66f-4afe-9164-d6c6a59585d4", "교체된 ScholarSpace 어휘 연구 입구"],
  ["openaccess.wgtn.ac.nz/articles/journal_contribution/Unknown_vocabulary_density_and_reading_comprehension/12560354", "교체된 Wellington 어휘 연구 입구"],
  ["Lipu", "필명 로마자 표기 불일치 (Li Pu로 표기)"],
];

function checkStaleStrings(markdownFiles) {
  for (const file of markdownFiles) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const [pattern, reason] of STALE_PATTERNS) {
        if (line.includes(pattern)) addError(file, index + 1, `${reason}: "${pattern}"`);
      }
    });
  }
}

function checkReadmeMirror() {
  const source = readFileSync(join(DOCS, "README.md"), "utf8");
  const expected = toRepositoryReadme(source);
  const actual = readFileSync(join(ROOT, "README.md"), "utf8");
  if (expected !== actual) {
    addError(join(ROOT, "README.md"), 1, "docs/README.md와 동기화되지 않았습니다. npm run sync를 실행하세요");
  }
}

// The Korean edition publishes no Han characters: every Chinese passage must be translated.
const HAN = /\p{Script=Han}/u;
const HAN_RUNS = /\p{Script=Han}+/gu;

function checkNoHan(markdownFiles) {
  for (const file of markdownFiles) {
    const lines = readFileSync(file, "utf8").split("\n");
    const hits = [];
    lines.forEach((line, index) => {
      if (HAN.test(line)) hits.push(index);
    });
    for (const index of hits.slice(0, 3)) {
      const sample = lines[index].match(HAN_RUNS).join(" ").slice(0, 24);
      addError(file, index + 1, `한자(Han) 문자가 남아 있습니다: ${sample}`);
    }
    if (hits.length > 3) addError(file, hits[3] + 1, `한자가 남은 줄이 ${hits.length - 3}개 더 있습니다`);
  }
}

async function checkImageMetadata() {
  const files = walk(join(DOCS, "assets"), PUBLIC_IMAGE_EXTENSIONS);
  for (const file of files) {
    let metadata;
    try {
      metadata = await sharp(file).metadata();
    } catch (error) {
      addError(file, 1, `이미지 메타데이터를 확인할 수 없습니다: ${error.message}`);
      continue;
    }
    const found = ["exif", "iptc", "xmp"].filter((key) => metadata?.[key] != null);
    if (found.length) {
      addError(file, 1, `EXIF/GPS 또는 설명 메타데이터 블록이 있습니다: ${found.join(", ")}`);
    }
  }
}

function checkAttributionPaths() {
  const file = join(ROOT, "ATTRIBUTIONS.md");
  const lines = readFileSync(file, "utf8").split("\n");
  const codeSpan = /`([^`]+)`/g;
  lines.forEach((line, index) => {
    codeSpan.lastIndex = 0;
    let match;
    while ((match = codeSpan.exec(line))) {
      const candidate = match[1].trim();
      if (!candidate.startsWith("docs/") || candidate.includes("*")) continue;
      const path = resolve(ROOT, candidate.replace(/\/$/, ""));
      if (!path.startsWith(`${ROOT}${sep}`) || !existsSync(path)) {
        addError(file, index + 1, `출처 표의 로컬 경로가 없습니다: ${candidate}`);
      }
    }
  });
}

function checkOrphanAssets() {
  const assets = walk(join(DOCS, "assets"), PUBLIC_ASSET_EXTENSIONS);
  const sourceFiles = walk(ROOT, TEXT_SOURCE_EXTENSIONS).filter((file) => {
    if (file.startsWith(`${join(DOCS, "assets")}${sep}`)) return false;
    const name = basename(file);
    return name !== "ATTRIBUTIONS.md" && name !== "CHANGELOG.md";
  });
  const sourceText = sourceFiles.map((file) => readFileSync(file, "utf8"));

  for (const asset of assets) {
    const name = basename(asset);
    if (!sourceText.some((text) => text.includes(name))) {
      addError(asset, 1, `공개 자산이 본문, 설정, 빌드 스크립트 어디에서도 쓰이지 않습니다: ${name}`);
    }
  }
}

function checkTrackedSystemFiles() {
  let tracked;
  try {
    tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT });
  } catch (error) {
    addError(join(ROOT, ".gitignore"), 1, `Git 추적 목록을 읽을 수 없습니다: ${error.message}`);
    return;
  }
  for (const file of tracked.toString("utf8").split("\0")) {
    if (!file || !FORBIDDEN_TRACKED_NAMES.has(basename(file))) continue;
    addError(join(ROOT, file), 1, `시스템 메타데이터 파일은 Git으로 추적하면 안 됩니다: ${file}`);
  }
}

const markdownFiles = walk(ROOT, new Set([".md"]));
for (const file of markdownFiles) checkLinksAndAlt(file);
for (const file of markdownFiles.filter((path) => path.startsWith(`${DOCS}/`))) {
  checkFrontmatter(file);
  checkManualBookPager(file);
  checkPartOneClosing(file);
  checkKeyLiteraryClosing(file);
  checkEntrepreneurshipStyle(file);
}
const publishedMarkdown = markdownFiles.filter(
  (file) =>
    file.startsWith(`${DOCS}/`) ||
    file === join(ROOT, "README.md") ||
    file === join(ROOT, "SUMMARY.md"),
);
checkNoHan(publishedMarkdown);
checkStaleStrings(publishedMarkdown);
checkReadmeMirror();
checkAttributionPaths();
checkOrphanAssets();
checkTrackedSystemFiles();
await checkImageMetadata();

if (!errors.length) {
  console.log(`✓ 콘텐츠 검사 통과: Markdown ${markdownFiles.length}개 — 한자 없음, 링크, 메타데이터, 개인정보 검사 정상.`);
  process.exit(0);
}

console.error(`✗ 문제 ${errors.length}개 발견:\n`);
for (const error of errors) {
  const location = error.line ? `${error.file}:${error.line}` : error.file;
  console.error(`  ${location}  ${error.message}`);
}
process.exit(1);
