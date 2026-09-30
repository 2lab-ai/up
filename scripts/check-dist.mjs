#!/usr/bin/env node

// Crawl the built site (docs/.vitepress/dist) and fail on:
// - internal links whose target page, file, or #fragment does not exist;
// - canonical, og:url, or JSON-LD url that differ from the URL the page is served at;
// - sitemap entries that are not served page URLs, and pages missing from the sitemap.
// Served URLs follow cleanUrls hosting: `a/b.html` -> /up/a/b, `a/index.html` -> /up/a/.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "docs/.vitepress/dist");
const ORIGIN = "https://dosi.dev";
const BASE = "/up/";
const errors = [];

if (!existsSync(DIST)) {
  console.error("docs/.vitepress/dist가 없습니다. 먼저 npm run docs:build를 실행하세요");
  process.exit(1);
}

function walk(dir, output = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, output);
    else output.push(path);
  }
  return output;
}

const decodeEntities = (value) =>
  value.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#x27": "'" })[name]);
const safeDecode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const files = walk(DIST);
const pages = files.filter((file) => file.endsWith(".html"));
const servedPath = (file) => {
  const path = relative(DIST, file).split(sep).join("/");
  if (path === "index.html") return BASE;
  if (path.endsWith("/index.html")) return `${BASE}${path.slice(0, -"index.html".length)}`;
  return `${BASE}${path.slice(0, -".html".length)}`;
};

// Resolve a site path (with base) to the file a cleanUrls host serves for it.
function fileFor(pathname) {
  if (!pathname.startsWith(BASE)) return undefined;
  const rest = pathname.slice(BASE.length);
  const candidates = rest === "" || rest.endsWith("/")
    ? [join(DIST, rest, "index.html")]
    : [join(DIST, rest), join(DIST, `${rest}.html`), join(DIST, rest, "index.html")];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

const idCache = new Map();
function idsOf(file) {
  if (!idCache.has(file)) {
    const html = readFileSync(file, "utf8");
    const ids = new Set();
    for (const match of html.matchAll(/\sid="([^"]*)"/g)) {
      const id = decodeEntities(match[1]);
      ids.add(id);
      ids.add(id.normalize("NFC"));
    }
    idCache.set(file, ids);
  }
  return idCache.get(file);
}

let linkCount = 0;
let fragmentCount = 0;
for (const page of pages) {
  const html = readFileSync(page, "utf8");
  const pageUrl = new URL(servedPath(page), ORIGIN);
  const where = relative(ROOT, page);
  for (const match of html.matchAll(/<(a|link)\b[^>]*?\shref="([^"]*)"/g)) {
    const raw = decodeEntities(match[2]);
    if (!raw || /^(?:[a-z][a-z0-9+.-]*:)/i.test(raw) && !raw.startsWith(ORIGIN)) continue;
    if (/^\/\//.test(raw)) continue;
    const url = new URL(raw, pageUrl);
    if (url.origin !== ORIGIN) continue;
    if (match[1] === "link" && /\srel="canonical"/.test(match[0])) continue;
    linkCount += 1;
    const target = fileFor(url.pathname);
    if (!target) {
      errors.push(`${where}: 링크 대상이 없습니다: ${raw}`);
      continue;
    }
    if (url.hash && url.hash !== "#" && target.endsWith(".html")) {
      fragmentCount += 1;
      const fragment = safeDecode(url.hash.slice(1));
      const ids = idsOf(target);
      if (!ids.has(fragment) && !ids.has(fragment.normalize("NFKD")) && !ids.has(fragment.normalize("NFC"))) {
        errors.push(`${where}: 링크 앵커가 없습니다: ${raw}`);
      }
    }
  }
  for (const match of html.matchAll(/\s(?:src)="([^"]*)"/g)) {
    const raw = decodeEntities(match[1]);
    if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) continue;
    const url = new URL(raw, pageUrl);
    linkCount += 1;
    if (!fileFor(url.pathname)) errors.push(`${where}: 자원 파일이 없습니다: ${raw}`);
  }
}

// Canonical metadata must name the URL the page is actually served at.
const sitemapUrls = new Set(
  [...readFileSync(join(DIST, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decodeEntities(match[1])),
);
const contentPages = pages.filter((page) => relative(DIST, page) !== "404.html");
for (const page of contentPages) {
  const html = readFileSync(page, "utf8");
  const served = `${ORIGIN}${servedPath(page)}`;
  const where = relative(ROOT, page);
  const canonical = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
  const ogUrl = html.match(/<meta property="og:url" content="([^"]*)"/)?.[1];
  const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  const ldUrl = jsonLd ? JSON.parse(jsonLd).url : undefined;
  if (/<link rel="canonical"/.test(html) && !canonical) errors.push(`${where}: canonical 형식을 읽을 수 없습니다`);
  const data = jsonLd ? JSON.parse(jsonLd) : {};
  const resources = [
    html.match(/<meta property="og:image" content="([^"]*)"/)?.[1],
    html.match(/<meta name="twitter:image" content="([^"]*)"/)?.[1],
    data.image,
    data.isPartOf?.url,
    ...(data.encoding || []).map((entry) => entry.contentUrl),
  ].filter(Boolean);
  for (const resource of resources) {
    const url = new URL(decodeEntities(resource));
    if (url.origin !== ORIGIN || !fileFor(url.pathname)) errors.push(`${where}: 메타데이터 주소가 없는 파일을 가리킵니다: ${resource}`);
  }
  for (const [label, value] of [["canonical", canonical], ["og:url", ogUrl], ["JSON-LD url", ldUrl]]) {
    if (value === undefined) errors.push(`${where}: ${label}가 없습니다`);
    else if (decodeEntities(value) !== served) errors.push(`${where}: ${label} ${value} != 제공 주소 ${served}`);
  }
  if (!sitemapUrls.has(served)) errors.push(`${where}: sitemap에 제공 주소가 없습니다: ${served}`);
}
const servedSet = new Set(contentPages.map((page) => `${ORIGIN}${servedPath(page)}`));
for (const url of sitemapUrls) {
  if (!servedSet.has(url)) errors.push(`sitemap.xml: 제공되지 않는 주소입니다: ${url}`);
}

if (errors.length) {
  console.error(`✗ dist 검사 실패: 문제 ${errors.length}개`);
  for (const error of errors.slice(0, 200)) console.error(`  ${error}`);
  process.exit(1);
}
console.log(
  `✓ dist 검사 통과: 페이지 ${pages.length}개, 내부 링크·자원 ${linkCount}개(앵커 ${fragmentCount}개) 깨짐 0, canonical·og:url·JSON-LD·sitemap ${contentPages.length}개 = 제공 주소`,
);
