// Mechanical gates for one translated file (step 3 of the pipeline).
import { analyze, countHan, fixFrontmatterQuoting, isExternal, parityTarget, splitFrontmatter } from "./markdown.mjs";

// Full-width Chinese punctuation + the whole full-width ASCII block. 「」 are NOT here: the style guide
// mandates 「…」 for article/chapter titles, so they are checked for pairing instead.
const FULLWIDTH = /[（），。：；！？、【】《》！-～]/gu;
const UNTRANSLATABLE_FM = /^(updated|sources_checked|.*\.link|link|layout)$/;

const nonSpace = (text) => text.replace(/\s+/g, "").length;

export function normalizeOutput(source, output) {
  let text = output.replace(/\r\n/g, "\n");
  const fenced = text.match(/^\s*```[a-zA-Z]*\n([\s\S]*?)\n```\s*$/);
  if (fenced && !source.trimStart().startsWith("```")) text = fenced[1];
  text = text.replace(/^\s+(?=---\n)/, "");
  text = text.replace(/\s+$/, "");
  if (source.endsWith("\n")) text += "\n";
  const quoted = fixFrontmatterQuoting(text);
  return { text: quoted.text, quotedValues: quoted.changed };
}

function multiset(items) {
  const map = new Map();
  for (const item of items) map.set(item, (map.get(item) || 0) + 1);
  return map;
}

function diffMultiset(a, b) {
  const ma = multiset(a);
  const mb = multiset(b);
  const missing = [];
  const extra = [];
  for (const [k, n] of ma) if ((mb.get(k) || 0) < n) missing.push(`${k} ×${n - (mb.get(k) || 0)}`);
  for (const [k, n] of mb) if ((ma.get(k) || 0) < n) extra.push(`${k} ×${n - (ma.get(k) || 0)}`);
  return { missing, extra };
}

// Han characters that sit inside internal link fragments are rewritten by the anchor step.
function hanOutsideInternalFragments(text) {
  const masked = text.replace(/(\]\(\s*<?|href=")([^)\s">]*?)(#[^)\s">]*)/g, (m, open, path, fragment) =>
    isExternal(path) ? m : `${open}${path}${"#".padEnd(fragment.length, "x")}`,
  );
  return masked;
}

function hanReport(text, limit = 8) {
  const lines = [];
  text.split("\n").forEach((line, i) => {
    if (countHan(line) && lines.length < limit) lines.push(`줄 ${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  return lines;
}

export function checkFile({ source, output, zhSource, allowFragmentHan = true }) {
  const defects = [];
  const warnings = [];
  const src = analyze(source);
  const out = analyze(output);

  // a. Han = 0 (frontmatter included)
  const hanText = allowFragmentHan ? hanOutsideInternalFragments(output) : output;
  const han = countHan(hanText);
  if (han) defects.push(`[a] 한자 ${han}자가 남았다 — 모두 한국어로 옮겨라:\n    ${hanReport(hanText).join("\n    ")}`);

  // b. structure parity
  const srcKeys = src.frontmatter.entries.map((e) => e.path);
  const outKeys = out.frontmatter.entries.map((e) => e.path);
  if (srcKeys.join(",") !== outKeys.join(",")) defects.push(`[b] frontmatter 키가 다르다: 원문 [${srcKeys}] / 번역 [${outKeys}]`);
  for (const entry of src.frontmatter.entries) {
    if (!UNTRANSLATABLE_FM.test(entry.path) || entry.container) continue;
    const got = out.frontmatter.entries.find((e) => e.path === entry.path);
    if (got && got.value !== entry.value) defects.push(`[b] frontmatter ${entry.path} 값은 바꾸면 안 된다: 원문 "${entry.value}" / 번역 "${got.value}"`);
  }
  const levels = (a) => a.headings.map((h) => h.level).join(",");
  if (levels(src) !== levels(out)) {
    defects.push(
      `[b] 제목 수·레벨 순서가 다르다 (원문 ${src.headings.length}개, 번역 ${out.headings.length}개). 원문 제목 순서:\n    ${src.headings
        .map((h) => `${"#".repeat(h.level)} ${h.text}`)
        .join("\n    ")}\n  번역 제목 순서:\n    ${out.headings.map((h) => `${"#".repeat(h.level)} ${h.text}`).join("\n    ")}`,
    );
  }
  if (src.fences.join("|") !== out.fences.join("|")) defects.push(`[b] 코드펜스가 다르다: 원문 ${src.fences.length}개 [${src.fences}] / 번역 ${out.fences.length}개 [${out.fences}]`);
  const tables = (a) => a.tables.map((t) => `${t.rows}x${t.cols}`).join(",");
  if (tables(src) !== tables(out)) defects.push(`[b] 표(행x열)가 다르다: 원문 [${tables(src)}] / 번역 [${tables(out)}]`);
  if (src.listItems !== out.listItems) defects.push(`[b] 목록 항목 수가 다르다: 원문 ${src.listItems}개 / 번역 ${out.listItems}개`);
  if (src.blockquoteLines !== out.blockquoteLines) defects.push(`[b] 인용(>) 줄 수가 다르다: 원문 ${src.blockquoteLines} / 번역 ${out.blockquoteLines}`);
  if (src.containers !== out.containers) defects.push(`[b] ::: 컨테이너 줄 수가 다르다: 원문 ${src.containers} / 번역 ${out.containers}`);
  const tagDiff = diffMultiset(
    Object.entries(src.htmlTags).flatMap(([k, n]) => Array(n).fill(`<${k}>`)),
    Object.entries(out.htmlTags).flatMap(([k, n]) => Array(n).fill(`<${k}>`)),
  );
  if (tagDiff.missing.length || tagDiff.extra.length) defects.push(`[b] HTML 태그가 다르다: 빠짐 [${tagDiff.missing}] / 추가 [${tagDiff.extra}]`);
  const linkDiff = diffMultiset(
    src.links.map((l) => `${l.kind}:${parityTarget(l.target)}`),
    out.links.map((l) => `${l.kind}:${parityTarget(l.target)}`),
  );
  if (linkDiff.missing.length || linkDiff.extra.length) defects.push(`[b] 링크·이미지 대상이 다르다(대상은 한 글자도 바꾸지 마라): 빠짐 [${linkDiff.missing.join(", ")}] / 추가·변형 [${linkDiff.extra.join(", ")}]`);

  // c. length sanity (zh sources only; outliers are read by a human, not auto-failed)
  const ratio = nonSpace(output) / Math.max(1, nonSpace(source));
  if (zhSource && (ratio < 0.9 || ratio > 2.6)) warnings.push(`[c] length ratio ${ratio.toFixed(2)} outside [0.9, 2.6]`);

  // d. leftover full-width punctuation outside code
  const outside = out.outsideCode.map((l) => l.replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, "")).join("\n");
  const fullwidth = [...outside.matchAll(FULLWIDTH)].map((m) => m[0]);
  if (fullwidth.length) defects.push(`[d] 전각 문장부호 ${fullwidth.length}개가 남았다 [${[...new Set(fullwidth)].join(" ")}] — 한국어 규범 부호로 바꿔라`);
  outside.split("\n").forEach((line, i) => {
    const open = (line.match(/「/g) || []).length;
    const close = (line.match(/」/g) || []).length;
    if (open !== close) defects.push(`[d] 「」 짝이 맞지 않는다 (본문 줄 ${i + 1}): ${line.trim().slice(0, 80)}`);
  });

  // e. frontmatter YAML validity + scripts/check-content.mjs quoting rule
  for (const error of out.frontmatter.errors) defects.push(`[e] frontmatter YAML: ${error}`);
  const rawBlock = splitFrontmatter(output).raw;
  if (rawBlock) {
    rawBlock.split("\n").forEach((line, index) => {
      const value = line.match(/^[a-zA-Z][\w-]*:\s*(.+)$/)?.[1]?.trim();
      if (value && !/^['"]/.test(value) && /:\s/.test(value)) defects.push(`[e] frontmatter ${index + 2}행: 콜론이 든 값은 따옴표로 감싸야 한다`);
    });
  }

  return {
    defects,
    warnings,
    metrics: {
      han,
      ratio: Number(ratio.toFixed(3)),
      headings: out.headings.length,
      links: out.links.length,
      tables: out.tables.length,
      listItems: out.listItems,
      fences: out.fences.length,
    },
  };
}
