// Parse scripts/ko/glossary.md and pick the rows relevant to one source file.
import { readText } from "../config.mjs";

export function parseGlossary(path) {
  const rows = [];
  let section = "";
  for (const line of readText(path).split("\n")) {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    if (!/^\|/.test(line) || /^\|\s*:?-{2,}/.test(line) || /^\|\s*zh\s*\|/.test(line)) continue;
    const cells = line
      .replace(/\\\|/g, "\u0000")
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.replace(/\u0000/g, "\\|").trim());
    if (cells.length !== 3 || !cells[0]) continue;
    rows.push({ section, zh: cells[0], en: cells[1], ko: cells[2], line });
  }
  return rows;
}

const unescape = (cell) => cell.replace(/\\\|/g, "|");

export function relevantRows(rows, source, { zhSource }) {
  const haystack = zhSource ? source : source.toLowerCase();
  return rows.filter((row) => {
    if (row.section === "고정 용어") return true;
    if (zhSource) return source.includes(unescape(row.zh));
    const en = unescape(row.en).toLowerCase();
    if (en.length >= 3 && haystack.includes(en)) return true;
    return /\p{Script=Han}/u.test(row.zh) && source.includes(unescape(row.zh));
  });
}

// Sections whose Korean is a default rendering of an everyday word, not a fixed term.
export const SOFT_SECTIONS = new Set(["반복 개념"]);

export function renderRows(rows) {
  const bySection = new Map();
  for (const row of rows) {
    if (!bySection.has(row.section)) bySection.set(row.section, []);
    bySection.get(row.section).push(row);
  }
  const blocks = [];
  for (const [section, sectionRows] of bySection) {
    const note = SOFT_SECTIONS.has(section)
      ? "기본 대응어 — 뜻을 지키는 한 문맥에 더 자연스러운 말을 써도 된다"
      : "고정 — 글자 그대로 쓴다";
    blocks.push(
      [`### ${section} (${note})`, "| zh | en | ko |", "|---|---|---|", ...sectionRows.map((r) => `| ${r.zh} | ${r.en} | ${r.ko} |`)].join("\n"),
    );
  }
  return blocks.join("\n\n");
}
