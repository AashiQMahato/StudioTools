"""
Background removal with BiRefNet-Massive — the only model.

    original image
      → model copy (longest side = the mode's input size, aspect kept, padded square)
      → BiRefNet-Massive → raw alpha → normalise, clean-up (specks, pinholes)
      → alpha at the refinement size → edge-aware refinement in the transition band (guided by the photo)
      → alpha at the ORIGINAL size
      → halo removal in the soft edge band (colour only; alpha untouched)
      → original RGB + refined alpha → RGBA PNG

The model never sees the full-size photo and the photo is never resized: only the alpha is scaled. RGB
values are the original's everywhere except the soft edge band, where the old background's colour is
taken out. It's a foreground/background model: it keeps what stands out as the subject (everyone in a
group photo included); it does not choose between people.
"""

from __future__ import annotations

import io
import logging
import time
from dataclasses import dataclass, field

import cv2
import numpy as np
from PIL import Image

from . import mask_processor as masks
from .alpha_refiner import RefineSettings, refine_alpha_edges
from .birefnet_service import BiRefNetMassive
from .device import free_memory
from .edge_decontaminator import decontaminate_edges
from .image_preprocessor import model_input
from .model_config import Mode, Settings

log = logging.getLogger("image_service.background_removal")


@dataclass
class Result:
    png: bytes
    width: int
    height: int
    mode: str
    timings: dict[str, float] = field(default_factory=dict)  # milliseconds


def generate_alpha(model: BiRefNetMassive, image: Image.Image, size: int) -> np.ndarray:
    """BiRefNet's raw alpha for the image (aspect kept), at the model's resolution, padding cropped away."""
    prepared = model_input(image, size)
    alpha = model.predict(prepared.pixels)
    x0, y0, x1, y1 = prepared.box
    return alpha[y0:y1, x0:x1]


def resize_alpha_to_original(alpha: np.ndarray, width: int, height: int) -> np.ndarray:
    return masks.resize_alpha(alpha, width, height)


def compose_rgba(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """The photo's pixels with the alpha as their transparency (alpha in 0–1, soft values kept)."""
    return np.dstack([rgb, (np.clip(alpha, 0, 1) * 255).round().astype(np.uint8)])


def encode_png(rgba: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buffer, format="PNG", optimize=False, compress_level=6)
    return buffer.getvalue()


class BackgroundRemover:
    """One per service (the model manager): the model loads once and stays."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.model = BiRefNetMassive(settings)
        self.warm_up_seconds: float | None = None
        self.recent: dict[str, list[float]] = {}  # per mode, the last few total times (s)

    def load(self) -> None:
        self.model.load_model()
        if self.settings.warm_up:
            self._warm_up()

    def _warm_up(self) -> None:
        """
        One small run per everyday input size, so the GPU compiles its kernels now (they're per shape)
        rather than during someone's first request. ULTRA isn't warmed: it's rarely used and costs memory.
        """
        started = time.perf_counter()
        for name in ("quality", "fast"):
            size = self.settings.modes[name].input_size
            self.model.predict(np.zeros((3, size, size), np.float32))
        self.warm_up_seconds = time.perf_counter() - started
        log.info("warm-up: %.1fs", self.warm_up_seconds)

    def mode(self, name: str | None) -> Mode:
        return self.settings.modes.get(name or "quality") or self.settings.modes["quality"]

    def status(self) -> dict:
        s = self.settings
        typical = {name: round(sorted(times)[len(times) // 2], 1) for name, times in self.recent.items() if times}
        return {
            "model": s.model_name,
            "device": self.model.device,
            "precision": "fp16" if self.model.dtype.itemsize == 2 else "fp32",
            "inputSize": s.input_size,
            # Offered on the page. Fast isn't on a GPU: measured on an M2, 640 px is only ~3% quicker than 768
            # (fixed GPU overhead dominates) — a "Fast" that isn't faster would mislead. The API still takes it.
            "modes": {name: mode.input_size for name, mode in s.modes.items() if not (name == "fast" and self.model.device != "cpu")},
            "loaded": self.model.loaded,
            "loadSeconds": round(self.model.load_seconds, 1) if self.model.load_seconds else None,
            "warmUpSeconds": round(self.warm_up_seconds, 1) if self.warm_up_seconds else None,
            "typicalSeconds": typical.get("quality"),
            "typicalSecondsByMode": typical,
        }

    def remove(self, image: Image.Image, mode_name: str | None = None) -> Result:
        mode = self.mode(mode_name)
        s = self.settings
        width, height = image.size
        timings: dict[str, float] = {}
        total = time.perf_counter()

        def lap(name: str, started: float) -> None:
            timings[name] = (time.perf_counter() - started) * 1000

        started = time.perf_counter()
        alpha = generate_alpha(self.model, image, mode.input_size)
        lap("inference", started)

        started = time.perf_counter()
        alpha = masks.normalise(alpha)
        if s.remove_specks:
            alpha = masks.remove_specks(alpha)
        if s.fill_holes:
            alpha = masks.fill_holes(alpha)
        lap("cleanup", started)

        rgb = np.asarray(image)
        started = time.perf_counter()
        if mode.refine:
            # Refine where there's detail to recover, but within memory: at most refine_max_side.
            scale = min(1.0, mode.refine_max_side / max(width, height))
            refine_w, refine_h = max(1, round(width * scale)), max(1, round(height * scale))
            guide = rgb if scale >= 1 else cv2.resize(rgb, (refine_w, refine_h), interpolation=cv2.INTER_AREA)
            alpha = masks.resize_alpha(alpha, refine_w, refine_h)
            # The alpha's blur is about the upscaling factor wide: the window has to reach across it.
            upscale = max(refine_w, refine_h) / mode.input_size
            radius = max(2, round(2 * upscale))
            alpha = refine_alpha_edges(guide, alpha, RefineSettings(low=s.edge_low, high=s.edge_high, radius=radius, eps=mode.refine_eps, max_side=mode.refine_max_side))
            del guide
        lap("refine", started)

        started = time.perf_counter()
        alpha = resize_alpha_to_original(alpha, width, height)
        lap("resize", started)

        started = time.perf_counter()
        colour = decontaminate_edges(rgb, alpha, strength=mode.decontaminate) if mode.decontaminate > 0 else rgb
        lap("decontaminate", started)

        started = time.perf_counter()
        png = encode_png(compose_rgba(colour, alpha))
        del colour, alpha
        lap("compose", started)
        timings["total"] = (time.perf_counter() - total) * 1000
        free_memory(self.model.device)

        self.recent[mode.name] = (self.recent.get(mode.name, []) + [timings["total"] / 1000])[-9:]
        log.info(
            "%s %sx%s @%s: inference %.0f, cleanup %.0f, refine %.0f, resize %.0f, decontaminate %.0f, compose %.0f, total %.0f ms",
            mode.name, width, height, mode.input_size, timings["inference"], timings["cleanup"], timings["refine"], timings["resize"], timings["decontaminate"], timings["compose"], timings["total"],
        )
        return Result(png=png, width=width, height=height, mode=mode.name, timings=timings)
