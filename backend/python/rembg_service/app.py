"""
Internal image service for Studio Tools: background removal, format conversion and face detection.

- Loads one rembg session at startup and reuses it for every request.
- Converts formats the Node side can't decode (HEIC/HEIF, BMP…) to JPEG, orientation applied.
- Detects faces with OpenCV's YuNet model (boxes, eye/nose/mouth landmarks, sharpness, brightness).
- Accepts direct image uploads only (no URL fetching).
- Binds to localhost and requires a shared token, so only the Node API can use it.
- Never returns stack traces, paths or model internals to the caller.
"""

from __future__ import annotations

import hmac
import io
import logging
import os
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, Header, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
from PIL import Image, ImageOps, UnidentifiedImageError

try:  # HEIC/HEIF (and AVIF) decoding for Pillow.
    import pillow_heif

    pillow_heif.register_heif_opener()
except ImportError:  # pragma: no cover — conversion of those formats is then reported as unsupported
    pillow_heif = None

# Models this service may load. The model is chosen by the server operator (REMBG_MODEL), never by a request.
ALLOWED_MODELS = {
    "bria-rmbg",
    "birefnet-general",
    "birefnet-general-lite",
    "birefnet-portrait",
    "isnet-general-use",
    "u2net",
    "u2netp",
    "silueta",
}

MODEL_NAME = os.environ.get("REMBG_MODEL", "bria-rmbg").strip()
TOKEN = os.environ.get("INTERNAL_SERVICE_TOKEN", "")
MAX_BYTES = int(float(os.environ.get("MAX_IMAGE_SIZE_MB", "10")) * 1024 * 1024)
MAX_PIXELS = int(os.environ.get("MAX_IMAGE_PIXELS", str(40_000_000)))
CONCURRENCY = max(1, int(os.environ.get("BACKGROUND_REMOVAL_CONCURRENCY", "2")))
# Decontamination removes background colour bleeding into semi-transparent edges.
DEFAULT_DECONTAMINATE = os.environ.get("REMBG_DECONTAMINATE", "true").lower() == "true"
DEFAULT_ALPHA_MATTING = os.environ.get("REMBG_ALPHA_MATTING", "false").lower() == "true"
# CPU by default: on macOS, onnxruntime's CoreML provider takes minutes to compile these graphs and runs
# them slower than the CPU. Set REMBG_PROVIDERS (comma-separated onnxruntime providers) to override.
PROVIDERS = [p.strip() for p in os.environ.get("REMBG_PROVIDERS", "CPUExecutionProvider").split(",") if p.strip()]

ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
# What /convert accepts. Decided by Pillow from the file's content, never from its name.
CONVERTIBLE_FORMATS = ALLOWED_FORMATS | {"HEIF", "AVIF", "TIFF", "BMP", "GIF", "MPO"}

# OpenCV YuNet face detector (downloaded by scripts/setup-ml.sh).
FACE_MODEL = os.environ.get("FACE_DETECTOR_MODEL") or os.path.join(os.environ.get("U2NET_HOME", ""), "face_detection_yunet_2023mar.onnx")
# Faces are found on a copy no larger than this; coordinates are reported at full size.
FACE_DETECT_MAX_SIDE = 1280
# PP-OCRv3 text detector (downloaded by scripts/setup-ml.sh), used to find text watermarks.
TEXT_MODEL = os.environ.get("TEXT_DETECTOR_MODEL") or os.path.join(os.environ.get("U2NET_HOME", ""), "text_detection_en_ppocrv3_2023may.onnx")
# Watermark text is often small and faint; it needs more pixels than faces do.
WATERMARK_DETECT_MAX_SIDE = 1920
# How much brighter than its surroundings a stroke must be to count as an overlaid mark (0–1).
MARK_MIN_STRENGTH = 0.17
# Logo-only candidates (no text found in them) never score above this.
LOGO_MAX_CONFIDENCE = 0.5
# LaMa inpainting (ONNX, downloaded by scripts/setup-ml.sh). Works at a fixed 512 × 512.
INPAINT_MODEL = os.environ.get("INPAINT_MODEL") or os.path.join(os.environ.get("U2NET_HOME", ""), "lama_fp32.onnx")
INPAINT_SIDE = 512
# Regions larger than this are filled tile by tile (stride < tile, so tiles overlap).
INPAINT_TILE = 768
INPAINT_STRIDE = 512
# A tile needs surroundings to rebuild from: above this share of hole, the region is done in one pass.
INPAINT_MAX_TILE_HOLE = 0.35
# Marks closer together than this (in pixels) are filled in one crop.
INPAINT_GROUP = 1024

# Pillow refuses images above this many pixels (decompression-bomb protection).
Image.MAX_IMAGE_PIXELS = MAX_PIXELS

logging.basicConfig(level=logging.INFO, format="[rembg] %(levelname)s %(message)s")
log = logging.getLogger("rembg_service")

state: dict[str, object] = {"session": None, "error": None, "loaded_at": None}
slots = threading.BoundedSemaphore(CONCURRENCY)


def error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"success": False, "code": code, "message": message})


def watch_parent() -> None:
    """Exit if the Node process that launched us goes away, so no orphaned model process is left running."""
    parent = int(os.environ.get("PARENT_PID", "0") or 0)
    if parent <= 0:
        return

    def loop() -> None:
        while True:
            time.sleep(2)
            if os.getppid() != parent:
                log.info("parent process exited; shutting down")
                os._exit(0)

    threading.Thread(target=loop, daemon=True, name="parent-watchdog").start()


@asynccontextmanager
async def lifespan(_: FastAPI):
    watch_parent()
    if MODEL_NAME == "none":
        # No background removal (a small server): the rest of the service — PDFs, conversion,
        # detection — runs without the model's memory.
        log.info("background removal is off (REMBG_MODEL=none)")
    elif MODEL_NAME not in ALLOWED_MODELS:
        state["error"] = "unsupported-model"
        log.error("REMBG_MODEL '%s' is not in the allowed list", MODEL_NAME)
    else:
        started = time.perf_counter()
        try:
            from rembg import new_session

            state["session"] = await run_in_threadpool(lambda: new_session(MODEL_NAME, providers=PROVIDERS))
            state["loaded_at"] = time.time()
            log.info("model '%s' ready in %.1fs", MODEL_NAME, time.perf_counter() - started)
        except Exception:  # noqa: BLE001 — logged server-side, reported generically
            state["error"] = "model-load-failed"
            log.exception("failed to load model '%s'", MODEL_NAME)
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def authorised(token: str | None) -> bool:
    return bool(TOKEN) and token is not None and hmac.compare_digest(token, TOKEN)


@app.get("/health")
async def health(x_internal_token: str | None = Header(default=None)):
    if not authorised(x_internal_token):
        return error(401, "UNAUTHORIZED", "Unauthorized.")
    return {
        "ready": state["session"] is not None or MODEL_NAME == "none",
        "model": MODEL_NAME,
        "error": state["error"],
    }


def decode(data: bytes) -> Image.Image:
    """Fully decode the upload, reject anything that isn't a real JPEG/PNG/WebP, and apply EXIF orientation."""
    with Image.open(io.BytesIO(data)) as probe:
        if probe.format not in ALLOWED_FORMATS:
            raise ValueError("format")
        probe.verify()
    image = Image.open(io.BytesIO(data))
    image.load()
    image = ImageOps.exif_transpose(image)
    return image.convert("RGBA") if image.mode not in ("RGB", "RGBA") else image


def process(image: Image.Image, alpha_matting: bool, decontaminate: bool) -> bytes:
    from rembg import remove

    result = remove(
        image,
        session=state["session"],
        alpha_matting=alpha_matting,
        decontaminate=decontaminate,
        post_process_mask=False,
    )
    buffer = io.BytesIO()
    result.save(buffer, format="PNG", optimize=False, compress_level=6)
    return buffer.getvalue()


@app.post("/remove-background")
async def remove_background(
    file: UploadFile = File(...),
    alpha_matting: bool = Form(DEFAULT_ALPHA_MATTING),
    decontaminate: bool = Form(DEFAULT_DECONTAMINATE),
    x_internal_token: str | None = Header(default=None),
):
    if not authorised(x_internal_token):
        return error(401, "UNAUTHORIZED", "Unauthorized.")
    if state["session"] is None:
        return error(503, "BACKGROUND_REMOVAL_UNAVAILABLE", "Background removal is temporarily unavailable.")

    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        return error(413, "FILE_TOO_LARGE", "The image is too large.")

    try:
        image = await run_in_threadpool(decode, data)
    except (UnidentifiedImageError, ValueError, OSError, Image.DecompressionBombError):
        return error(422, "INVALID_IMAGE", "The file could not be read as an image.")

    # Bound concurrent model runs; wait for a slot off the event loop.
    await run_in_threadpool(slots.acquire)
    started = time.perf_counter()
    try:
        png = await run_in_threadpool(process, image, alpha_matting, decontaminate)
    except Exception:  # noqa: BLE001
        log.exception("background removal failed")
        return error(500, "PROCESSING_FAILED", "Background removal failed.")
    finally:
        slots.release()

    log.info("processed %sx%s in %.2fs", image.width, image.height, time.perf_counter() - started)
    return Response(
        content=png,
        media_type="image/png",
        headers={"X-Image-Width": str(image.width), "X-Image-Height": str(image.height)},
    )


# ---------------------------------------------------------------- format conversion


def open_any(data: bytes) -> tuple[Image.Image, str, int]:
    """Decode any convertible format, fully, with EXIF orientation applied. Returns (image, format, original orientation)."""
    with Image.open(io.BytesIO(data)) as probe:
        source_format = probe.format or ""
        if source_format not in CONVERTIBLE_FORMATS:
            raise ValueError("format")
    image = Image.open(io.BytesIO(data))
    if getattr(image, "n_frames", 1) > 1:
        image.seek(0)  # animated GIF/WebP: the first frame
    image.load()
    # HEIF decoding already turns the image upright and resets the tag, keeping the original aside.
    orientation = int(image.info.get("original_orientation") or image.getexif().get(0x0112, 1) or 1)
    image = ImageOps.exif_transpose(image)
    return image, source_format, orientation


def to_jpeg(image: Image.Image) -> bytes:
    """Highest-quality JPEG of the image: transparency flattened onto white, colour profile kept."""
    icc = image.info.get("icc_profile")
    if image.mode in ("RGBA", "LA", "PA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        flat = Image.new("RGB", rgba.size, (255, 255, 255))
        flat.paste(rgba, mask=rgba.getchannel("A"))
        image = flat
    elif image.mode != "RGB":
        image = image.convert("RGB")
    buffer = io.BytesIO()
    options = {"quality": 95, "subsampling": 0, "optimize": True}
    if icc:
        options["icc_profile"] = icc
    image.save(buffer, format="JPEG", **options)
    return buffer.getvalue()


@app.post("/convert")
async def convert(file: UploadFile = File(...), x_internal_token: str | None = Header(default=None)):
    if not authorised(x_internal_token):
        return error(401, "UNAUTHORIZED", "Unauthorized.")
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        return error(413, "FILE_TOO_LARGE", "The image is too large.")
    try:
        image, source_format, orientation = await run_in_threadpool(open_any, data)
        jpeg = await run_in_threadpool(to_jpeg, image)
    except ValueError:
        return error(415, "UNSUPPORTED_MEDIA_TYPE", "This image format isn't supported.")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        return error(422, "INVALID_IMAGE", "The file could not be read as an image.")
    except Exception:  # noqa: BLE001
        log.exception("conversion failed")
        return error(500, "CONVERSION_FAILED", "The image could not be converted.")
    return Response(
        content=jpeg,
        media_type="image/jpeg",
        headers={
            "X-Image-Width": str(image.width),
            "X-Image-Height": str(image.height),
            "X-Source-Format": source_format,
            "X-Source-Orientation": str(orientation),
        },
    )


# ---------------------------------------------------------------- face detection


def detect_faces(data: bytes) -> dict:
    import cv2
    import numpy as np

    pixels = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
    if pixels is None:
        raise ValueError("decode")
    height, width = pixels.shape[:2]
    if width * height > MAX_PIXELS:
        raise ValueError("size")
    scale = min(1.0, FACE_DETECT_MAX_SIDE / max(width, height))
    small = cv2.resize(pixels, (max(1, round(width * scale)), max(1, round(height * scale))), interpolation=cv2.INTER_AREA) if scale < 1 else pixels
    detector = cv2.FaceDetectorYN.create(FACE_MODEL, "", (small.shape[1], small.shape[0]), 0.75, 0.3, 50)
    _, found = detector.detect(small)
    gray = cv2.cvtColor(pixels, cv2.COLOR_BGR2GRAY)

    faces = []
    for row in [] if found is None else found:
        values = [float(v) / scale for v in row[:14]]
        x, y, w, h = values[0:4]
        point = lambda i: {"x": values[4 + i * 2], "y": values[5 + i * 2]}  # noqa: E731
        # Quality of the face itself: sharpness (variance of the Laplacian at a fixed size) and brightness.
        left, top = max(0, int(x)), max(0, int(y))
        right, bottom = min(width, int(x + w)), min(height, int(y + h))
        sharpness = brightness = 0.0
        if right - left >= 8 and bottom - top >= 8:
            roi = gray[top:bottom, left:right]
            roi = cv2.resize(roi, (256, max(8, round(256 * roi.shape[0] / roi.shape[1]))), interpolation=cv2.INTER_AREA)
            sharpness = float(cv2.Laplacian(roi, cv2.CV_64F).var())
            brightness = float(roi.mean())
        faces.append(
            {
                "box": {"x": x, "y": y, "width": w, "height": h},
                "score": float(row[14]),
                # YuNet's order: right eye, left eye (the subject's), nose tip, right and left mouth corners.
                "landmarks": {"rightEye": point(0), "leftEye": point(1), "nose": point(2), "mouthRight": point(3), "mouthLeft": point(4)},
                "sharpness": sharpness,
                "brightness": brightness,
            }
        )
    faces.sort(key=lambda face: face["box"]["width"] * face["box"]["height"], reverse=True)
    return {"width": width, "height": height, "faces": faces}


@app.post("/detect-faces")
async def detect(file: UploadFile = File(...), x_internal_token: str | None = Header(default=None)):
    if not authorised(x_internal_token):
        return error(401, "UNAUTHORIZED", "Unauthorized.")
    if not os.path.isfile(FACE_MODEL):
        return error(503, "FACE_DETECTION_UNAVAILABLE", "Face detection isn't set up on this server.")
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        return error(413, "FILE_TOO_LARGE", "The image is too large.")
    try:
        return await run_in_threadpool(detect_faces, data)
    except ValueError:
        return error(422, "INVALID_IMAGE", "The file could not be read as an image.")
    except Exception:  # noqa: BLE001
        log.exception("face detection failed")
        return error(500, "PROCESSING_FAILED", "Face detection failed.")


# ---------------------------------------------------------------- watermark detection


def _location_prior(x: float, y: float, w: float, h: float, width: int, height: int) -> float:
    """Watermarks sit in corners, along the bottom, or across the centre; other text sits anywhere."""
    cx, cy = (x + w / 2) / width, (y + h / 2) / height
    near_left, near_right = x / width < 0.22, (x + w) / width > 0.78
    near_top, near_bottom = y / height < 0.22, (y + h) / height > 0.78
    corner = (near_left or near_right) and (near_top or near_bottom)
    centre = abs(cx - 0.5) < 0.15 and abs(cy - 0.5) < 0.15
    bottom_band = (y + h) / height > 0.85
    return 1.0 if corner or centre or bottom_band else 0.75


def _text_regions(image, scale: float) -> list[dict]:
    import cv2
    import numpy as np

    if not os.path.isfile(TEXT_MODEL):
        return []
    height, width = image.shape[:2]
    # The model wants sides that are multiples of 32.
    size = (max(32, round(width / 32) * 32), max(32, round(height / 32) * 32))
    model = cv2.dnn_TextDetectionModel_DB(TEXT_MODEL)
    model.setBinaryThreshold(0.3)
    model.setPolygonThreshold(0.5)
    model.setMaxCandidates(200)
    model.setUnclipRatio(2.0)
    model.setInputParams(1.0 / 255.0, size, (122.67891434, 116.66876762, 104.00698793), True)
    polygons, scores = model.detect(image)
    regions = []
    for polygon, score in zip(polygons, scores):
        points = np.asarray(polygon, dtype=np.float32).reshape(-1, 2)
        (_, _), (rw, rh), angle = cv2.minAreaRect(points)
        # minAreaRect reports the angle of whichever side it picked; normalise to the text's own slant.
        if rw < rh:
            angle += 90
        angle = ((angle + 90) % 180) - 90
        x, y = points.min(axis=0)
        x2, y2 = points.max(axis=0)
        regions.append(
            {
                "type": "text",
                "score": float(score),
                "polygon": (points / scale).round(1).tolist(),
                "box": {"x": float(x / scale), "y": float(y / scale), "width": float((x2 - x) / scale), "height": float((y2 - y) / scale)},
                "angle": float(angle),
                "lineHeight": float(min(rw, rh) / scale),
                "elongation": float(max(rw, rh) / max(1.0, min(rw, rh))),
            }
        )
    return regions


def _join_lines(regions: list[dict]) -> list[dict]:
    """Pieces of one line of text (a "©" and the words after it) become one region."""
    import numpy as np

    regions = sorted(regions, key=lambda region: region["box"]["x"])
    joined: list[dict] = []
    for region in regions:
        box = region["box"]
        mate = next(
            (
                other
                for other in joined
                if abs(other["angle"] - region["angle"]) < 8
                and abs((other["box"]["y"] + other["box"]["height"] / 2) - (box["y"] + box["height"] / 2)) < max(other["box"]["height"], box["height"]) * 0.5
                and box["x"] - (other["box"]["x"] + other["box"]["width"]) < max(other["lineHeight"], region["lineHeight"]) * 1.2
                and box["x"] + box["width"] > other["box"]["x"]
            ),
            None,
        )
        if mate is None:
            joined.append(dict(region))
            continue
        points = np.asarray(mate["polygon"] + region["polygon"], dtype=np.float32)
        x, y = points.min(axis=0)
        x2, y2 = points.max(axis=0)
        mate["box"] = {"x": float(x), "y": float(y), "width": float(x2 - x), "height": float(y2 - y)}
        if abs(mate["angle"]) < 5:
            mate["polygon"] = [[float(x), float(y)], [float(x2), float(y)], [float(x2), float(y2)], [float(x), float(y2)]]
        else:
            import cv2

            mate["polygon"] = cv2.boxPoints(cv2.minAreaRect(points)).round(1).tolist()
        mate["score"] = max(mate["score"], region["score"])
        mate["elongation"] = max(mate.get("elongation", 1.0), float((x2 - x) / max(1.0, y2 - y)))
    return joined


def _overlay_regions(image, scale: float) -> list[dict]:
    """
    Semi-transparent overlays (logos, marks): thin, bright, low-saturation strokes laid over the photo.
    A top-hat filter keeps small bright structures and drops large bright objects, and the low
    saturation keeps white/grey marks while dropping bright coloured details.
    """
    import cv2
    import numpy as np

    height, width = image.shape[:2]
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    value, saturation = hsv[..., 2], hsv[..., 1]
    k = max(9, (min(width, height) // 40) | 1)
    tophat = cv2.morphologyEx(value, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    strokes = ((tophat > 22) & (saturation < 70)).astype(np.uint8) * 255
    merged = cv2.morphologyEx(strokes, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    count, _, stats, _ = cv2.connectedComponentsWithStats(merged, connectivity=8)
    area_total = width * height
    regions = []
    for index in range(1, count):
        x, y, w, h, area = stats[index]
        if not (0.002 * area_total <= w * h <= 0.25 * area_total) or w >= width * 0.95 or h >= height * 0.95:
            continue
        # Without text to go on, only marks where watermarks are put count — bright strokes elsewhere are
        # far more often part of the picture (feathers, reflections, lace).
        if _location_prior(x, y, w, h, width, height) < 1.0:
            continue
        density = float(np.count_nonzero(strokes[y : y + h, x : x + w])) / float(w * h)
        # Marks are drawn with strokes: neither empty nor solid.
        if not 0.04 <= density <= 0.55:
            continue
        strength = float(np.mean(tophat[y : y + h, x : x + w][strokes[y : y + h, x : x + w] > 0])) / 255.0
        # Overlaid marks stand clearly out from what's under them (measured: marks ~0.22+, bright
        # details of the photo itself ~0.12).
        if strength < MARK_MIN_STRENGTH:
            continue
        regions.append(
            {
                "type": "logo",
                # Without a trained logo model this signal is a hint, not proof (bright lines in a photo can
                # look the same), so it stays a low-confidence suggestion that isn't pre-selected.
                "score": min(LOGO_MAX_CONFIDENCE, 0.3 + strength),
                "polygon": [[x / scale, y / scale], [(x + w) / scale, y / scale], [(x + w) / scale, (y + h) / scale], [x / scale, (y + h) / scale]],
                "box": {"x": x / scale, "y": y / scale, "width": w / scale, "height": h / scale},
                "angle": 0.0,
            }
        )
    regions.sort(key=lambda region: region["score"], reverse=True)
    return regions[:2]


def _overlap(a: dict, b: dict) -> float:
    ax, ay, aw, ah = a["box"]["x"], a["box"]["y"], a["box"]["width"], a["box"]["height"]
    bx, by, bw, bh = b["box"]["x"], b["box"]["y"], b["box"]["width"], b["box"]["height"]
    ix = max(0.0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0.0, min(ay + ah, by + bh) - max(ay, by))
    smaller = min(aw * ah, bw * bh) or 1.0
    return ix * iy / smaller


def detect_watermarks(data: bytes) -> dict:
    import cv2
    import numpy as np

    pixels = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
    if pixels is None:
        raise ValueError("decode")
    height, width = pixels.shape[:2]
    if width * height > MAX_PIXELS:
        raise ValueError("size")
    scale = min(1.0, WATERMARK_DETECT_MAX_SIDE / max(width, height))
    small = cv2.resize(pixels, (max(1, round(width * scale)), max(1, round(height * scale))), interpolation=cv2.INTER_AREA) if scale < 1 else pixels

    texts = _join_lines(_text_regions(small, scale))
    # Tiled watermarks repeat the same text at the same size: three or more lines of similar height.
    heights = [region["lineHeight"] for region in texts]
    for region in texts:
        similar = sum(1 for other in heights if abs(other - region["lineHeight"]) <= region["lineHeight"] * 0.2)
        if similar >= 3:
            region["type"] = "pattern"
    # A mark around detected text (a logo with a word in it) becomes one region covering both.
    overlays = []
    for overlay in _overlay_regions(small, scale):
        text = next((text for text in texts if _overlap(overlay, text) > 0.3), None)
        if text is None:
            overlays.append(overlay)
            continue
        a, b = text["box"], overlay["box"]
        x, y = min(a["x"], b["x"]), min(a["y"], b["y"])
        x2, y2 = max(a["x"] + a["width"], b["x"] + b["width"]), max(a["y"] + a["height"], b["y"] + b["height"])
        text["box"] = {"x": x, "y": y, "width": x2 - x, "height": y2 - y}
        text["polygon"] = [[x, y], [x2, y], [x2, y2], [x, y2]]
        text["angle"] = 0.0
        text["type"] = "logo"
        text["lineHeight"] = float("inf")

    detections = []
    for region in texts + overlays:
        box = region["box"]
        confidence = region["score"] * _location_prior(box["x"], box["y"], box["width"], box["height"], width, height)
        # Words are long and thin; a squarish "text" box is more often a textured part of the photo.
        if region["type"] in ("text", "pattern") and region.get("elongation", 3.0) < 1.8:
            confidence *= 0.6
        # Watermark text runs across the picture; near-vertical "text" is rarely one.
        if region["type"] == "text" and abs(region.get("angle", 0.0)) > 60:
            confidence *= 0.8
        if region["type"] == "pattern":
            confidence = min(1.0, confidence + 0.1)
        if abs(region.get("angle", 0.0)) > 12:
            confidence = min(1.0, confidence + 0.05)
        if confidence < 0.4:
            continue
        detections.append(
            {
                "type": region["type"],
                "confidence": round(float(confidence), 3),
                "box": {key: round(float(value), 1) for key, value in box.items()},
                "polygon": region["polygon"],
                "angle": round(float(region.get("angle", 0.0)), 1),
            }
        )
    detections.sort(key=lambda item: item["confidence"], reverse=True)
    return {"width": width, "height": height, "detections": detections[:12], "textModel": os.path.isfile(TEXT_MODEL)}


@app.post("/detect-watermarks")
async def detect_watermark_regions(file: UploadFile = File(...), x_internal_token: str | None = Header(default=None)):
    if not authorised(x_internal_token):
        return error(401, "UNAUTHORIZED", "Unauthorized.")
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        return error(413, "FILE_TOO_LARGE", "The image is too large.")
    try:
        return await run_in_threadpool(detect_watermarks, data)
    except ValueError:
        return error(422, "INVALID_IMAGE", "The file could not be read as an image.")
    except Exception:  # noqa: BLE001
        log.exception("watermark detection failed")
        return error(500, "PROCESSING_FAILED", "Watermark detection failed.")


# ---------------------------------------------------------------- inpainting (LaMa)

lama: dict[str, object] = {"session": None}
lama_lock = threading.Lock()
# One inpainting at a time: it's the heaviest thing this service runs.
lama_slots = threading.BoundedSemaphore(1)


def lama_session():
    with lama_lock:
        if lama["session"] is None:
            import onnxruntime as ort

            lama["session"] = ort.InferenceSession(INPAINT_MODEL, providers=PROVIDERS)
        return lama["session"]


def _lama(pixels, holes):
    """One LaMa pass on a region (any size): padded to a square, run at 512 × 512, brought back."""
    import numpy as np

    height, width = holes.shape
    side = max(width, height)
    square = np.pad(pixels, ((0, side - height), (0, side - width), (0, 0)), mode="edge")
    square_mask = np.pad(holes.astype(np.uint8) * 255, ((0, side - height), (0, side - width)), mode="constant")
    small = np.asarray(Image.fromarray(square).resize((INPAINT_SIDE, INPAINT_SIDE), Image.Resampling.LANCZOS), dtype=np.float32) / 255.0
    small_mask = (np.asarray(Image.fromarray(square_mask).resize((INPAINT_SIDE, INPAINT_SIDE), Image.Resampling.BILINEAR)) > 16).astype(np.float32)
    session = lama_session()
    inputs = session.get_inputs()
    result = session.run(None, {inputs[0].name: small.transpose(2, 0, 1)[None], inputs[1].name: small_mask[None, None]})[0][0]
    filled = Image.fromarray(np.clip(result.transpose(1, 2, 0), 0, 255).astype(np.uint8)).resize((side, side), Image.Resampling.BICUBIC)
    return np.asarray(filled)[:height, :width]


def _tiles(holes) -> list[tuple[slice, slice]]:
    """Overlapping windows covering every hole, each with some surroundings."""
    import numpy as np

    height, width = holes.shape
    ys, xs = np.nonzero(holes)
    if not ys.size:
        return []

    def starts(low: int, high: int, limit: int) -> list[int]:
        first = max(0, min(low - INPAINT_TILE // 4, limit - INPAINT_TILE))
        positions = list(range(first, max(first, high - INPAINT_TILE // 4) + 1, INPAINT_STRIDE)) or [first]
        return sorted({min(max(0, position), max(0, limit - INPAINT_TILE)) for position in positions})

    windows = []
    for top in starts(int(ys.min()), int(ys.max()), height):
        for left in starts(int(xs.min()), int(xs.max()), width):
            window = (slice(top, top + INPAINT_TILE), slice(left, left + INPAINT_TILE))
            if holes[window].any():
                windows.append(window)
    return windows


def _fill(pixels, holes) -> None:
    """
    Fills the holes of one region in place. A region that fits a tile goes through in one pass. A
    bigger one with thin, spread-out holes (lines of text) goes tile by tile close to full resolution,
    so it isn't shrunk to 512 px and blurred on the way back up — unless a tile would be mostly hole
    (nothing around it to rebuild from), in which case the region goes through in one pass instead.
    """
    height, width = holes.shape
    windows = _tiles(holes) if max(width, height) > INPAINT_TILE else []
    if not windows or any(holes[window].mean() > INPAINT_MAX_TILE_HOLE for window in windows):
        filled = _lama(pixels, holes)
        pixels[holes] = filled[holes]
        return
    for window in windows:
        # Each tile sees what earlier tiles already rebuilt, so neighbours continue each other.
        hole = holes[window]
        filled = _lama(pixels[window], hole)
        pixels[window][hole] = filled[hole]


def _groups(holes) -> list[tuple[int, int, int, int]]:
    """
    The marks, gathered into as few compact groups as possible: nearby marks share a group while the
    group stays within INPAINT_GROUP pixels. Each group becomes one crop — far fewer model runs than
    one big box around everything, and each run sees its area close to full resolution.
    """
    import cv2
    import numpy as np

    count, _, stats, _ = cv2.connectedComponentsWithStats(holes.astype(np.uint8), connectivity=8)
    boxes = sorted(((int(x), int(y), int(x + w), int(y + h)) for x, y, w, h, _ in stats[1:count]), key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True)
    groups: list[list[int]] = []
    for x0, y0, x1, y1 in boxes:
        for group in groups:
            ux0, uy0, ux1, uy1 = min(group[0], x0), min(group[1], y0), max(group[2], x1), max(group[3], y1)
            if max(ux1 - ux0, uy1 - uy0) <= INPAINT_GROUP:
                group[:] = [ux0, uy0, ux1, uy1]
                break
        else:
            groups.append([x0, y0, x1, y1])
    return [tuple(group) for group in groups]  # type: ignore[misc]


def inpaint(image_data: bytes, mask_data: bytes) -> bytes:
    """
    Rebuilds the white area of the mask from its surroundings with LaMa, group by group, each with a
    margin of context around it. Only masked pixels are ever replaced.
    """
    import numpy as np

    image = Image.open(io.BytesIO(image_data)).convert("RGB")
    mask = Image.open(io.BytesIO(mask_data)).convert("L").resize(image.size)
    pixels = np.array(image)
    holes = np.asarray(mask) > 16
    height, width = holes.shape
    for x0, y0, x1, y1 in _groups(holes):
        margin = max(48, (max(x1 - x0, y1 - y0)) // 3)
        window = (slice(max(0, y0 - margin), min(height, y1 + margin)), slice(max(0, x0 - margin), min(width, x1 + margin)))
        if max(x1 - x0, y1 - y0) <= INPAINT_GROUP:
            # A compact group: one pass sees all of it, with its surroundings.
            hole = holes[window]
            filled = _lama(pixels[window], hole)
            pixels[window][hole] = filled[hole]
        else:
            # One mark larger than a group (e.g. across the whole picture): tiles, where they can work.
            _fill(pixels[window], holes[window])
    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, format="PNG", compress_level=1)
    return buffer.getvalue()


@app.post("/inpaint")
async def inpaint_region(file: UploadFile = File(...), mask: UploadFile = File(...), x_internal_token: str | None = Header(default=None)):
    if not authorised(x_internal_token):
        return error(401, "UNAUTHORIZED", "Unauthorized.")
    if not os.path.isfile(INPAINT_MODEL):
        return error(503, "RETOUCH_UNAVAILABLE", "Inpainting isn't set up on this server.")
    image_data = await file.read(MAX_BYTES + 1)
    mask_data = await mask.read(MAX_BYTES + 1)
    if len(image_data) > MAX_BYTES or len(mask_data) > MAX_BYTES:
        return error(413, "FILE_TOO_LARGE", "The image is too large.")
    await run_in_threadpool(lama_slots.acquire)
    started = time.perf_counter()
    try:
        png = await run_in_threadpool(inpaint, image_data, mask_data)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        return error(422, "INVALID_IMAGE", "The file could not be read as an image.")
    except Exception:  # noqa: BLE001
        log.exception("inpainting failed")
        return error(500, "PROCESSING_FAILED", "Inpainting failed.")
    finally:
        lama_slots.release()
    log.info("inpainted in %.2fs", time.perf_counter() - started)
    return Response(content=png, media_type="image/png")


# ---------------------------------------------------------------- PDF pages

# PDF files are read only from the Node API's documents workspace — a path anywhere else is refused.
DOCUMENTS_ROOT = os.path.realpath(os.environ.get("DOCUMENTS_TEMP_DIR", "") or "/nonexistent")
# PDFium isn't thread-safe: one page at a time.
pdf_lock = threading.Lock()


def render_pdf_page(path: str, page: int, scale: float, max_pixels: int) -> bytes:
    import pypdfium2 as pdfium

    with pdf_lock:
        document = pdfium.PdfDocument(path)
        try:
            if page < 0 or page >= len(document):
                raise ValueError("page")
            pdf_page = document[page]
            width, height = pdf_page.get_size()
            # Never more pixels than allowed, whatever resolution was asked for.
            scale = min(scale, (max_pixels / max(1.0, width * height)) ** 0.5)
            bitmap = pdf_page.render(scale=scale, fill_color=(255, 255, 255, 255), may_draw_forms=True)
            image = bitmap.to_pil()
            pdf_page.close()
        finally:
            document.close()
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", compress_level=1)
    return buffer.getvalue()


@app.post("/pdf/render")
async def pdf_render(
    path: str = Form(...),
    page: int = Form(...),
    scale: float = Form(...),
    max_pixels: int = Form(...),
    x_internal_token: str | None = Header(default=None),
):
    if not authorised(x_internal_token):
        return error(401, "UNAUTHORIZED", "Unauthorized.")
    real = os.path.realpath(path)
    if not real.startswith(DOCUMENTS_ROOT + os.sep) or not os.path.isfile(real):
        return error(400, "INVALID_REQUEST", "Invalid document.")
    if not (0 < scale <= 12) or max_pixels <= 0:
        return error(400, "INVALID_REQUEST", "Invalid resolution.")
    try:
        png = await run_in_threadpool(render_pdf_page, real, page, scale, max_pixels)
    except ValueError:
        return error(400, "INVALID_REQUEST", "Invalid page.")
    except Exception:  # noqa: BLE001 — damaged or unsupported PDF; details stay in the log
        log.exception("pdf render failed")
        return error(422, "INVALID_PDF", "The PDF could not be read.")
    return Response(content=png, media_type="image/png")


def inside_documents(path: str) -> str | None:
    """The real path, if it's inside the documents workspace root; None otherwise."""
    real = os.path.realpath(path)
    return real if real.startswith(DOCUMENTS_ROOT + os.sep) else None


# ---------------------------------------------------------------- PDF compression


def compress_pdf(source: str, target: str, quality: int, max_side: int) -> dict:
    """
    Real compression: photos inside the PDF are re-encoded as JPEG at the given quality and reduced to
    at most `max_side` pixels on their long side; streams are recompressed and packed into object
    streams; unused resources are dropped. An image is only replaced when that makes it smaller, and
    images whose colours or masks wouldn't survive re-encoding (CMYK, 1-bit, colour-keyed, custom
    decode) are left exactly as they are.
    """
    import pikepdf
    from pikepdf import Name, PdfImage

    with pdf_lock:
        pdf = pikepdf.open(source)
        examined = replaced = 0
        for obj in pdf.objects:
            if not isinstance(obj, pikepdf.Stream) or obj.get("/Subtype") != "/Image":
                continue
            examined += 1
            if obj.get("/ImageMask") or "/Mask" in obj or "/Decode" in obj or obj.get("/BitsPerComponent", 8) != 8:
                continue
            try:
                image = PdfImage(obj).as_pil_image()
            except Exception:  # noqa: BLE001 — formats Pillow can't decode stay untouched
                continue
            if image.mode not in ("RGB", "L"):
                if image.mode in ("CMYK", "P", "1", "I", "F"):
                    continue
                image = image.convert("RGB")
            width, height = image.size
            scale = min(1.0, max_side / max(width, height))
            if scale < 1:
                image = image.resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.LANCZOS)
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=quality, optimize=True, progressive=True)
            data = buffer.getvalue()
            if len(data) >= len(obj.read_raw_bytes()):
                continue
            obj.write(data, filter=Name.DCTDecode)
            obj.Width, obj.Height = image.width, image.height
            obj.ColorSpace = Name.DeviceRGB if image.mode == "RGB" else Name.DeviceGray
            obj.BitsPerComponent = 8
            if "/DecodeParms" in obj:
                del obj["/DecodeParms"]
            replaced += 1
        pdf.remove_unreferenced_resources()
        pdf.save(target, compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.generate, recompress_flate=True)
        pdf.close()
    return {"images": examined, "recompressed": replaced}


@app.post("/pdf/compress")
async def pdf_compress(
    source: str = Form(...),
    target: str = Form(...),
    quality: int = Form(...),
    max_side: int = Form(...),
    x_internal_token: str | None = Header(default=None),
):
    if not authorised(x_internal_token):
        return error(401, "UNAUTHORIZED", "Unauthorized.")
    real_source, real_target = inside_documents(source), inside_documents(target)
    if not real_source or not real_target or not os.path.isfile(real_source) or os.path.dirname(real_source) != os.path.dirname(real_target):
        return error(400, "INVALID_REQUEST", "Invalid document.")
    if not (20 <= quality <= 100) or not (256 <= max_side <= 10000):
        return error(400, "INVALID_REQUEST", "Invalid settings.")
    try:
        import pikepdf

        return await run_in_threadpool(compress_pdf, real_source, real_target, quality, max_side)
    except pikepdf.PasswordError:
        return error(422, "PDF_ENCRYPTED", "The PDF is password-protected.")
    except Exception:  # noqa: BLE001
        log.exception("pdf compress failed")
        return error(422, "INVALID_PDF", "The PDF could not be read.")


# ---------------------------------------------------------------- PDF text layer


def pdf_text(path: str) -> list[dict]:
    """Each page's own text (the PDF's text layer), and whether the page has pictures — a page with
    pictures but next to no text is most likely a scan, which needs OCR."""
    import ctypes

    import pypdfium2 as pdfium
    import pypdfium2.raw as pdfium_c

    pages = []
    with pdf_lock:
        document = pdfium.PdfDocument(path)
        try:
            for index in range(len(document)):
                page = document[index]
                textpage = page.get_textpage()
                text = textpage.get_text_range()
                images = sum(1 for _ in page.get_objects(filter=[pdfium_c.FPDF_PAGEOBJ_IMAGE], max_depth=2))
                # Font names say whether the text is in a legacy (non-Unicode) Nepali font like Preeti.
                fonts = set()
                for obj in page.get_objects(filter=[pdfium_c.FPDF_PAGEOBJ_TEXT], max_depth=2):
                    font = pdfium_c.FPDFTextObj_GetFont(obj.raw)
                    size = pdfium_c.FPDFFont_GetBaseFontName(font, None, 0) if font else 0
                    if size:
                        buffer = ctypes.create_string_buffer(size)
                        pdfium_c.FPDFFont_GetBaseFontName(font, buffer, size)
                        fonts.add(buffer.value.decode("latin-1").split("+")[-1])
                    if len(fonts) >= 20:
                        break
                textpage.close()
                page.close()
                # PDFium ends lines with \r\n; one newline is enough.
                pages.append({"text": text.replace("\r\n", "\n").replace("\r", "\n"), "images": images, "fonts": sorted(fonts)})
        finally:
            document.close()
    return pages


@app.post("/pdf/text")
async def pdf_text_endpoint(path: str = Form(...), x_internal_token: str | None = Header(default=None)):
    if not authorised(x_internal_token):
        return error(401, "UNAUTHORIZED", "Unauthorized.")
    real = inside_documents(path)
    if not real or not os.path.isfile(real):
        return error(400, "INVALID_REQUEST", "Invalid document.")
    try:
        return {"pages": await run_in_threadpool(pdf_text, real)}
    except Exception:  # noqa: BLE001
        log.exception("pdf text failed")
        return error(422, "INVALID_PDF", "The PDF could not be read.")


# ---------------------------------------------------------------- PDF protection


def protect_pdf(source: str, target: str, user_password: str, owner_password: str, allow_print: bool, allow_copy: bool, allow_edit: bool) -> dict:
    """AES-256 (PDF 2.0 / R6) encryption: the open password, and what readers may do once it's open."""
    import pikepdf

    permissions = pikepdf.Permissions(
        accessibility=True,  # screen readers always keep access
        extract=allow_copy,
        print_lowres=allow_print,
        print_highres=allow_print,
        modify_annotation=allow_edit,
        modify_assembly=allow_edit,
        modify_form=allow_edit,
        modify_other=allow_edit,
    )
    with pdf_lock:
        with pikepdf.open(source) as pdf:
            pages = len(pdf.pages)
            pdf.save(target, encryption=pikepdf.Encryption(user=user_password, owner=owner_password, R=6, allow=permissions))
    return {"pages": pages}


def unlock_pdf(source: str, target: str, password: str) -> dict:
    """Opens with the password (or none, if only printing/copying was restricted) and saves unencrypted."""
    import pikepdf

    with pdf_lock:
        with pikepdf.open(source, password=password) as pdf:
            encrypted = pdf.is_encrypted
            pages = len(pdf.pages)
            pdf.save(target)
    return {"pages": pages, "wasEncrypted": encrypted}


def _two_paths(source: str, target: str):
    real_source, real_target = inside_documents(source), inside_documents(target)
    if not real_source or not real_target or not os.path.isfile(real_source) or os.path.dirname(real_source) != os.path.dirname(real_target):
        return None
    return real_source, real_target


@app.post("/pdf/protect")
async def pdf_protect(
    source: str = Form(...),
    target: str = Form(...),
    user_password: str = Form(...),
    owner_password: str = Form(...),
    allow_print: bool = Form(False),
    allow_copy: bool = Form(False),
    allow_edit: bool = Form(False),
    x_internal_token: str | None = Header(default=None),
):
    if not authorised(x_internal_token):
        return error(401, "UNAUTHORIZED", "Unauthorized.")
    paths = _two_paths(source, target)
    if not paths or not (1 <= len(user_password) <= 256) or not (1 <= len(owner_password) <= 256):
        return error(400, "INVALID_REQUEST", "Invalid request.")
    try:
        import pikepdf

        return await run_in_threadpool(protect_pdf, *paths, user_password, owner_password, allow_print, allow_copy, allow_edit)
    except pikepdf.PasswordError:
        return error(422, "PDF_ENCRYPTED", "The PDF is already password-protected.")
    except Exception:  # noqa: BLE001 — no passwords or paths in logs
        log.error("pdf protect failed")
        return error(422, "INVALID_PDF", "The PDF could not be read.")


@app.post("/pdf/unlock")
async def pdf_unlock(source: str = Form(...), target: str = Form(...), password: str = Form(""), x_internal_token: str | None = Header(default=None)):
    if not authorised(x_internal_token):
        return error(401, "UNAUTHORIZED", "Unauthorized.")
    paths = _two_paths(source, target)
    if not paths or len(password) > 256:
        return error(400, "INVALID_REQUEST", "Invalid request.")
    try:
        import pikepdf

        return await run_in_threadpool(unlock_pdf, *paths, password)
    except pikepdf.PasswordError:
        return error(422, "WRONG_PASSWORD", "The password is not correct.")
    except Exception:  # noqa: BLE001
        log.error("pdf unlock failed")
        return error(422, "INVALID_PDF", "The PDF could not be read.")


# ---------------------------------------------------------------- PDF text with its formatting


def pdf_segments(path: str, page_index: int) -> dict:
    """
    A page's text as the PDF stores it: runs of text with their boxes (in points, as the page is
    shown — top left origin, rotation applied), exact font size, weight, italics and colour.
    """
    import ctypes

    import pypdfium2 as pdfium
    import pypdfium2.raw as pdfium_c

    with pdf_lock:
        document = pdfium.PdfDocument(path)
        try:
            if page_index < 0 or page_index >= len(document):
                raise ValueError("page")
            page = document[page_index]
            rotation = page.get_rotation() % 360
            sideways = rotation in (90, 270)
            # PDFium gives the size as displayed; the coordinate maths needs the page's own (unrotated) size.
            shown_width, shown_height = page.get_size()
            width, height = (shown_height, shown_width) if sideways else (shown_width, shown_height)
            textpage = page.get_textpage()
            raw = textpage.raw

            def visual(x: float, y: float) -> tuple[float, float]:
                if rotation == 90:
                    return y, x
                if rotation == 180:
                    return width - x, y
                if rotation == 270:
                    return height - y, width - x
                return x, height - y

            # Characters grouped into runs: a new run where the line, the style or a wide gap changes.
            # (Character by character, so ligatures and punctuation are never doubled or split off.)
            segments = []
            current = None
            left, right, bottom, top = (ctypes.c_double() for _ in range(4))
            r, g, b, a = (ctypes.c_uint() for _ in range(4))
            flags = ctypes.c_int()
            name_buffer = ctypes.create_string_buffer(256)
            total = min(pdfium_c.FPDFText_CountChars(raw), 200_000)

            def close():
                nonlocal current
                if current and current["text"].strip():
                    (x1, y1), (x2, y2) = visual(current["l"], current["t"]), visual(current["r"], current["b"])
                    segments.append(
                        {
                            "text": current["text"].strip(" "),
                            "box": [min(x1, x2), min(y1, y2), abs(x2 - x1), abs(y2 - y1)],
                            "size": round(current["size"], 2),
                            "bold": current["bold"],
                            "italic": current["italic"],
                            "font": current["font"],
                            "colour": current["colour"],
                        }
                    )
                current = None

            for index in range(total):
                code = pdfium_c.FPDFText_GetUnicode(raw, index)
                char = chr(code) if code else ""
                if char in ("\r", "\n", "\x02", ""):
                    close()
                    continue
                if char.isspace():
                    if current:
                        current["text"] += " "
                    continue
                pdfium_c.FPDFText_GetCharBox(raw, index, left, right, bottom, top)
                matrix = pdfium_c.FS_MATRIX()
                pdfium_c.FPDFText_GetMatrix(raw, index, matrix)
                scale = abs(matrix.a * matrix.d - matrix.b * matrix.c) ** 0.5 or 1.0
                size = float(pdfium_c.FPDFText_GetFontSize(raw, index)) * scale
                weight = float(pdfium_c.FPDFText_GetFontWeight(raw, index))
                pdfium_c.FPDFText_GetFontInfo(raw, index, name_buffer, 256, flags)
                font = name_buffer.value.decode("latin-1").split("+")[-1][:64]
                lowered = font.lower()
                bold = weight >= 600 or any(word in lowered for word in ("bold", "black", "heavy", "semibold"))
                italic = bool(flags.value & (1 << 6)) or "italic" in lowered or "oblique" in lowered
                colour = f"#{r.value:02x}{g.value:02x}{b.value:02x}" if pdfium_c.FPDFText_GetFillColor(raw, index, r, g, b, a) else None
                box = (left.value, right.value, bottom.value, top.value)
                if current:
                    same_style = abs(current["size"] - size) < 0.6 and current["bold"] == bold and current["italic"] == italic and current["colour"] == colour
                    # Same line: vertical overlap; close enough: not a column gap.
                    overlap = min(current["t"], box[3]) - max(current["b"], box[2])
                    same_line = overlap > 0.4 * min(current["t"] - current["b"], box[3] - box[2]) if box[3] > box[2] else True
                    near = box[0] - current["r"] < max(2.0, size * 1.5)
                    if not (same_style and same_line and near):
                        close()
                if not current:
                    current = {"text": "", "l": box[0], "r": box[1], "b": box[2], "t": box[3], "size": size, "bold": bold, "italic": italic, "font": font, "colour": colour}
                current["text"] += char
                if box[1] > box[0]:
                    current["l"], current["r"] = min(current["l"], box[0]), max(current["r"], box[1])
                    current["b"], current["t"] = min(current["b"], box[2]), max(current["t"], box[3])
            close()
            textpage.close()
            page.close()
            return {"width": shown_width, "height": shown_height, "segments": segments}
        finally:
            document.close()


@app.post("/pdf/segments")
async def pdf_segments_endpoint(path: str = Form(...), page: int = Form(...), x_internal_token: str | None = Header(default=None)):
    if not authorised(x_internal_token):
        return error(401, "UNAUTHORIZED", "Unauthorized.")
    real = inside_documents(path)
    if not real or not os.path.isfile(real):
        return error(400, "INVALID_REQUEST", "Invalid document.")
    try:
        return await run_in_threadpool(pdf_segments, real, page)
    except ValueError:
        return error(400, "INVALID_REQUEST", "Invalid page.")
    except Exception:  # noqa: BLE001
        log.exception("pdf segments failed")
        return error(422, "INVALID_PDF", "The PDF could not be read.")
