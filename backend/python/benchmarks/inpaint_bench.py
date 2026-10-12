"""
Repeatable inpainting benchmark: the same photos and masks through each engine, with timings, peak memory and
before/after images written to benchmarks/out/<engine>/.

    .venv/bin/python benchmarks/inpaint_bench.py lama
    .venv-inpaint/bin/python benchmarks/inpaint_bench.py powerpaint --side 512 --steps 20
    .venv/bin/python benchmarks/inpaint_bench.py report            # contact sheet of everything run so far

Each case is cropped around its mask exactly as the app does (context margin, working size), filled by the
engine, and blended back through a feathered mask, so the numbers are what a user would get.
"""

from __future__ import annotations

import argparse
import json
import os
import resource
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
PY = HERE.parent
FIXTURES = PY / "tests" / "fixtures"
OUT = HERE / "out"
MODELS = Path(os.environ.get("MODELS_DIR") or PY / ".models")

# name → (photo, kind, shape in fractions of the photo: (x0, y0, x1, y1)); "e" ellipse, "r" rectangle.
CASES = {
    "small-object": ("bicycle-thin-details", "e", (0.585, 0.10, 0.665, 0.20)),  # a handlebar end against ivy
    "person": ("crowd-man", "r", (0.60, 0.38, 0.86, 1.0)),  # a whole person in a crowd
    "texture": ("bicycle-thin-details", "r", (0.38, 0.0, 0.58, 0.32)),  # ivy wall, no object — pure texture
    "face-blemish": ("curly-hair-bright-bg", "e", (0.50, 0.40, 0.57, 0.47)),  # a small patch of cheek
    "dark-shadow": ("dark-fur-dark-bg", "e", (0.55, 0.45, 0.80, 0.80)),  # dark fur on dark ground
    "large-region": ("crowd-man", "r", (0.30, 0.0, 0.72, 0.38)),  # sky, banner and lights
}


def case_inputs(name: str) -> tuple[np.ndarray, np.ndarray]:
    photo, kind, (x0, y0, x1, y1) = CASES[name]
    image = np.asarray(Image.open(FIXTURES / f"{photo}.jpg").convert("RGB"))
    h, w = image.shape[:2]
    mask = Image.new("L", (w, h), 0)
    box = [x0 * w, y0 * h, x1 * w, y1 * h]
    (ImageDraw.Draw(mask).ellipse if kind == "e" else ImageDraw.Draw(mask).rectangle)(box, fill=255)
    return image, np.asarray(mask) > 127


def prepare(image: np.ndarray, hole: np.ndarray, side: int):
    """The region around the hole (context margin as in retouchService.ts), at working size, and the blend mask."""
    h, w = hole.shape
    ys, xs = np.nonzero(hole)
    bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    s = max(bw, bh)
    margin = round(max(48, s * 0.6))
    x0, y0, x1, y1 = max(0, xs.min() - margin), max(0, ys.min() - margin), min(w, xs.max() + 1 + margin), min(h, ys.max() + 1 + margin)
    crop, crop_hole = image[y0:y1, x0:x1], hole[y0:y1, x0:x1]
    scale = min(1.0, side / max(crop.shape[:2]))
    ww, wh = max(8, round(crop.shape[1] * scale / 8) * 8), max(8, round(crop.shape[0] * scale / 8) * 8)
    small = cv2.resize(crop, (ww, wh), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LANCZOS4)
    small_hole = cv2.resize(crop_hole.astype(np.uint8) * 255, (ww, wh), interpolation=cv2.INTER_LINEAR)
    grow = max(2, round(3 + s * scale * 0.01))
    grown = cv2.dilate((small_hole > 127).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * grow + 1, 2 * grow + 1)))
    return (x0, y0, x1, y1), small, grown


def compose(image: np.ndarray, rect, filled: np.ndarray, grown: np.ndarray) -> np.ndarray:
    x0, y0, x1, y1 = rect
    blend = cv2.GaussianBlur(grown.astype(np.float32), (0, 0), 1.5)
    size = (x1 - x0, y1 - y0)
    blend = cv2.resize(blend, size, interpolation=cv2.INTER_CUBIC)[..., None].clip(0, 1)
    filled = cv2.resize(filled, size, interpolation=cv2.INTER_LANCZOS4).astype(np.float32)
    out = image.copy()
    out[y0:y1, x0:x1] = (image[y0:y1, x0:x1] * (1 - blend) + filled * blend).round().astype(np.uint8)
    return out


def lama_engine():
    sys.path.insert(0, str(PY))
    os.environ.setdefault("MODELS_DIR", str(MODELS))
    import io

    from image_service import app as service  # noqa: PLC0415

    def run(small: np.ndarray, grown: np.ndarray, **_) -> np.ndarray:
        buf, mbuf = io.BytesIO(), io.BytesIO()
        Image.fromarray(small).save(buf, "PNG")
        Image.fromarray(grown * 255).save(mbuf, "PNG")
        return np.asarray(Image.open(io.BytesIO(service.inpaint(buf.getvalue(), mbuf.getvalue()))).convert("RGB"))

    return run


def powerpaint_engine(steps: int, guidance: float, seed: int):
    sys.path.insert(0, str(PY / "inpaint_service"))
    from powerpaint_engine import PowerPaint  # noqa: PLC0415

    engine = PowerPaint(MODELS / "powerpaint-fp16", MODELS / "sd15-parts")
    return lambda small, grown, **_: engine.run(small, grown, steps=steps, guidance=guidance, seed=seed)


def peak_mb() -> float:
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024 / 1024  # bytes on macOS
    try:
        import torch

        if torch.backends.mps.is_available():
            peak = max(peak, torch.mps.driver_allocated_memory() / 1024 / 1024 / 1024 * 1024)
    except Exception:  # noqa: BLE001
        pass
    return peak


def run(args) -> None:
    folder = OUT / args.engine
    folder.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    infer = lama_engine() if args.engine == "lama" else powerpaint_engine(args.steps, args.guidance, args.seed)
    load = time.perf_counter() - started
    results = {"engine": args.engine, "load_s": round(load, 1), "side": args.side, "steps": args.steps, "cases": {}}
    for name in CASES if not args.only else args.only:
        image, hole = case_inputs(name)
        rect, small, grown = prepare(image, hole, args.side)
        t = time.perf_counter()
        filled = infer(small, grown)
        seconds = time.perf_counter() - t
        out = compose(image, rect, filled, grown)
        # Everything outside the mask must be untouched (feather aside).
        far = ~cv2.dilate(hole.astype(np.uint8), np.ones((41, 41), np.uint8)).astype(bool)
        untouched = bool((out[far] == image[far]).all())
        x0, y0, x1, y1 = rect
        pair = np.concatenate([image[y0:y1, x0:x1], out[y0:y1, x0:x1]], axis=1)
        Image.fromarray(pair).save(folder / f"{name}.jpg", quality=92)
        results["cases"][name] = {"seconds": round(seconds, 2), "work": list(small.shape[1::-1]), "outside_untouched": untouched, "peak_mb": round(peak_mb())}
        print(name, results["cases"][name], flush=True)
    (folder / "results.json").write_text(json.dumps(results, indent=2))


def report() -> None:
    engines = [p.name for p in sorted(OUT.iterdir()) if (p / "results.json").exists()]
    rows = []
    for name in CASES:
        row = []
        for engine in engines:
            tile = Image.open(OUT / engine / f"{name}.jpg")
            tile.thumbnail((900, 450))
            row.append(tile)
        rows.append(row)
    for name, row in zip(CASES, rows):
        sheet = Image.new("RGB", (sum(t.width for t in row) + 8 * len(row), max(t.height for t in row)), "white")
        x = 0
        for t in row:
            sheet.paste(t, (x, 0))
            x += t.width + 8
        sheet.save(OUT / f"compare-{name}.jpg", quality=90)
    print("engines:", engines)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("engine", choices=["lama", "powerpaint", "report"])
    parser.add_argument("--side", type=int, default=512, help="working size of the region's longer side")
    parser.add_argument("--steps", type=int, default=20)
    parser.add_argument("--guidance", type=float, default=7.5)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--only", nargs="*")
    options = parser.parse_args()
    report() if options.engine == "report" else run(options)
