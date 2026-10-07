"""
Background removal's settings — one place, from the environment, with automatic choices for the machine.

The model is BiRefNet-Massive (ZhengPeng7's "BiRefNet-massive-TR_DIS5K_TR_TEs", MIT): weights from
`ZhengPeng7/BiRefNet-DIS5K-TR_TEs` plus the model code from `ZhengPeng7/BiRefNet`, both at pinned revisions,
put in one local folder by scripts/setup-ml.sh. It's only ever loaded from that folder: nothing is
downloaded while serving.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from .device import detect_device, total_memory_gb

BIREFNET_MODEL_NAME = "BiRefNet-Massive"
# Where scripts/setup-ml.sh fetches it from (revisions reviewed and pinned).
BIREFNET_WEIGHTS_REPO = "ZhengPeng7/BiRefNet-DIS5K-TR_TEs"
BIREFNET_WEIGHTS_REVISION = "487f440314ea7ab8ea7d184861953a4010b55587"
BIREFNET_CODE_REPO = "ZhengPeng7/BiRefNet"
BIREFNET_CODE_REVISION = "e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4"

# The network works in 32-pixel steps; it was trained at 1024.
MIN_INPUT_SIZE = 256
MAX_INPUT_SIZE = 1024


@dataclass(frozen=True)
class Settings:
    model_name: str
    model_path: str
    device: str
    precision: str  # "fp16" | "fp32"
    input_size: int  # the model sees the image at this size (longest side, aspect kept, padded square)
    batch_size: int
    memory_gb: float
    max_pixels: int  # largest image accepted (the cut-out is made at full size)
    warm_up: bool
    # Clean-up (all subtle; BiRefNet's alpha stays the source of truth).
    remove_specks: bool
    fill_holes: bool
    decontaminate: bool


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name, "").strip().lower()
    return default if not value else value in ("1", "true", "yes", "on")


def default_input_size(device: str, memory_gb: float) -> int:
    """Measured on an M2 with 8 GB (see README): 1024 on an NVIDIA GPU or a larger Mac, 768 on 8 GB Apple Silicon, 512 on the CPU."""
    if device == "cuda":
        return 1024
    if device == "mps":
        return 1024 if memory_gb > 12 else 768
    return 512


def load_settings() -> Settings:
    device = detect_device(os.environ.get("BIREFNET_DEVICE", "auto").strip().lower() or "auto")
    memory = total_memory_gb()
    size = _int("BIREFNET_INPUT_SIZE", default_input_size(device, memory))
    size = max(MIN_INPUT_SIZE, min(MAX_INPUT_SIZE, size))
    size -= size % 32
    # Half precision on a GPU: same masks (checked), half the memory, several times faster on Apple Silicon.
    precision = os.environ.get("BIREFNET_PRECISION", "").strip().lower()
    if precision not in ("fp16", "fp32"):
        precision = "fp32" if device == "cpu" else "fp16"
    return Settings(
        model_name=BIREFNET_MODEL_NAME,
        model_path=os.environ.get("BIREFNET_MODEL_PATH", "").strip() or os.path.join(os.environ.get("MODELS_DIR", ""), "birefnet-massive"),
        device=device,
        precision=precision,
        input_size=size,
        batch_size=max(1, _int("BIREFNET_BATCH_SIZE", 1)),
        memory_gb=round(memory, 1),
        max_pixels=_int("MAX_IMAGE_PIXELS", 40_000_000),
        warm_up=_bool("BIREFNET_WARMUP", True),
        remove_specks=_bool("MASK_REMOVE_SPECKS", True),
        fill_holes=_bool("MASK_FILL_HOLES", True),
        decontaminate=_bool("MASK_DECONTAMINATE", True),
    )
