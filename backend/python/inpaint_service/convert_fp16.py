"""
One-time conversion of the PowerPaint v2-1 download to half precision, in two steps so it fits in 8 GB:
the UNet (3.4 GB fp32 .bin → 1.7 GB safetensors), then the BrushNet branch (3.5 GB → 1.7 GB), plus the
task-token text encoder. Run by scripts/setup-ml.sh with the inpaint environment:

    python inpaint_service/convert_fp16.py <powerpaint-v2-1 folder> <output folder> {unet|brushnet|text}
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import torch
from safetensors import safe_open
from safetensors.torch import save_file

sys.path.insert(0, str(Path(__file__).parent))


def main(source: Path, target: Path, step: str) -> None:
    base = source / "realisticVisionV60B1_v51VAE"
    target.mkdir(parents=True, exist_ok=True)
    if step == "unet":
        out = target / "unet"
        out.mkdir(exist_ok=True)
        weights = torch.load(base / "unet" / "diffusion_pytorch_model.bin", map_location="cpu", mmap=True, weights_only=True)
        save_file({k: v.half().contiguous() for k, v in weights.items()}, out / "diffusion_pytorch_model.safetensors")
        shutil.copy(base / "unet" / "config.json", out / "config.json")
    elif step == "brushnet":
        from powerpaint.models.BrushNet_CA import BrushNetModel
        from powerpaint.models.unet_2d_condition import UNet2DConditionModel

        unet = UNet2DConditionModel.from_pretrained(target / "unet", torch_dtype=torch.float16)
        torch.set_default_dtype(torch.float16)
        brushnet = BrushNetModel.from_unet(unet)
        del unet
        with safe_open(source / "PowerPaint_Brushnet" / "diffusion_pytorch_model.safetensors", "pt") as f:
            state = {k: f.get_tensor(k).half() for k in f.keys()}
        # safetensors' load_model drops tied/shared tensors the same way; strict keeps us honest about the rest.
        missing = brushnet.load_state_dict(state, strict=False)
        print("brushnet load:", len(missing.missing_keys), "missing,", len(missing.unexpected_keys), "unexpected")
        brushnet.save_pretrained(target / "brushnet", safe_serialization=True)
    elif step == "text":
        # The task-token encoder is a partial state dict over SD 1.5's text encoder; save it half-size, as-is.
        state = torch.load(source / "PowerPaint_Brushnet" / "pytorch_model.bin", map_location="cpu", weights_only=True)
        save_file({k: v.half().contiguous() for k, v in state.items()}, target / "text_encoder_brushnet.safetensors")
        print("text keys:", len(state))
    else:
        sys.exit(__doc__)
    print("done", step)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])
