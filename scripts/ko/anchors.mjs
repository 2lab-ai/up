// Step 4: heading map (every heading, zh → ko → VitePress id) + rewrite internal #fragments to Korean ids.
// Ids are computed with VitePress 1.6.4's own slugify (NFKD), so Korean ids are jamo-decomposed strings;
// fragments are written percent-encoded, which VitePress decodes (router: decodeURIComponent(hash)).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { headingsWithIds, isExternal } from "./lib/markdown.mjs";
import { KO_DIR, ROOT, ownedFiles, readSource, writeJson } from "./config.mjs";

export const HEADING_MAP_PATH = join(KO_DIR, "heading-map.json");

function resolveTarget(fromPath, linkPath) {
  if (!linkPath) return fromPath;
  let base = linkPath.startsWith("/") ? join("docs", linkPath) : join(dirname(fromPath), linkPath);
  base = normalize(base);
  const candidates = [base, `${base}.md`, join(base, "README.md"), join(base, "index.md"), base.replace(/\.html$/, ".md")];
  return candidates.find((c) => c.endsWith(".md") && existsSync(join(ROOT, c))) ?? null;
}

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function buildHeadingMap(files) {
  const map = {};
  for (const path of files) {
    const zh = headingsWithIds(readSource(path));
    const ko = headingsWithIds(readFileSync(join(ROOT, path), "utf8"));
    const aligned = zh.length === ko.length && zh.every((h, i) => h.level === ko[i].level);
    map[path] = {
      aligned,
      headings: zh.map((h, i) => ({
        level: h.level,
        zh: h.text,
        ko: ko[i]?.text ?? null,
        zh_slug: h.id,
        ko_slug: ko[i]?.id ?? null,
      })),
    };
  }
  return map;
}

const LINK = /(\]\(\s*<?|\bhref=")([^)\s">#]*)#([^)\s">]+)/g;

// Rewrite fragments in one translated file; returns { text, rewrites, unresolved, checked }.
export function rewriteFragments(path, text, headingMap) {
  const rewrites = [];
  const unresolved = [];
  let checked = 0;
  const out = text.replace(LINK, (whole, open, linkPath, fragment) => {
    if (isExternal(linkPath)) return whole;
    checked += 1;
    const target = resolveTarget(path, linkPath);
    const entry = target && headingMap[target];
    const wanted = safeDecode(fragment);
    if (!entry) {
      unresolved.push({ link: `${linkPath}#${fragment}`, reason: `target not found or not translated (${target})` });
      return whole;
    }
    if (entry.headings.some((h) => h.ko_slug === wanted)) return whole;
    const index = entry.headings.findIndex((h) => h.zh_slug === wanted);
    if (index < 0 || !entry.aligned || !entry.headings[index].ko_slug) {
      unresolved.push({ link: `${linkPath}#${fragment}`, reason: index < 0 ? "no heading with this id" : "heading map not aligned" });
      return whole;
    }
    const koSlug = entry.headings[index].ko_slug;
    rewrites.push({ from: `${linkPath}#${wanted}`, to: `${linkPath}#${koSlug.normalize("NFC")}`, heading: entry.headings[index].ko });
    return `${open}${linkPath}#${encodeURIComponent(koSlug)}`;
  });
  return { text: out, rewrites, unresolved, checked };
}

export function runAnchors({ write = true } = {}) {
  const files = ownedFiles();
  const headingMap = buildHeadingMap(files);
  const report = { rewrites: [], unresolved: [], checked: 0 };
  for (const path of files) {
    const abs = join(ROOT, path);
    const text = readFileSync(abs, "utf8");
    const result = rewriteFragments(path, text, headingMap);
    report.checked += result.checked;
    report.rewrites.push(...result.rewrites.map((r) => ({ file: path, ...r })));
    report.unresolved.push(...result.unresolved.map((u) => ({ file: path, ...u })));
    if (write && result.text !== text) writeFileSync(abs, result.text);
  }
  const misaligned = Object.entries(headingMap).filter(([, v]) => !v.aligned).map(([k]) => k);
  if (write) {
    writeJson(HEADING_MAP_PATH, {
      note: "Every heading per translated file, positional zh→ko. *_slug = the id VitePress 1.6.4 renders (slugify = NFKD, so Korean ids are jamo-decomposed; duplicates get -1, -2 …). Link to them percent-encoded: encodeURIComponent(ko_slug).",
      files: headingMap,
    });
  }
  return { ...report, misaligned, headingCount: Object.values(headingMap).reduce((n, v) => n + v.headings.length, 0) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = runAnchors({ write: !process.argv.includes("--check") });
  console.log(`headings=${report.headingCount} misaligned=${report.misaligned.length} fragments_checked=${report.checked} rewrites=${report.rewrites.length} unresolved=${report.unresolved.length}`);
  for (const r of report.rewrites) console.log(`  rewrite ${r.file}: ${r.from} -> ${r.to}`);
  for (const u of report.unresolved) console.log(`  UNRESOLVED ${u.file}: ${u.link} (${u.reason})`);
  for (const m of report.misaligned) console.log(`  MISALIGNED ${m}`);
  if (report.unresolved.length) process.exitCode = 1;
}
