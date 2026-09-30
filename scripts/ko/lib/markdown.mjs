// Markdown structure helpers for the Korean translation gates. Zero dependencies.

// Verbatim copy of VitePress 1.6.4's slugify (dist/node/chunk-D3CUZ4fa.js, from @mdit-vue/shared).
// NFKD decomposes Hangul syllables into conjoining jamo, so Korean ids are *decomposed* strings;
// a link fragment must use exactly this form to match the rendered id.
const rControl = /[\u0000-\u001f]/g;
const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g;
const rCombining = /[̀-ͯ]/g;
export const slugify = (str) =>
  str
    .normalize("NFKD")
    .replace(rCombining, "")
    .replace(rControl, "")
    .replace(rSpecial, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^(\d)/, "_$1")
    .toLowerCase();

export const HAN = /\p{Script=Han}/gu;
export const countHan = (text) => (text.match(HAN) || []).length;

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

export function splitFrontmatter(text) {
  const match = text.match(FRONTMATTER);
  if (!match) return { raw: null, body: text, bodyOffsetLines: 0 };
  return { raw: match[1], body: text.slice(match[0].length), bodyOffsetLines: match[0].split("\n").length - 1 };
}

// ---- Minimal YAML subset (what these pages use): top-level `key: scalar` and one nested map level.
const YAML_SPECIAL_START = /^[-?:,[\]{}#&*!|>'"%@`]/;

export function plainNeedsQuotes(value) {
  if (value === "") return false;
  return YAML_SPECIAL_START.test(value) || /:(\s|$)/.test(value) || /\s#/.test(value) || /^\s|\s$/.test(value);
}

function decodeScalar(rawValue) {
  const value = rawValue.trim();
  if (value.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(value)) return { error: `malformed double-quoted value: ${value}` };
    try {
      return { value: JSON.parse(value), quoted: '"' };
    } catch {
      return { error: `bad escape in double-quoted value: ${value}` };
    }
  }
  if (value.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(value)) return { error: `malformed single-quoted value: ${value}` };
    return { value: value.slice(1, -1).replace(/''/g, "'"), quoted: "'" };
  }
  if (plainNeedsQuotes(value)) return { error: `plain value needs quotes: ${value}`, value, quoted: "" };
  return { value, quoted: "" };
}

// Returns { entries: [{path, value, quoted, lineIndex}], errors: [] }
export function parseFrontmatter(raw) {
  const entries = [];
  const errors = [];
  if (raw == null) return { entries, errors };
  let parent = null;
  raw.split("\n").forEach((line, lineIndex) => {
    if (!line.trim() || /^\s*#/.test(line)) return;
    const nested = line.match(/^( {2,})([A-Za-z_][\w-]*):(?:\s(.*))?$/);
    const top = line.match(/^([A-Za-z_][\w-]*):(?:\s(.*))?$/);
    if (top) {
      const rest = (top[2] ?? "").trim();
      if (rest === "") {
        parent = top[1];
        entries.push({ path: top[1], value: null, quoted: "", lineIndex, container: true });
        return;
      }
      parent = null;
      const decoded = decodeScalar(rest);
      if (decoded.error) errors.push(`line ${lineIndex + 2}: ${decoded.error}`);
      entries.push({ path: top[1], value: decoded.value ?? rest, quoted: decoded.quoted ?? "", lineIndex });
      return;
    }
    if (nested && parent) {
      const rest = (nested[3] ?? "").trim();
      const decoded = decodeScalar(rest);
      if (decoded.error) errors.push(`line ${lineIndex + 2}: ${decoded.error}`);
      entries.push({ path: `${parent}.${nested[2]}`, value: decoded.value ?? rest, quoted: decoded.quoted ?? "", lineIndex });
      return;
    }
    errors.push(`line ${lineIndex + 2}: unsupported frontmatter line: ${line}`);
  });
  return { entries, errors };
}

// Force double quotes on plain values that YAML (or scripts/check-content.mjs) would reject.
export function fixFrontmatterQuoting(text) {
  const match = text.match(FRONTMATTER);
  if (!match) return { text, changed: 0 };
  let changed = 0;
  const lines = match[1].split("\n").map((line) => {
    const m = line.match(/^(\s*[A-Za-z_][\w-]*:\s)(.+)$/);
    if (!m) return line;
    const value = m[2].trim();
    if (value.startsWith('"') || value.startsWith("'")) return line;
    if (!plainNeedsQuotes(value) && !/:\s/.test(value)) return line;
    changed += 1;
    return `${m[1]}${JSON.stringify(value)}`;
  });
  return { text: `---\n${lines.join("\n")}\n---\n${text.slice(match[0].length)}`, changed };
}

// ---- Body structure
const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s+\S/;

const stripInlineCode = (line) => line.replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, (m) => " ".repeat(m.length));

function tableColumns(separator) {
  return separator.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").length;
}

export function analyze(text) {
  const { raw: frontmatterRaw, body } = splitFrontmatter(text);
  const lines = body.split("\n");
  const result = {
    frontmatter: parseFrontmatter(frontmatterRaw),
    headings: [],
    fences: [],
    tables: [],
    listItems: 0,
    blockquoteLines: 0,
    containers: 0,
    htmlTags: {},
    links: [],
    outsideCode: [],
  };
  let fence = null;
  let tableRows = 0;
  let tableCols = 0;
  const closeTable = () => {
    if (tableRows) result.tables.push({ rows: tableRows, cols: tableCols });
    tableRows = 0;
    tableCols = 0;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      continue;
    }
    const open = line.match(FENCE_OPEN);
    if (open && !(open[2][0] === "`" && open[3].includes("`"))) {
      closeTable();
      fence = { char: open[2][0], length: open[2].length };
      result.fences.push(open[3].trim().split(/\s+/)[0] || "");
      continue;
    }
    result.outsideCode.push(line);
    let content = line;
    if (/^\s*>/.test(content)) {
      result.blockquoteLines += 1;
      content = content.replace(/^(\s*>\s?)+/, "");
    }
    const isTableRow = /^\s*\|/.test(content);
    if (isTableRow) {
      if (tableRows === 0) {
        const next = (lines[index + 1] || "").replace(/^(\s*>\s?)+/, "");
        if (TABLE_SEPARATOR.test(next)) {
          tableRows = 1;
          tableCols = tableColumns(next);
          continue;
        }
      } else {
        tableRows += 1;
        continue;
      }
    } else {
      closeTable();
    }
    const heading = content.match(HEADING);
    if (heading && !/^\s*>/.test(line)) {
      result.headings.push({ level: heading[1].length, text: (heading[2] || "").trim(), line: index });
      continue;
    }
    if (/^\s*:::/.test(content)) result.containers += 1;
    if (LIST_ITEM.test(content)) result.listItems += 1;
    const scan = stripInlineCode(content);
    for (const tag of scan.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g)) {
      const name = tag[1].toLowerCase();
      result.htmlTags[name] = (result.htmlTags[name] || 0) + 1;
    }
  }
  closeTable();
  result.links = extractLinks(result.outsideCode.join("\n"));
  return result;
}

// Link targets: markdown links/images, HTML href/src, and bare URLs (linkify is on in VitePress).
export function extractLinks(textOutsideFences) {
  const text = stripInlineCode(textOutsideFences);
  const targets = [];
  const consumed = [];
  const mdLink = /(!?)\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
  for (const m of text.matchAll(mdLink)) {
    targets.push({ kind: m[1] ? "image" : "link", target: m[3].replace(/^<|>$/g, "") });
    consumed.push([m.index, m.index + m[0].length]);
  }
  for (const m of text.matchAll(/\b(href|src)\s*=\s*"([^"]*)"/g)) {
    targets.push({ kind: m[1], target: m[2] });
    consumed.push([m.index, m.index + m[0].length]);
  }
  for (const m of text.matchAll(/<(https?:\/\/[^>\s]+)>/g)) {
    targets.push({ kind: "autolink", target: m[1] });
    consumed.push([m.index, m.index + m[0].length]);
  }
  // ASCII-only URL body: a Korean particle or Chinese punctuation right after a bare URL is not part of it.
  for (const m of text.matchAll(/https?:\/\/[A-Za-z0-9\-._~:/?#@!$&*+,;=%]+/g)) {
    if (consumed.some(([a, b]) => m.index >= a && m.index < b)) continue;
    targets.push({ kind: "bare", target: m[0].replace(/[.,;:!?]+$/, "") });
  }
  return targets;
}

export const isExternal = (target) => /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");

// Target used for parity: relative/internal fragments are compared in the anchor step instead.
export function parityTarget(target) {
  let t = target;
  try {
    t = decodeURI(t);
  } catch {
    /* keep raw */
  }
  if (!isExternal(t)) t = t.replace(/#.*$/, "");
  return t;
}

// Headings with VitePress ids (markdown-it-anchor uniqueSlug: slug, slug-1, slug-2 … per page).
export function headingsWithIds(text) {
  const seen = new Set();
  return analyze(text).headings.map((h) => {
    const base = slugify(h.text);
    let id = base;
    let i = 1;
    while (seen.has(id)) {
      id = `${base}-${i}`;
      i += 1;
    }
    seen.add(id);
    return { ...h, slug: base, id };
  });
}
