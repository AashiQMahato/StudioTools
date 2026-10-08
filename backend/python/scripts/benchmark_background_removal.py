"""
Benchmarks the background-removal pipeline (BiRefNet-Massive + refinement) at several model input sizes,
stage by stage, and saves the cut-outs for inspection.

    cd backend/python
    .venv/bin/python scripts/benchmark_background_removal.py --sizes 512,768,1024 --out /tmp/bg-bench

Each size runs in its own process, so peak memory is that size's alone (and a size that runs out of
memory or time doesn't take the others down). Per image: one warm-up run, then the timed run.
"""

from __future__ import annotations

import argparse
import json
import os
import resource
import subprocess
import sys
from dataclasses import replace
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVICE = HERE.parent / "image_service"
FIXTURES = HERE.parent / "tests" / "fixtures"


def child(size: int, images: list[str], out: str) -> None:
    sys.path.insert(0, str(SERVICE))
    os.environ.setdefault("MODELS_DIR", str(HERE.parent / ".models"))
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ["BIREFNET_WARMUP"] = "off"
    import torch
    from PIL import Image

    from background_removal.background_removal_service import BackgroundRemover
    from background_removal.image_preprocessor import open_image
    from background_removal.model_config import load_settings

    settings = load_settings()
    mode = replace(settings.modes["quality"], name=f"s{size}", input_size=size)
    settings = replace(settings, modes={**settings.modes, mode.name: mode})
    remover = BackgroundRemover(settings)
    remover.load()
    rows = []
    for path in images:
        image = open_image(Path(path).read_bytes(), 60_000_000)
        remover.remove(image, mode.name)  # warm-up (kernels compile per shape)
        result = remover.remove(image, mode.name)
        name = Path(path).stem
        Path(out, f"{name}@{size}.png").write_bytes(result.png)
        rows.append({"image": name, "size": f"{image.width}x{image.height}", **{k: round(v) for k, v in result.timings.items()}})
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024**3 if sys.platform == "darwin" else 1024**2)
    gpu = torch.mps.driver_allocated_memory() / 1024**3 if remover.model.device == "mps" else (torch.cuda.max_memory_allocated() / 1024**3 if remover.model.device == "cuda" else 0)
    print(json.dumps({"input": size, "device": remover.model.device, "peak_rss_gb": round(peak, 2), "gpu_gb": round(gpu, 2), "rows": rows}))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sizes", default="512,768,1024")
    parser.add_argument("--images", default=",".join(sorted(str(p) for p in FIXTURES.glob("*.jpg"))))
    parser.add_argument("--out", default="/tmp/bg-bench")
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--child", type=int)
    args = parser.parse_args()
    images = [p for p in args.images.split(",") if p]
    os.makedirs(args.out, exist_ok=True)
    if args.child:
        return child(args.child, images, args.out)

    for size in [int(s) for s in args.sizes.split(",")]:
        try:
            done = subprocess.run([sys.executable, __file__, "--child", str(size), "--images", ",".join(images), "--out", args.out], capture_output=True, text=True, timeout=args.timeout)
            line = next((l for l in done.stdout.splitlines() if l.startswith("{")), None)
            if not line:
                print(f"\n{size}px: failed — {done.stderr.strip().splitlines()[-1] if done.stderr.strip() else 'no output'}")
                continue
            data = json.loads(line)
        except subprocess.TimeoutExpired:
            print(f"\n{size}px: did not finish within {args.timeout}s")
            continue
        print(f"\n{size}px on {data['device']} — peak RAM {data['peak_rss_gb']} GB, GPU {data['gpu_gb']} GB")
        print(f"{'image':28} {'pixels':>10} {'infer':>6} {'clean':>6} {'refine':>6} {'resize':>6} {'decont':>6} {'compose':>7} {'total':>6}  (ms)")
        for r in data["rows"]:
            print(f"{r['image'][:28]:28} {r['size']:>10} {r['inference']:>6} {r['cleanup']:>6} {r['refine']:>6} {r['resize']:>6} {r['decontaminate']:>6} {r['compose']:>7} {r['total']:>6}")
        totals = [r["total"] for r in data["rows"]]
        print(f"average total: {sum(totals) / len(totals):.0f} ms")


if __name__ == "__main__":
    main()
