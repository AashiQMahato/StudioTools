"""Where the models run: CUDA, then Apple Silicon (MPS), then the CPU — and how much memory there is."""

from __future__ import annotations

import gc
import logging
import os
import platform
import subprocess

# Ops MPS doesn't implement run on the CPU instead of failing. Must be set before torch is imported.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import torch  # noqa: E402

log = logging.getLogger("image_service.subject")


def detect_device(preferred: str = "auto") -> str:
    """The best available device: CUDA, then MPS, then CPU. A preferred one is used only if it's there."""
    available = {
        "cuda": torch.cuda.is_available(),
        "mps": getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available(),
        "cpu": True,
    }
    if preferred != "auto":
        if available.get(preferred):
            return preferred
        log.warning("device '%s' isn't available here; choosing automatically", preferred)
    for device in ("cuda", "mps", "cpu"):
        if available[device]:
            return device
    return "cpu"


def total_memory_gb() -> float:
    """Physical memory in GB (on Apple Silicon the GPU shares it), or 0 if unknown."""
    try:
        if platform.system() == "Darwin":
            return int(subprocess.check_output(["sysctl", "-n", "hw.memsize"], timeout=2)) / 1024**3
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1024**3
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0.0


def free_memory(device: str) -> None:
    """Give memory held by released tensors back (the device caches allocations otherwise)."""
    gc.collect()
    if device == "cuda":
        torch.cuda.empty_cache()
    elif device == "mps":
        torch.mps.empty_cache()


def is_device_failure(error: BaseException) -> bool:
    """An error from the accelerator itself (an unsupported op, out of memory) — worth retrying on the CPU."""
    text = str(error).lower()
    return isinstance(error, (RuntimeError, NotImplementedError)) and any(word in text for word in ("mps", "cuda", "out of memory", "not implemented", "metal"))
