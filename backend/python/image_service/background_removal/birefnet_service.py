"""
BiRefNet-Massive: one copy, loaded once, kept for the life of the service. Turns a prepared image tensor
into an alpha matte (0–1).
"""

from __future__ import annotations

import logging
import threading
import time

import numpy as np
import torch

from .device import free_memory, is_device_failure
from .model_config import Settings

log = logging.getLogger("image_service.background_removal")


class ModelUnavailable(Exception):
    """The model isn't there (not downloaded) or couldn't be loaded."""


class BiRefNetMassive:
    """The model, behind a lock: one inference at a time, so an 8 GB machine never holds two runs' memory."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.device = settings.device
        self.dtype = torch.float16 if settings.precision == "fp16" and settings.device != "cpu" else torch.float32
        self.model = None
        self.lock = threading.Lock()
        self.load_seconds: float | None = None

    @property
    def loaded(self) -> bool:
        return self.model is not None

    def load_model(self) -> None:
        if self.model is not None:
            return
        import os

        from transformers import AutoModelForImageSegmentation

        path = self.settings.model_path
        if not os.path.isfile(os.path.join(path, "model.safetensors")):
            raise ModelUnavailable("model files missing — run scripts/setup-ml.sh")
        started = time.perf_counter()
        # Local folder only; its model code is the reviewed, pinned copy setup-ml.sh put there.
        model = AutoModelForImageSegmentation.from_pretrained(path, trust_remote_code=True, local_files_only=True)
        self.model = model.to(self.device, dtype=self.dtype).eval()
        self.load_seconds = time.perf_counter() - started
        log.info("%s loaded in %.1fs on %s (%s, input %s px)", self.settings.model_name, self.load_seconds, self.device, "fp16" if self.dtype == torch.float16 else "fp32", self.settings.input_size)

    def unload_model(self) -> None:
        with self.lock:
            self.model = None
            free_memory(self.device)

    def _to_cpu(self, error: BaseException) -> None:
        """An op (or the memory) the accelerator couldn't manage: carry on with the CPU from now on."""
        log.warning("%s failed on %s (%s); falling back to the CPU", self.settings.model_name, self.device, type(error).__name__)
        self.model = self.model.to("cpu", dtype=torch.float32)
        free_memory(self.device)
        self.device = "cpu"
        self.dtype = torch.float32

    def predict(self, pixels: np.ndarray) -> np.ndarray:
        """
        The alpha matte (0–1, float32) for a normalised CHW float32 array at the model's input size. The
        input tensor and the network's intermediate tensors are released before returning.
        """
        with self.lock:
            self.load_model()
            for attempt in (0, 1):
                tensor = None
                try:
                    tensor = torch.from_numpy(pixels[None]).to(self.device, dtype=self.dtype)
                    with torch.inference_mode():
                        prediction = self.model(tensor)[-1]
                        alpha = prediction.sigmoid()[0, 0].float().cpu().numpy()
                    del prediction
                    return alpha
                except Exception as error:  # noqa: BLE001
                    if attempt == 0 and self.device != "cpu" and is_device_failure(error):
                        self._to_cpu(error)
                        continue
                    raise
                finally:
                    del tensor
                    free_memory(self.device)
        raise RuntimeError("unreachable")

    # The spec's name for the same call: an alpha matte from a prepared image.
    generate_alpha = predict
