"""
End-to-end QA for PDF → Word through the API (so scans go through the real OCR pipeline): uploads each test PDF
to /api/pdf/to-word, waits for the job, downloads the Word file, and compares it with the original exactly as
docx_visual_qa.py does (LibreOffice round trip, renders side by side in tests/docx_fixtures/out/api-*).

    .venv/bin/python scripts/docx_api_qa.py [--api http://localhost:5000] [names…]
"""

from __future__ import annotations

import json
import sys
import time
import urllib.request
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from docx_visual_qa import FIXTURES, OUT, counts, dice, ink_iou, original_text, render, side_by_side, soffice, text_issues, to_pdf, words  # noqa: E402


def post_pdf(api: str, pdf: Path) -> str:
    boundary = uuid.uuid4().hex
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nauto\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{pdf.name}\"\r\nContent-Type: application/pdf\r\n\r\n"
    ).encode() + pdf.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(f"{api}/api/pdf/to-word", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read())["data"]["id"]


def wait(api: str, job: str, limit: float = 900):
    started = time.time()
    while time.time() - started < limit:
        with urllib.request.urlopen(f"{api}/api/jobs/{job}", timeout=30) as response:
            data = json.loads(response.read())["data"]
        if data["status"] in ("done", "completed", "succeeded", "success"):
            return data
        if data["status"] in ("failed", "error", "cancelled"):
            raise RuntimeError(f"job {data['status']}: {data.get('error')}")
        time.sleep(2)
    raise TimeoutError(job)


def main():
    args = sys.argv[1:]
    api = "http://localhost:5000"
    if args[:1] == ["--api"]:
        api, args = args[1], args[2:]
    if not soffice():
        sys.exit("LibreOffice (soffice) not found.")
    OUT.mkdir(exist_ok=True)
    pdfs = sorted([*FIXTURES.glob("*.pdf"), *(FIXTURES / ".cache").glob("*.pdf")])
    for pdf in pdfs:
        if args and pdf.stem not in args:
            continue
        name = f"api-{pdf.stem}"
        try:
            started = time.time()
            job = wait(api, post_pdf(api, pdf))
            seconds = time.time() - started
            file = next(f for f in job["files"] if f["name"].endswith(".docx"))
            docx = OUT / f"{name}.docx"
            with urllib.request.urlopen(f"{api}/api/jobs/{job['id']}/files/{file['id']}", timeout=120) as response:
                docx.write_bytes(response.read())
            converted = to_pdf(docx)
            a, _ = render(pdf)
            b, _ = render(converted)
            overlaps, clipped, texts = text_issues(converted)
            src = original_text(pdf)
            rules_a, images_a = counts(pdf)
            rules_b, images_b = counts(converted)
            print(f"== {pdf.stem}: pages {len(b)}/{len(a)}  {seconds:.0f}s  summary {job.get('summary')}")
            for i, page in enumerate(a):
                other = b[i] if i < len(b) else None
                if other is not None:
                    side_by_side(page, other, OUT / f"{name}-p{i + 1}.png")
                print(f"   p{i + 1}: text {dice(words(src[i]), words(texts[i] if i < len(texts) else '')):.3f}  ink {ink_iou(page, other) if other is not None else 0:.3f}  overlap {overlaps[i] if i < len(overlaps) else '-'}  clip {clipped[i] if i < len(clipped) else '-'}  images {images_b[i] if i < len(images_b) else '-'}/{images_a[i]}")
        except Exception as error:  # noqa: BLE001
            print(f"== {pdf.stem}: FAILED {type(error).__name__}: {error}")


if __name__ == "__main__":
    main()
