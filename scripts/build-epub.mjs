#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createMarkdownRenderer } from "vitepress";
import { navigation, publicationSections } from "../docs/.vitepress/navigation.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const PUBLIC = join(DOCS, "public");
const OUTPUT_DIR = join(PUBLIC, "downloads");
const ONLINE_ROOT = "https://dosi.dev/up/";
const ORIGINAL_ROOT = "https://github.com/byoungd/up";
const checkOnly = process.argv.includes("--check");
const fixedTime = new Date("1980-01-01T00:00:00Z");
const zipEnv = { ...process.env, TZ: "UTC" };

// Single Korean edition, translated from the original Chinese manuscript.
const editions = [
  {
    key: "ko",
    file: "life-level-up-guide-ko.epub",
    navigation,
    lang: "ko-KR",
    title: "인생 레벨업 가이드",
    subtitle: "AI 시대 평생학습 가이드",
    creator: "한셴카이",
    translator: "2lab.ai",
    frontMatter: "책을 열며",
    appendices: "부록과 도구 상자",
    contents: "차례",
    coverAlt: "인생 레벨업 가이드 표지",
    description: "영어, AI, 실제 프로젝트, 인생의 바닥에서 출발해 재측정하고, 전이하고, 회복하고, 책임질 수 있는 평생학습 시스템을 세웁니다.",
    attribution: "원작: 한셴카이(byoungd), 중국어 원문을 한국어로 옮김",
    coverSource: join(PUBLIC, "assets/cover-portrait.png"),
  },
];

const allNavigationItems = navigation.flatMap(({ items }) => items);
const sourceToRoute = new Map(allNavigationItems.map(({ source, link }) => [source, link]));
const routeToSource = new Map(
  allNavigationItems.map(({ source, link }) => [link.replace(/^\/+|\/+$/g, ""), source]),
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function parseFrontmatter(file) {
  const source = readFileSync(file, "utf8");
  const block = source.match(/^---\n([\s\S]*?)\n---\n/);
  const values = {};
  if (block) {
    for (const line of block[1].split("\n")) {
      const match = line.match(/^([a-zA-Z][\w-]*):\s*(.+)$/);
      if (match) values[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return {
    body: block ? source.slice(block[0].length) : source,
    values,
  };
}

function normalizeSource(path) {
  return normalize(path).split(sep).join("/").replace(/^\.\//, "");
}

function sourceForRoute(route) {
  const clean = route.replace(/^\/+|\/+$/g, "");
  return routeToSource.get(clean);
}

function resolveMarkdownTarget(source, rawPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    decoded = rawPath;
  }
  if (decoded.startsWith("/")) return sourceForRoute(decoded);

  const candidate = normalizeSource(join(dirname(source), decoded));
  const choices = extname(candidate)
    ? [candidate]
    : [`${candidate}.md`, join(candidate, "README.md")];
  return choices.find((choice) => existsSync(join(DOCS, choice)));
}

function onlineUrlForSource(source, hash = "", query = "") {
  const configured = sourceToRoute.get(source);
  let route = configured;
  if (!route) {
    if (source === "README.md") route = "/";
    else if (source.endsWith("/README.md")) route = `/${source.slice(0, -"README.md".length)}`;
    else route = `/${source.replace(/\.md$/, "")}`;
  }
  return `${ONLINE_ROOT.replace(/\/$/, "")}${route}${query}${hash}`;
}

function onlineUrlForUnresolvedPath(source, rawPath, hash = "", query = "") {
  const normalized = rawPath.startsWith("/")
    ? rawPath.replace(/^\/+/, "")
    : normalizeSource(join(dirname(source), rawPath));
  return `${ONLINE_ROOT}${normalized}${query}${hash}`;
}

function mediaType(file) {
  const extension = extname(file).toLowerCase();
  return {
    ".css": "text/css",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".xhtml": "application/xhtml+xml",
  }[extension];
}

function walk(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, output);
    else output.push(path);
  }
  return output;
}

function rewriteHtmlAttributes(content, source, rewriteLink, rewriteImage) {
  return content
    .replace(/\bhref=(['"])(.*?)\1/gi, (_match, quote, href) => `href=${quote}${rewriteLink(href, source)}${quote}`)
    .replace(/\bsrc=(['"])(.*?)\1/gi, (_match, quote, src) => `src=${quote}${rewriteImage(src, source)}${quote}`)
    .replace(/\s+(?:target|loading|decoding|fetchpriority)=(['"])[^'"]*\1/gi, "");
}

function makeXhtml({ lang, title, body, epubType = "chapter" }) {
  const safeBody = body
    .replace(/<a\b[^>]*class="header-anchor"[^>]*>[\s\S]*?<\/a>/gi, "")
    .replace(/\s+tabindex=(['"])-?\d+\1/gi, "")
    .replace(/&nbsp;/g, "&#160;")
    .replace(/&ZeroWidthSpace;/g, "&#8203;")
    .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi, "&amp;")
    .replace(/<(img|br|hr)(\b[^>]*?)(?<!\/)\s*>/gi, "<$1$2 />");
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">
<head>
  <meta charset="utf-8" />
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css" />
</head>
<body epub:type="${epubType}">
<main>
${safeBody}
</main>
</body>
</html>
`;
}

function unescapeXml(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function validateEpubRoot(epubRoot, edition, chapterRecords) {
  const oebps = join(epubRoot, "OEBPS");
  const opf = readFileSync(join(oebps, "package.opf"), "utf8");
  const files = new Set(walk(oebps).map((file) => normalizeSource(relative(oebps, file))));
  const manifestItems = [...opf.matchAll(/<item\s+([^>]+)\/>/g)].map((match) => {
    const attributes = Object.fromEntries(
      [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((attribute) => [attribute[1], unescapeXml(attribute[2])]),
    );
    return attributes;
  });
  const manifestById = new Map(manifestItems.map((item) => [item.id, item]));
  const manifestFiles = new Set(manifestItems.map(({ href }) => normalizeSource(href)));

  for (const file of files) {
    if (file === "package.opf") continue;
    if (!manifestFiles.has(file)) throw new Error(`${edition.file}: manifest에 없는 파일 ${file}`);
  }
  for (const file of manifestFiles) {
    if (!files.has(file)) throw new Error(`${edition.file}: manifest 대상 파일이 없습니다 ${file}`);
  }

  const spineIds = [...opf.matchAll(/<itemref\s+idref="([^"]+)"\s*\/>/g)].map((match) => match[1]);
  if (spineIds.length !== chapterRecords.length + 2) {
    throw new Error(`${edition.file}: spine 항목 수가 틀렸습니다: ${spineIds.length}`);
  }
  for (const id of spineIds) {
    if (!manifestById.has(id)) throw new Error(`${edition.file}: spine이 선언되지 않은 리소스를 참조합니다 ${id}`);
  }

  const xhtmlFiles = [...files].filter((file) => file.endsWith(".xhtml"));
  for (const file of xhtmlFiles) {
    const content = readFileSync(join(oebps, file), "utf8");
    for (const match of content.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const href = unescapeXml(match[1]);
      if (/^(?:https?:|mailto:|tel:|data:|\/\/)/i.test(href)) continue;
      const [pathAndQuery, rawHash = ""] = href.split("#", 2);
      const cleanPath = pathAndQuery.split("?", 1)[0];
      const targetFile = normalizeSource(cleanPath ? join(dirname(file), cleanPath) : file);
      if (!files.has(targetFile)) throw new Error(`${edition.file}: ${file}의 링크 대상이 없습니다 ${href}`);
      if (rawHash) {
        let hash;
        try {
          hash = decodeURIComponent(rawHash);
        } catch {
          hash = rawHash;
        }
        const targetContent = readFileSync(join(oebps, targetFile), "utf8");
        const escapedId = escapeXml(hash);
        if (!targetContent.includes(`id="${escapedId}"`)) {
          throw new Error(`${edition.file}: ${file}의 링크 앵커가 없습니다 ${href}`);
        }
      }
    }
  }

  const nav = readFileSync(join(oebps, "nav.xhtml"), "utf8");
  const navLinks = [...nav.matchAll(/<a href="([^"]+)"/g)].map((match) => match[1]);
  if (navLinks.length !== chapterRecords.length + 1) {
    throw new Error(`${edition.file}: 차례 항목 수가 틀렸습니다: ${navLinks.length}`);
  }
}

function bookCss() {
  return `:root { color-scheme: light dark; }
body {
  font-family: "Noto Serif KR", "Noto Serif CJK KR", "Nanum Myeongjo", "AppleMyungjo", Batang, serif;
  line-height: 1.8;
  margin: 5%;
  orphans: 2;
  widows: 2;
  word-break: keep-all;
  overflow-wrap: break-word;
}
main { max-width: 42rem; margin: 0 auto; }
h1, h2, h3, h4 { line-height: 1.3; page-break-after: avoid; }
h1 { font-size: 1.8em; margin: 0 0 1.2em; }
h2 { font-size: 1.35em; margin-top: 2.2em; }
h3 { font-size: 1.12em; margin-top: 1.8em; }
p, li { text-align: justify; }
a { color: inherit; text-decoration: underline; text-decoration-thickness: 0.06em; }
blockquote { border-left: 0.18em solid #737373; margin: 1.4em 0; padding-left: 1em; color: #555; }
img { display: block; height: auto; margin: 1.6em auto; max-width: 100%; }
table { border-collapse: collapse; font-size: 0.86em; margin: 1.5em 0; width: 100%; }
th, td { border: 1px solid #999; padding: 0.45em; vertical-align: top; }
pre { background: #f3f3f3; border: 1px solid #ddd; overflow-wrap: anywhere; padding: 0.8em; white-space: pre-wrap; }
code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.9em; }
.book-meta, .guide-paths { margin: 1.3em 0; }
.guide-path { display: block; margin: 0.7em 0; text-decoration: none; }
.guide-path strong { display: block; }
.cover { margin: 0; padding: 0; text-align: center; }
.cover img { height: auto; margin: 0 auto; max-height: 90vh; max-width: 100%; }
@media (prefers-color-scheme: dark) {
  blockquote { color: #ccc; }
  pre { background: #222; border-color: #555; }
}
`;
}

function containerXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>
`;
}

async function buildEdition(edition, markdown, tempBase) {
  const sections = publicationSections(edition.navigation, edition);
  const items = sections.flatMap(({ items }) => items);
  const sourceToChapter = new Map(
    items.map(({ source }, index) => [source, `chapter-${String(index + 1).padStart(3, "0")}.xhtml`]),
  );
  const epubRoot = join(tempBase, `${edition.key}-root`);
  const textDir = join(epubRoot, "OEBPS/text");
  const stylesDir = join(epubRoot, "OEBPS/styles");
  const assetsDir = join(epubRoot, "OEBPS/assets");
  const metaDir = join(epubRoot, "META-INF");
  for (const directory of [textDir, stylesDir, assetsDir, metaDir]) mkdirSync(directory, { recursive: true });

  writeFileSync(join(epubRoot, "mimetype"), "application/epub+zip");
  writeFileSync(join(metaDir, "container.xml"), containerXml());
  writeFileSync(join(stylesDir, "book.css"), bookCss());
  copyFileSync(edition.coverSource, join(assetsDir, "cover.png"));

  const imageTargets = new Map();
  const rewriteImage = (href, source) => {
    if (/^(?:https?:|data:|\/\/)/i.test(href)) return href;
    const clean = href.split(/[?#]/, 1)[0];
    let absolute;
    if (clean.startsWith("/assets/")) absolute = join(PUBLIC, clean.replace(/^\/+/, ""));
    else absolute = resolve(dirname(join(DOCS, source)), clean);
    if (!existsSync(absolute)) throw new Error(`${source}: EPUB 이미지가 없습니다: ${href}`);
    let target;
    if (absolute.startsWith(`${join(DOCS, "assets")}${sep}`)) {
      target = `assets/${normalizeSource(relative(join(DOCS, "assets"), absolute))}`;
    } else if (absolute.startsWith(`${PUBLIC}${sep}`)) {
      target = `assets/public/${normalizeSource(relative(PUBLIC, absolute))}`;
    } else {
      throw new Error(`${source}: EPUB 이미지가 공개 자산 디렉터리 밖에 있습니다: ${href}`);
    }
    imageTargets.set(absolute, target);
    return `../${target}`;
  };

  const rewriteLink = (href, source) => {
    if (/^(?:https?:|mailto:|tel:|data:|\/\/)/i.test(href) || href.startsWith("#")) return href;
    const hashIndex = href.indexOf("#");
    const queryIndex = href.indexOf("?");
    const pathEnd = [hashIndex, queryIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? href.length;
    const rawPath = href.slice(0, pathEnd);
    const query = queryIndex >= 0 ? href.slice(queryIndex, hashIndex >= 0 ? hashIndex : href.length) : "";
    const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
    if (!rawPath) return `${query}${hash}`;
    const targetSource = resolveMarkdownTarget(source, rawPath);
    if (!targetSource) return onlineUrlForUnresolvedPath(source, rawPath, hash, query);
    const chapter = sourceToChapter.get(targetSource);
    return chapter ? `${chapter}${hash}` : onlineUrlForSource(targetSource, hash, query);
  };

  const chapterRecords = [];
  let latestUpdated = "1970-01-01";
  for (const [index, item] of items.entries()) {
    const sourceFile = join(DOCS, item.source);
    const { body, values } = parseFrontmatter(sourceFile);
    latestUpdated = [latestUpdated, values.updated || "1970-01-01"].sort().at(-1);
    const env = { path: item.source, relativePath: item.source };
    const tokens = markdown.parse(body, env);
    const visit = (token) => {
      if (token.type === "link_open") token.attrSet("href", rewriteLink(token.attrGet("href"), item.source));
      if (token.type === "image") token.attrSet("src", rewriteImage(token.attrGet("src"), item.source));
      if (token.type === "html_block" || token.type === "html_inline") {
        token.content = rewriteHtmlAttributes(token.content, item.source, rewriteLink, rewriteImage);
      }
      for (const child of token.children || []) visit(child);
    };
    for (const token of tokens) visit(token);
    const rendered = markdown.renderer.render(tokens, markdown.options, env);
    const filename = sourceToChapter.get(item.source);
    const title = values.title || item.text;
    writeFileSync(
      join(textDir, filename),
      makeXhtml({ lang: edition.lang, title, body: rendered, epubType: item.source.endsWith("README.md") ? "preface" : "chapter" }),
    );
    chapterRecords.push({
      id: `chapter-${String(index + 1).padStart(3, "0")}`,
      filename,
      source: item.source,
      title,
    });
  }

  for (const [absolute, target] of [...imageTargets.entries()].sort((a, b) => a[1].localeCompare(b[1]))) {
    const destination = join(epubRoot, "OEBPS", target);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(absolute, destination);
  }

  const coverBody = `<section class="cover" epub:type="cover"><img src="../assets/cover.png" alt="${escapeXml(edition.coverAlt)}" /></section>`;
  writeFileSync(
    join(textDir, "cover.xhtml"),
    makeXhtml({ lang: edition.lang, title: edition.title, body: coverBody, epubType: "cover" }),
  );

  const titleBody = `<section class="title-page" epub:type="titlepage">
  <h1>${escapeXml(edition.title)}</h1>
  <p class="subtitle">${escapeXml(edition.subtitle)}</p>
  <p class="author">${escapeXml(edition.creator)} 지음 \u00b7 ${escapeXml(edition.translator)} 옮김</p>
  <p>${escapeXml(edition.description)}</p>
  <p><a href="${ONLINE_ROOT}">${ONLINE_ROOT}</a></p>
  <p>${escapeXml(edition.attribution)}: <a href="${ORIGINAL_ROOT}">${ORIGINAL_ROOT}</a></p>
  <p>본문 CC BY-NC 4.0 \u00b7 ${latestUpdated}</p>
</section>`;
  writeFileSync(
    join(textDir, "title.xhtml"),
    makeXhtml({ lang: edition.lang, title: edition.title, body: titleBody, epubType: "titlepage" }),
  );

  const navSections = sections
    .map(({ text, items }) => {
      const links = items
        .map(({ source, text: label }) => `        <li><a href="text/${sourceToChapter.get(source)}">${escapeXml(label)}</a></li>`)
        .join("\n");
      return `      <li><span>${escapeXml(text)}</span>\n        <ol>\n${links}\n        </ol>\n      </li>`;
    })
    .join("\n");
  const navXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${edition.lang}" xml:lang="${edition.lang}">
<head><meta charset="utf-8" /><title>${escapeXml(edition.contents)}</title><link rel="stylesheet" type="text/css" href="styles/book.css" /></head>
<body><nav epub:type="toc" id="toc"><h1>${escapeXml(edition.contents)}</h1><ol>
      <li><a href="text/title.xhtml">${escapeXml(edition.title)}</a></li>
${navSections}
    </ol></nav></body>
</html>
`;
  writeFileSync(join(epubRoot, "OEBPS/nav.xhtml"), navXhtml);

  const manifestImages = [...imageTargets.values()].sort().map((target, index) => {
    const type = mediaType(target);
    if (!type) throw new Error(`EPUB가 지원하지 않는 이미지 형식입니다: ${target}`);
    return `    <item id="image-${String(index + 1).padStart(3, "0")}" href="${escapeXml(target)}" media-type="${type}" />`;
  });
  const manifestChapters = chapterRecords.map(
    ({ id, filename }) => `    <item id="${id}" href="text/${filename}" media-type="application/xhtml+xml" />`,
  );
  const spine = chapterRecords.map(({ id }) => `    <itemref idref="${id}" />`);
  const identifier = `${ONLINE_ROOT}downloads/${edition.file}`;
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${edition.lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(edition.title)}</dc:title>
    <dc:language>${edition.lang}</dc:language>
    <dc:creator id="author">${escapeXml(edition.creator)}</dc:creator>
    <meta refines="#author" property="role" scheme="marc:relators">aut</meta>
    <dc:contributor id="translator">${escapeXml(edition.translator)}</dc:contributor>
    <meta refines="#translator" property="role" scheme="marc:relators">trl</meta>
    <dc:description>${escapeXml(edition.description)}</dc:description>
    <dc:rights>CC BY-NC 4.0</dc:rights>
    <dc:source>${ORIGINAL_ROOT}</dc:source>
    <meta property="dcterms:modified">${latestUpdated}T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    <item id="css" href="styles/book.css" media-type="text/css" />
    <item id="cover-image" href="assets/cover.png" media-type="image/png" properties="cover-image" />
    <item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml" />
    <item id="title-page" href="text/title.xhtml" media-type="application/xhtml+xml" />
${manifestChapters.join("\n")}
${manifestImages.join("\n")}
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover" />
    <itemref idref="title-page" />
${spine.join("\n")}
  </spine>
</package>
`;
  writeFileSync(join(epubRoot, "OEBPS/package.opf"), opf);

  const navPoints = [
    { id: "cover", title: edition.title, href: "text/cover.xhtml" },
    { id: "title-page", title: edition.title, href: "text/title.xhtml" },
    ...chapterRecords.map(({ id, title, filename }) => ({ id, title, href: `text/${filename}` })),
  ];
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${edition.lang}">
  <head><meta name="dtb:uid" content="${escapeXml(identifier)}" /></head>
  <docTitle><text>${escapeXml(edition.title)}</text></docTitle>
  <navMap>
${navPoints.map(({ id, title, href }, index) => `    <navPoint id="${id}" playOrder="${index + 1}"><navLabel><text>${escapeXml(title)}</text></navLabel><content src="${href}" /></navPoint>`).join("\n")}
  </navMap>
</ncx>
`;
  writeFileSync(join(epubRoot, "OEBPS/toc.ncx"), ncx);

  validateEpubRoot(epubRoot, edition, chapterRecords);

  for (const file of walk(epubRoot)) utimesSync(file, fixedTime, fixedTime);
  const output = join(tempBase, edition.file);
  execFileSync("zip", ["-X0", output, "mimetype"], { cwd: epubRoot, env: zipEnv, stdio: "ignore" });
  const entries = walk(epubRoot)
    .map((file) => normalizeSource(relative(epubRoot, file)))
    .filter((file) => file !== "mimetype")
    .sort();
  execFileSync("zip", ["-X9", output, ...entries], { cwd: epubRoot, env: zipEnv, stdio: "ignore" });
  execFileSync("unzip", ["-tqq", output], { stdio: "ignore" });
  const listed = execFileSync("unzip", ["-Z1", output], { encoding: "utf8" }).trim().split("\n");
  if (listed[0] !== "mimetype") throw new Error(`${edition.file}: mimetype은 첫 번째 ZIP 항목이어야 합니다`);
  const mimetype = execFileSync("unzip", ["-p", output, "mimetype"], { encoding: "utf8" });
  if (mimetype !== "application/epub+zip") throw new Error(`${edition.file}: mimetype 내용이 틀렸습니다`);

  const sourceDigest = sha256(
    items
      .map(({ source }) => `${source}\0${sha256(readFileSync(join(DOCS, source)))}`)
      .join("\n"),
  );
  const buffer = readFileSync(output);
  if (buffer.length > 8_000_000) throw new Error(`${edition.file}: EPUB가 8MB 예산을 넘었습니다`);
  return {
    output,
    metadata: {
      file: edition.file,
      language: edition.lang,
      chapters: chapterRecords.length,
      images: imageTargets.size + 1,
      bytes: buffer.length,
      sha256: sha256(buffer),
      sourceSha256: sourceDigest,
    },
  };
}

const tempBase = mkdtempSync(join(tmpdir(), "life-level-up-epub-"));
try {
  const markdown = await createMarkdownRenderer(DOCS);
  const built = [];
  for (const edition of editions) built.push(await buildEdition(edition, markdown, tempBase));
  const manifest = `${JSON.stringify({
    version: 1,
    standard: "EPUB 3.3",
    scope: "Main manuscript, glossary, and toolkit; archive and word lists remain online-only.",
    outputs: Object.fromEntries(built.map(({ metadata }) => [metadata.language, metadata])),
  }, null, 2)}\n`;

  if (checkOnly) {
    for (const { output, metadata } of built) {
      const committed = join(OUTPUT_DIR, metadata.file);
      if (!existsSync(committed) || !readFileSync(committed).equals(readFileSync(output))) {
        throw new Error(`${relative(ROOT, committed)} 파일이 원고와 동기화되지 않았습니다. npm run book:build를 실행하세요`);
      }
    }
    const manifestFile = join(OUTPUT_DIR, "epub-manifest.json");
    if (!existsSync(manifestFile) || readFileSync(manifestFile, "utf8") !== manifest) {
      throw new Error(`${relative(ROOT, manifestFile)} 파일이 EPUB 산출물과 동기화되지 않았습니다. npm run book:build를 실행하세요`);
    }
    console.log("EPUB editions are in sync");
  } else {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    for (const { output, metadata } of built) copyFileSync(output, join(OUTPUT_DIR, metadata.file));
    writeFileSync(join(OUTPUT_DIR, "epub-manifest.json"), manifest);
    for (const { metadata } of built) {
      console.log(`updated docs/public/downloads/${metadata.file} (${metadata.chapters} chapters, ${metadata.bytes} bytes)`);
    }
  }
} finally {
  rmSync(tempBase, { recursive: true, force: true });
}
