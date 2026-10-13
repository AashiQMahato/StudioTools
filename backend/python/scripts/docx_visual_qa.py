"""
Visual QA for PDF → Word: converts each test PDF, turns the Word file back into a PDF with LibreOffice (headless),
renders both, and measures what a reader would notice — pages, text kept, overlapping or clipped text, how much of
the ink lands in the same place, rules and pictures. Side-by-side renders go to tests/docx_fixtures/out/.

    .venv/bin/python scripts/docx_visual_qa.py                 # every PDF in tests/docx_fixtures (+ .cache)
    .venv/bin/python scripts/docx_visual_qa.py invoice columns  # just these

Digital pages only (scans need OCR lines, which the Node pipeline provides; see the scanned test in the API QA).
Needs LibreOffice (soffice) on the PATH or in /Applications.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "image_service"))
FIXTURES = HERE / "tests" / "docx_fixtures"
OUT = FIXTURES / "out"


def soffice() -> str | None:
    for candidate in (shutil.which("soffice"), "/Applications/LibreOffice.app/Contents/MacOS/soffice"):
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def to_pdf(docx: Path) -> Path:
    with tempfile.TemporaryDirectory() as profile:
        subprocess.run([soffice(), f"-env:UserInstallation=file://{profile}", "--headless", "--convert-to", "pdf", "--outdir", str(docx.parent), str(docx)], check=True, capture_output=True, timeout=180)
    return docx.with_suffix(".pdf")


def render(pdf: Path, scale: float = 1.5):
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(str(pdf))
    pages = [doc[i].render(scale=scale).to_pil().convert("L") for i in range(len(doc))]
    sizes = [doc[i].get_size() for i in range(len(doc))]
    doc.close()
    return pages, sizes


WORD = re.compile(r"[\wऀ-ॿ]+", re.UNICODE)


def words(text: str):
    return WORD.findall(text.lower())


def dice(a: list[str], b: list[str]) -> float:
    from collections import Counter

    ca, cb = Counter(a), Counter(b)
    total = sum(ca.values()) + sum(cb.values())
    return 1.0 if not total else 2 * sum((ca & cb).values()) / total


def text_issues(pdf: Path):
    """Overlapping glyphs from different lines, and glyphs outside the page, in the converted PDF."""
    import pdfplumber

    overlaps, clipped, texts = [], [], []
    with pdfplumber.open(str(pdf)) as doc:
        for page in doc.pages:
            chars = [c for c in page.chars if c["text"].strip()]
            texts.append(" ".join(w["text"] for w in page.extract_words(x_tolerance=1.5)))
            clipped.append(sum(1 for c in chars if c["x0"] < -1 or c["x1"] > page.width + 1 or c["top"] < -1 or c["bottom"] > page.height + 1))
            count = 0
            grid: dict[tuple[int, int], list] = {}
            for c in chars:
                key = (int(c["x0"] // 20), int(c["top"] // 20))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        for o in grid.get((key[0] + dx, key[1] + dy), []):
                            if abs(o["top"] - c["top"]) < 0.5 * min(o["size"], c["size"]):
                                continue  # same line: neighbours touch, that's fine
                            ix = min(o["x1"], c["x1"]) - max(o["x0"], c["x0"])
                            iy = min(o["bottom"], c["bottom"]) - max(o["top"], c["top"])
                            if ix > 0 and iy > 0:
                                small = min((o["x1"] - o["x0"]) * (o["bottom"] - o["top"]), (c["x1"] - c["x0"]) * (c["bottom"] - c["top"]))
                                if small and ix * iy > 0.3 * small:
                                    count += 1
                grid.setdefault(key, []).append(c)
            overlaps.append(count)
    return overlaps, clipped, texts


def original_text(pdf: Path):
    import pdfplumber

    with pdfplumber.open(str(pdf)) as doc:
        return [" ".join(w["text"] for w in page.extract_words(x_tolerance=1.5)) for page in doc.pages]


def ink_iou(a, b) -> float:
    """How much ink lands in the same place (each mask dilated a little, so a 1–2 px shift isn't a miss)."""
    import cv2

    b = b.resize(a.size)
    ma = (np.asarray(a) < 160).astype(np.uint8)
    mb = (np.asarray(b) < 160).astype(np.uint8)
    kernel = np.ones((5, 5), np.uint8)
    da, db = cv2.dilate(ma, kernel), cv2.dilate(mb, kernel)
    inter = ((ma & db).sum() + (mb & da).sum()) / 2
    union = ma.sum() + mb.sum() - inter
    return float(inter / union) if union else 1.0


def counts(pdf: Path):
    import pdfplumber

    rules, images = [], []
    with pdfplumber.open(str(pdf)) as doc:
        for page in doc.pages:
            shapes = [*page.lines, *page.rects]
            rules.append(sum(1 for s in shapes if (s["bottom"] - s["top"] <= 2.5 and s["x1"] - s["x0"] > 8) or (s["x1"] - s["x0"] <= 2.5 and s["bottom"] - s["top"] > 8)))
            images.append(len(page.images))
    return rules, images


def side_by_side(a, b, path: Path):
    from PIL import Image

    b = b.resize(a.size)
    sheet = Image.new("L", (a.width * 2 + 10, a.height), 255)
    sheet.paste(a, (0, 0))
    sheet.paste(b, (a.width + 10, 0))
    sheet.save(path)


def run(name: str, pdf: Path):
    from pdf_docx import build_docx
    import pypdfium2 as pdfium

    OUT.mkdir(exist_ok=True)
    docx = OUT / f"{name}.docx"
    count = len(pdfium.PdfDocument(str(pdf)))
    build_docx(str(pdf), str(docx), [{"index": i, "mode": "text"} for i in range(count)])
    converted = to_pdf(docx)
    original_pages, _ = render(pdf)
    converted_pages, _ = render(converted)
    overlaps, clipped, texts = text_issues(converted)
    src_texts = original_text(pdf)
    rules_a, images_a = counts(pdf)
    rules_b, images_b = counts(converted)
    rows = []
    for i, page in enumerate(original_pages):
        other = converted_pages[i] if i < len(converted_pages) else None
        if other is not None:
            side_by_side(page, other, OUT / f"{name}-p{i + 1}.png")
        rows.append(
            {
                "page": i + 1,
                "text": round(dice(words(src_texts[i]), words(texts[i] if i < len(texts) else "")), 3),
                "ink": round(ink_iou(page, other), 3) if other is not None else 0.0,
                "overlap": overlaps[i] if i < len(overlaps) else None,
                "clip": clipped[i] if i < len(clipped) else None,
                "rules": f"{rules_b[i] if i < len(rules_b) else '-'}/{rules_a[i]}",
                "images": f"{images_b[i] if i < len(images_b) else '-'}/{images_a[i]}",
            }
        )
    return {"name": name, "pages": f"{len(converted_pages)}/{len(original_pages)}", "rows": rows}


def main():
    if not soffice():
        sys.exit("LibreOffice (soffice) not found: install it to run the visual QA.")
    wanted = set(sys.argv[1:])
    pdfs = sorted([*FIXTURES.glob("*.pdf"), *(FIXTURES / ".cache").glob("*.pdf")])
    pdfs = [p for p in pdfs if not p.name.startswith("scanned")]
    for pdf in pdfs:
        name = pdf.stem
        if wanted and name not in wanted:
            continue
        try:
            result = run(name, pdf)
        except Exception as error:  # noqa: BLE001
            print(f"== {name}: FAILED {type(error).__name__}: {error}")
            continue
        print(f"== {name}: pages {result['pages']}")
        for row in result["rows"]:
            print("   p{page}: text {text}  ink {ink}  overlap {overlap}  clip {clip}  rules {rules}  images {images}".format(**row))


if __name__ == "__main__":
    main()
