"""
PowerPaint v2-1 (Apache-2.0 weights; code MIT) — a BrushNet-based Stable Diffusion 1.5 inpainter that is
trained to *remove* objects (it fills with what belongs, rather than inventing something). Wrapped for local
use on Apple Silicon (MPS, fp16) or CPU: one engine object loads its weights once and runs one fill at a time.

Needs the packages in requirements-inpaint.txt (diffusers 0.27 and an older transformers than the main
service's) — which is why it runs in its own process (inpaint_service/app.py), not in the image service.
"""

from __future__ import annotations

import gc
import os
from pathlib import Path

import numpy as np
import torch
from diffusers import UniPCMultistepScheduler
from PIL import Image
from safetensors.torch import load_file
from transformers import CLIPTextModel

from powerpaint.models.BrushNet_CA import BrushNetModel
from powerpaint.models.unet_2d_condition import UNet2DConditionModel
from powerpaint.pipelines.pipeline_PowerPaint_Brushnet_CA import StableDiffusionPowerPaintBrushNetPipeline
from powerpaint.utils.utils import TokenizerWrapper, add_tokens

# Object removal's prompt scaffolding, from the PowerPaint reference app: the learned P_ctxt / P_obj
# tokens steer the model to continue the surroundings rather than draw a new object.
PROMPT = " empty scene blur"
FITTING_DEGREE = 1.0


def pick_device() -> str:
    if os.environ.get("INPAINT_DEVICE"):
        return os.environ["INPAINT_DEVICE"]
    if torch.cuda.is_available():
        return "cuda"
    return "mps" if torch.backends.mps.is_available() else "cpu"


class PowerPaint:
    def __init__(self, weights: Path, sd15_parts: Path, device: str | None = None) -> None:
        """`weights` is the half-precision folder made by convert_fp16.py; the rest of v2-1's download sits beside it."""
        self.device = device or pick_device()
        dtype = torch.float16 if self.device != "cpu" else torch.float32
        self.dtype = dtype
        base = str(weights.parent / "powerpaint-v2-1" / "realisticVisionV60B1_v51VAE")
        unet = UNet2DConditionModel.from_pretrained(weights / "unet", torch_dtype=dtype)
        brushnet = BrushNetModel.from_pretrained(weights / "brushnet", torch_dtype=dtype)
        text_encoder_brushnet = CLIPTextModel.from_pretrained(str(sd15_parts), subfolder="text_encoder", torch_dtype=dtype, variant="fp16")
        self.pipe = StableDiffusionPowerPaintBrushNetPipeline.from_pretrained(
            base, unet=unet, brushnet=brushnet, text_encoder_brushnet=text_encoder_brushnet, torch_dtype=dtype, safety_checker=None
        )
        self.pipe.tokenizer = TokenizerWrapper(from_pretrained=base, subfolder="tokenizer", revision=None, torch_type=dtype, local_files_only=True)
        add_tokens(tokenizer=self.pipe.tokenizer, text_encoder=self.pipe.text_encoder_brushnet, placeholder_tokens=["P_ctxt", "P_shape", "P_obj"], initialize_tokens=["a", "a", "a"], num_vectors_per_token=10)
        self.pipe.text_encoder_brushnet.load_state_dict(load_file(weights / "text_encoder_brushnet.safetensors"), strict=False)
        self.pipe.scheduler = UniPCMultistepScheduler.from_config(self.pipe.scheduler.config)
        self.pipe = self.pipe.to(self.device)
        self.pipe.set_progress_bar_config(disable=True)

    def run(self, image: np.ndarray, hole: np.ndarray, steps: int = 20, guidance: float = 7.5, seed: int = 1, on_step=None) -> np.ndarray:
        """`image` RGB uint8 (sides multiples of 8); `hole` 0/1 where to fill. Returns the filled image, same size."""
        height, width = hole.shape
        mask = Image.fromarray(hole.astype(np.uint8) * 255).convert("RGB")
        masked = Image.fromarray((image * (1 - hole[..., None])).astype(np.uint8))
        generator = torch.Generator("cpu").manual_seed(seed)
        callback = None
        if on_step:
            def callback(_pipe, index, _t, kwargs):  # noqa: ANN001
                on_step(index + 1, steps)
                return kwargs
        with torch.inference_mode():
            result = self.pipe(
                promptA=" P_ctxt",
                promptB=" P_ctxt",
                promptU=PROMPT,
                tradoff=FITTING_DEGREE,
                tradoff_nag=FITTING_DEGREE,
                image=masked,
                mask=mask,
                num_inference_steps=steps,
                generator=generator,
                brushnet_conditioning_scale=1.0,
                negative_promptA=" P_obj",
                negative_promptB=" P_obj",
                negative_promptU="",
                guidance_scale=guidance,
                width=width,
                height=height,
                **({"callback_on_step_end": callback} if callback else {}),
            ).images[0]
        out = np.asarray(result.convert("RGB"))
        self.release()
        return out

    def release(self) -> None:
        gc.collect()
        if self.device == "mps":
            torch.mps.empty_cache()
        elif self.device == "cuda":
            torch.cuda.empty_cache()
