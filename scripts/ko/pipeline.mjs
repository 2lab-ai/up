#!/usr/bin/env node
// Korean translation pipeline entry point.
//   node scripts/ko/pipeline.mjs <glossary|translate|gates|anchors|review|polish|audit|readme|manifest|all|sync> [--only <path> ...]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGlossary, runGlossarySupplement, mergeSupplement, GLOSSARY_PATH } from "./glossary.mjs";
import { runTranslate } from "./translate.mjs";
import { runAnchors } from "./anchors.mjs";
import { runReview } from "./review.mjs";
import { runPolish } from "./polish.mjs";
import { runAudit } from "./audit.mjs";
import { mirrorReadme } from "./lib/readme.mjs";
import { runManifest, MANIFEST_PATH } from "./manifest.mjs";
import { checkFile } from "./lib/gates.mjs";
import { countHan } from "./lib/markdown.mjs";
import { isChineseSource, ownedFiles, readJson, readSource, readText, ROOT, sha256, writeText } from "./config.mjs";

const [command = "help", ...rest] = process.argv.slice(2);
const onlyIndex = rest.indexOf("--only");
const only = onlyIndex > -1 ? rest.slice(onlyIndex + 1) : null;

// Final gate pass over the working tree: Han must be 0 everywhere (fragments included, since step 4 ran).
export function runGates() {
  const rows = [];
  for (const path of ownedFiles().filter((p) => !only || only.includes(p))) {
    const source = readSource(path);
    const output = readFileSync(join(ROOT, path), "utf8");
    const zhSource = isChineseSource(source);
    const gate = checkFile({ source, output, zhSource, allowFragmentHan: false });
    rows.push({ path, han: countHan(output), defects: gate.defects, warnings: gate.warnings, ratio: gate.metrics.ratio });
  }
  return rows;
}

function printGates(rows) {
  const failing = rows.filter((r) => r.defects.length);
  const outliers = rows.filter((r) => r.warnings.length);
  console.log(`gates: files=${rows.length} failing=${failing.length} han_total=${rows.reduce((n, r) => n + r.han, 0)} ratio_outliers=${outliers.length}`);
  for (const r of failing) console.log(`FAIL ${r.path}\n  ${r.defects.join("\n  ")}`);
  for (const r of outliers) console.log(`READ ${r.path}: ${r.warnings.join("; ")}`);
  return failing.length;
}

// Upstream sync: translate only files whose source hash differs from manifest.json (set KO_SOURCE_REF).
function changedSinceManifest() {
  const manifest = readJson(MANIFEST_PATH, { files: {} });
  return ownedFiles().filter((p) => manifest.files[p]?.source_sha256 !== sha256(readSource(p)));
}

switch (command) {
  case "glossary": {
    // First pass writes the base glossary; `--supplement` appends names/terms found in the whole corpus.
    // Review .ko-work/glossary*.raw.md by hand before translating (see README).
    if (rest.includes("--supplement")) {
      const supplement = await runGlossarySupplement({ force: rest.includes("--force") });
      const merged = mergeSupplement(readText(GLOSSARY_PATH), supplement.text);
      console.log(`supplement: ${merged.added} new rows`);
      if (rest.includes("--write")) writeText(GLOSSARY_PATH, merged.text);
      break;
    }
    const { text, check } = await runGlossary({ force: rest.includes("--force") });
    if (rest.includes("--write")) writeText(GLOSSARY_PATH, `${text}\n`);
    process.exitCode = check.problems.length ? 1 : 0;
    break;
  }
  case "translate":
    await runTranslate({ only, force: rest.includes("--force") });
    break;
  case "anchors": {
    const report = runAnchors({ write: true });
    console.log(`anchors: headings=${report.headingCount} fragments=${report.checked} rewrites=${report.rewrites.length} unresolved=${report.unresolved.length} misaligned=${report.misaligned.length}`);
    for (const u of report.unresolved) console.log(`UNRESOLVED ${u.file}: ${u.link} (${u.reason})`);
    process.exitCode = report.unresolved.length ? 1 : 0;
    break;
  }
  case "gates":
    process.exitCode = printGates(runGates()) ? 1 : 0;
    break;
  case "review":
    console.log(JSON.stringify(await runReview({ only }), null, 2));
    break;
  case "polish":
    console.log(JSON.stringify(await runPolish({ only }), null, 2));
    break;
  case "readme":
    console.log(`README.md mirror of docs/README.md: ${mirrorReadme().changed ? "rewritten" : "already in sync"}`);
    break;
  case "audit":
    console.log(JSON.stringify(await runAudit({ only }), null, 2));
    break;
  case "manifest":
    runManifest();
    break;
  case "sync": {
    const changed = changedSinceManifest();
    console.log(`changed sources: ${changed.length}\n${changed.join("\n")}`);
    if (changed.length) {
      await runTranslate({ only: changed });
      runAnchors({ write: true });
      await runReview({ only: changed });
      await runPolish({ only: changed });
      await runAudit({ only: changed });
      mirrorReadme();
      runAnchors({ write: true });
      process.exitCode = printGates(runGates()) ? 1 : 0;
      runManifest();
    }
    break;
  }
  case "all": {
    await runTranslate({ only });
    runAnchors({ write: true });
    await runReview({ only });
    await runPolish({ only });
    await runAudit({ only });
    mirrorReadme();
    runAnchors({ write: true });
    const failing = printGates(runGates());
    runManifest();
    process.exitCode = failing ? 1 : 0;
    break;
  }
  default:
    console.log("usage: node scripts/ko/pipeline.mjs <glossary [--write] [--supplement]|translate|anchors|gates|review|polish|audit|readme|manifest|all|sync> [--only <path> ...]");
}
