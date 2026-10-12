"""
Internal premium inpainting service (PowerPaint v2-1), launched on demand by the Node API next to the image
service — its own process because it needs older diffusers/transformers than the image service's PyTorch
stack, and because it can be unloaded (and its ~4 GB of memory handed back) when it isn't being used.

  GET  /health   → {ready, error, device, loaded}
  POST /inpaint  → PNG; form: file (region), mask (white = fill), steps, side, seed
Cancelling the request (the client hanging up) stops the run at the next denoising step.
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import threading
import time
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, Header, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
from PIL import Image

log = logging.getLogger("inpaint-service")
TOKEN = os.environ.get("INTERNAL_SERVICE_TOKEN", "")
MODELS = Path(os.environ.get("MODELS_DIR", ""))
IDLE_SECONDS = float(os.environ.get("INPAINT_IDLE_SECONDS", "90"))
MAX_BYTES = int(float(os.environ.get("MAX_IMAGE_SIZE_MB", "10")) * 1024 * 1024) * 3

app = FastAPI(title="Inpaint service", docs_url=None, redoc_url=None)
engine = {"model": None, "last_used": 0.0}
load_lock = threading.Lock()
one_at_a_time = threading.BoundedSemaphore(1)


class Cancelled(Exception):
    pass


def authorised(token: str | None) -> bool:
    return bool(TOKEN) and token == TOKEN


def error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"success": False, "error": {"code": code, "message": message}}, status_code=status)


def model():
    """Loaded on first use, and unloaded by the idle watcher: it's the biggest thing this machine runs."""
    with load_lock:
        if engine["model"] is None:
            from powerpaint_engine import PowerPaint

            started = time.perf_counter()
            engine["model"] = PowerPaint(MODELS / "powerpaint-fp16", MODELS / "sd15-parts")
            log.warning("PowerPaint loaded in %.1fs on %s", time.perf_counter() - started, engine["model"].device)
        engine["last_used"] = time.monotonic()
        return engine["model"]


def unload_when_idle() -> None:
    while True:
        time.sleep(10)
        if engine["model"] is not None and time.monotonic() - engine["last_used"] > IDLE_SECONDS and one_at_a_time.acquire(blocking=False):
            try:
                with load_lock:
                    engine["model"] = None
                import gc

                gc.collect()
                import torch

                if torch.backends.mps.is_available():
                    torch.mps.empty_cache()
                log.warning("PowerPaint unloaded (idle)")
            finally:
                one_at_a_time.release()


threading.Thread(target=unload_when_idle, daemon=True).start()


def watch_parent() -> None:
    parent = int(os.environ.get("PARENT_PID", "0") or 0)
    while parent:
        time.sleep(3)
        try:
            os.kill(parent, 0)
        except OSError:
            os._exit(0)


threading.Thread(target=watch_parent, daemon=True).start()


def fill(image_data: bytes, mask_data: bytes, steps: int, side: int, seed: int, cancelled: threading.Event) -> bytes:
    image = np.asarray(Image.open(io.BytesIO(image_data)).convert("RGB"))
    hole = np.asarray(Image.open(io.BytesIO(mask_data)).convert("L").resize((image.shape[1], image.shape[0]))) > 127
    height, width = hole.shape
    # SD 1.5 works at ~512 px, in steps of 8: the region is brought to that size and the result back.
    scale = min(1.0, side / max(height, width))
    work_w, work_h = max(64, round(width * scale / 8) * 8), max(64, round(height * scale / 8) * 8)
    small = cv2.resize(image, (work_w, work_h), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LANCZOS4)
    small_hole = (cv2.resize(hole.astype(np.uint8) * 255, (work_w, work_h), interpolation=cv2.INTER_LINEAR) > 127).astype(np.uint8)

    def on_step(_done: int, _total: int) -> None:
        if cancelled.is_set():
            raise Cancelled

    filled = model().run(small, small_hole, steps=steps, seed=seed, on_step=on_step)
    filled = cv2.resize(filled, (width, height), interpolation=cv2.INTER_LANCZOS4)
    buffer = io.BytesIO()
    Image.fromarray(filled).save(buffer, format="PNG", compress_level=1)
    return buffer.getvalue()


@app.get("/health")
async def health(x_internal_token: str | None = Header(default=None)):
    if not authorised(x_internal_token):
        return error(401, "UNAUTHORIZED", "Unauthorized.")
    ready = (MODELS / "powerpaint-fp16" / "unet").is_dir()
    return {"ready": ready, "error": None if ready else "PowerPaint weights not installed", "loaded": engine["model"] is not None}


@app.post("/inpaint")
async def inpaint(
    request: Request,
    file: UploadFile = File(...),
    mask: UploadFile = File(...),
    steps: int = Form(20),
    side: int = Form(512),
    seed: int = Form(1),
    x_internal_token: str | None = Header(default=None),
):
    if not authorised(x_internal_token):
        return error(401, "UNAUTHORIZED", "Unauthorized.")
    image_data, mask_data = await file.read(MAX_BYTES + 1), await mask.read(MAX_BYTES + 1)
    if len(image_data) > MAX_BYTES or len(mask_data) > MAX_BYTES:
        return error(413, "FILE_TOO_LARGE", "The region is too large.")
    steps, side = max(4, min(50, steps)), max(256, min(768, side))
    cancelled = threading.Event()

    async def hang_up_watcher() -> None:
        while not cancelled.is_set():
            if await request.is_disconnected():
                cancelled.set()
            await asyncio.sleep(0.5)

    watcher = asyncio.create_task(hang_up_watcher())
    await run_in_threadpool(one_at_a_time.acquire)
    started = time.perf_counter()
    try:
        png = await run_in_threadpool(fill, image_data, mask_data, steps, side, seed, cancelled)
    except Cancelled:
        return error(499, "REQUEST_CANCELLED", "Cancelled.")
    except Exception:  # noqa: BLE001
        log.exception("inpainting failed")
        return error(500, "PROCESSING_FAILED", "Inpainting failed.")
    finally:
        one_at_a_time.release()
        cancelled.set()
        watcher.cancel()
    log.warning("PowerPaint filled %s steps in %.1fs", steps, time.perf_counter() - started)
    return Response(png, media_type="image/png", headers={"X-Engine": "powerpaint-v2-1"})
