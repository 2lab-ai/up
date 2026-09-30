#!/usr/bin/env python3

from __future__ import annotations

import argparse
from pathlib import Path
import tempfile
from xml.etree import ElementTree as ET
import zipfile

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


ROOT = Path(__file__).resolve().parents[1]
EPUB = ROOT / "docs/public/downloads/life-level-up-guide-ko.epub"
FONT_DIR = ROOT / "book-assets/fonts"
FALLBACK_FONT = FONT_DIR / "NotoSans-LifeLevelUp-IPA.ttf"
OUTPUTS = {
    400: FONT_DIR / "NotoSerifKR-LifeLevelUp-Regular.ttf",
    700: FONT_DIR / "NotoSerifKR-LifeLevelUp-Bold.ttf",
}
# Title page, running header, and metadata strings drawn by scripts/build-pdf.py.
EXTRA_TEXT = (
    "인생 레벨업 가이드 AI 시대 평생학습 가이드 한셴카이 지음 2lab.ai 옮김 차례 "
    "영어, AI, 실제 프로젝트, 인생의 바닥에서 출발해 재측정하고, 전이하고, 회복하고, "
    "책임질 수 있는 평생학습 시스템을 세웁니다. "
    "https://dosi.dev/up/ 원작: https://github.com/byoungd/up 중국어 원문을 한국어로 옮김 "
    "본문 CC BY-NC 4.0 2026-09-30 0123456789 \u2022 \u00b7 ..."
)
REQUIRED_SPACING_CHARACTERS = set(" \u00a0")
# Han ideographs are never published in the Korean edition, so they never enter the subset.
HAN_RANGES = ((0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xF900, 0xFAFF), (0x20000, 0x2FA1F))


def is_han(character: str) -> bool:
    code = ord(character)
    return any(start <= code <= end for start, end in HAN_RANGES)


def baseline_characters() -> set[str]:
    """Printable ASCII, Latin-1, common punctuation, and the 2,350 KS X 1001 Hangul syllables."""
    characters = {chr(code) for code in range(0x20, 0x7F)}
    characters.update(chr(code) for code in range(0xA0, 0x100))
    characters.update(chr(code) for code in range(0x2010, 0x2027))
    characters.update("\u2190\u2191\u2192\u2193\u00d7\u00f7\u2248\u2264\u2265\u00b1\u2026\u2022\u00b7")
    # CJK corner, double-corner, double-angle, and angle brackets used for Korean titles.
    characters.update("\u300c\u300d\u300e\u300f\u300a\u300b\u3008\u3009")
    for lead in range(0xB0, 0xC9):
        for trail in range(0xA1, 0xFF):
            characters.add(bytes([lead, trail]).decode("euc_kr"))
    return characters


def epub_characters(epub_path: Path) -> set[str]:
    characters: set[str] = set()
    with zipfile.ZipFile(epub_path) as archive:
        chapters = sorted(
            name
            for name in archive.namelist()
            if name.startswith("OEBPS/text/chapter-") and name.endswith(".xhtml")
        )
        if not chapters:
            raise ValueError(f"{epub_path}: no publication chapters found")
        for name in chapters:
            root = ET.fromstring(archive.read(name))
            for value in root.itertext():
                characters.update(value)
    return characters


def printable(characters: set[str]) -> set[str]:
    return {
        character
        for character in characters
        if (
            (character.isprintable() and not character.isspace())
            or character in REQUIRED_SPACING_CHARACTERS
        )
        and not is_han(character)
    }


def build_subset(source: Path, weight: int, characters: set[str], output: Path) -> None:
    font = TTFont(source, recalcTimestamp=False)
    if "fvar" not in font:
        raise ValueError(f"{source}: expected a variable font with a wght axis")
    font = instantiateVariableFont(
        font,
        {"wght": weight},
        inplace=True,
        optimize=True,
        updateFontNames=True,
    )
    font.recalcTimestamp = False

    options = subset.Options()
    options.drop_tables += ["DSIG"]
    options.layout_features = ["*"]
    options.glyph_names = True
    options.legacy_cmap = True
    options.symbol_cmap = True
    options.notdef_glyph = True
    options.notdef_outline = True
    options.recommended_glyphs = True
    options.name_legacy = True
    options.name_languages = ["*"]

    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text="".join(sorted(characters)))
    subsetter.subset(font)
    output.parent.mkdir(parents=True, exist_ok=True)
    font.save(output, reorderTables=True)

    generated = TTFont(output, recalcTimestamp=False)
    cmap = generated.getBestCmap() or {}
    missing = sorted(character for character in characters if ord(character) not in cmap)
    if missing:
        raise ValueError(f"{output}: generated subset misses {len(missing)} characters: {''.join(missing[:40])}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Regenerate the Korean PDF font subsets (Noto Serif KR 400/700).")
    parser.add_argument("--source-font", type=Path, required=True, help="Pinned NotoSerifKR[wght].ttf source file")
    parser.add_argument("--epub", type=Path, default=EPUB, help="Korean EPUB whose chapter text must be covered")
    parser.add_argument(
        "--baseline",
        action="store_true",
        help="Also cover the KS X 1001 Hangul syllables, Latin-1, and common punctuation; allows a missing EPUB",
    )
    parser.add_argument(
        "--text",
        type=Path,
        action="append",
        default=[],
        help="Extra UTF-8 files (for example Markdown sources) whose non-Han characters must be covered",
    )
    args = parser.parse_args()
    source = args.source_font.resolve()
    if not source.exists():
        raise FileNotFoundError(source)

    characters = set(EXTRA_TEXT)
    if args.epub.exists():
        characters |= epub_characters(args.epub)
    elif not args.baseline:
        raise FileNotFoundError(f"{args.epub}: build the Korean EPUB first or pass --baseline")
    for path in args.text:
        characters |= set(path.read_text(encoding="utf-8"))
    characters = printable(characters)

    # Characters absent from Noto Serif KR (for example IPA letters) are drawn with the Noto Sans fallback.
    source_cmap = TTFont(source, lazy=True).getBestCmap() or {}
    fallback_cmap = TTFont(FALLBACK_FONT, lazy=True).getBestCmap() or {}
    if args.baseline:
        # Baseline coverage is best effort: keep only what the source font can draw.
        characters |= {character for character in printable(baseline_characters()) if ord(character) in source_cmap}
    uncovered = sorted(character for character in characters if ord(character) not in source_cmap)
    unrenderable = [character for character in uncovered if ord(character) not in fallback_cmap]
    if unrenderable:
        raise ValueError(
            f"neither {source.name} nor {FALLBACK_FONT.name} covers {len(unrenderable)} characters: "
            f"{''.join(unrenderable[:40])}"
        )
    characters -= set(uncovered)
    if uncovered:
        print(f"fallback font covers {len(uncovered)} characters: {''.join(uncovered)}")

    with tempfile.TemporaryDirectory(prefix="life-level-up-fonts-") as temp_dir:
        generated = {}
        for weight, destination in OUTPUTS.items():
            target = Path(temp_dir) / destination.name
            build_subset(source, weight, characters, target)
            generated[destination] = target
        for destination, target in generated.items():
            destination.write_bytes(target.read_bytes())
            print(f"updated {destination.relative_to(ROOT)} ({destination.stat().st_size} bytes, {len(characters)} characters)")


if __name__ == "__main__":
    main()
