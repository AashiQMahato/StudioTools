"""
Background removal with BiRefNet-Massive — the only model.

    upload → validate, EXIF, RGB → model copy (longest side = input size, aspect kept)
           → BiRefNet-Massive → alpha → subtle clean-up → alpha at the ORIGINAL size
           → original RGB (edge colour decontaminated) + alpha → RGBA PNG

The model never sees the full-size photo and the photo is never resized: only the alpha is scaled up.
It's a foreground/background model: it keeps what stands out as the subject — everyone in a group photo
included. It does not choose between people.
"""

from __future__ import annotations

import io
import logging
import time
from dataclasses import dataclass, field

import numpy as np
from PIL import Image

from . import mask_processor as masks
from .birefnet_service import BiRefNetMassive
from .device import free_memory
from .image_preprocessor import model_input
from .model_config import Settings

log = logging.getLogger("image_service.background_removal")


@dataclass
class Result:
    png: bytes
    width: int
    height: int
    timings: dict[str, float] = field(default_factory=dict)  # milliseconds


class BackgroundRemover:
    """One per service (the model manager): the model loads once and stays."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.model = BiRefNetMassive(settings)
        self.warm_up_seconds: float | None = None
        self.recent: list[float] = []  # the last few total times (s), for the page's progress estimate

    def load(self) -> None:
        self.model.load_model()
        if self.settings.warm_up:
            self._warm_up()

    def _warm_up(self) -> None:
        """
        One small run so the GPU compiles its kernels now, not during the first person's request (on an
        M2 the first run is several seconds slower). At the real input size — kernels are per shape — on a
        blank image, so it costs one inference and no extra memory afterwards.
        """
        started = time.perf_counter()
        size = self.settings.input_size
        self.model.predict(np.zeros((3, size, size), np.float32))
        self.warm_up_seconds = time.perf_counter() - started
        log.info("warm-up: %.1fs", self.warm_up_seconds)

    def status(self) -> dict:
        s = self.settings
        typical = sorted(self.recent)[len(self.recent) // 2] if self.recent else None
        return {
            "model": s.model_name,
            "device": self.model.device,
            "precision": "fp16" if self.model.dtype.itemsize == 2 else "fp32",
            "inputSize": s.input_size,
            "loaded": self.model.loaded,
            "loadSeconds": round(self.model.load_seconds, 1) if self.model.load_seconds else None,
            "warmUpSeconds": round(self.warm_up_seconds, 1) if self.warm_up_seconds else None,
            "typicalSeconds": round(typical, 1) if typical else None,
        }

    def remove(self, image: Image.Image) -> Result:
        timings: dict[str, float] = {}
        total = time.perf_counter()

        started = time.perf_counter()
        prepared = model_input(image, self.settings.input_size)
        timings["preprocess"] = (time.perf_counter() - started) * 1000

        started = time.perf_counter()
        alpha = self.model.predict(prepared.pixels)
        timings["inference"] = (time.perf_counter() - started) * 1000
        del prepared.pixels

        started = time.perf_counter()
        x0, y0, x1, y1 = prepared.box
        alpha = masks.normalise(alpha[y0:y1, x0:x1])  # the image's part of the square, padding dropped
        if self.settings.remove_specks:
            alpha = masks.remove_specks(alpha)
        if self.settings.fill_holes:
            alpha = masks.fill_holes(alpha)
        alpha = masks.resize(alpha, image.width, image.height)
        rgb = np.asarray(image)
        if self.settings.decontaminate:
            rgb = masks.decontaminate(rgb, alpha)
        timings["postprocess"] = (time.perf_counter() - started) * 1000

        started = time.perf_counter()
        rgba = np.dstack([rgb, (alpha * 255).round().astype(np.uint8)])
        buffer = io.BytesIO()
        Image.fromarray(rgba, "RGBA").save(buffer, format="PNG", optimize=False, compress_level=6)
        del rgba, rgb, alpha
        timings["export"] = (time.perf_counter() - started) * 1000
        timings["total"] = (time.perf_counter() - total) * 1000
        free_memory(self.model.device)

        self.recent = (self.recent + [timings["total"] / 1000])[-9:]
        log.info(
            "%sx%s: preprocess %.0f ms, inference %.0f ms, post-processing %.0f ms, export %.0f ms, total %.0f ms",
            image.width, image.height, timings["preprocess"], timings["inference"], timings["postprocess"], timings["export"], timings["total"],
        )
        return Result(png=buffer.getvalue(), width=image.width, height=image.height, timings=timings)
