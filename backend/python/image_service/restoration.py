"""
Old-photo restoration, one operation at a time (the API chains them). Every operation is real image
processing on the pixels, and says which engine did it:

  scratches  find thin scratches, cracks and dust (morphology), then rebuild them — LaMa if installed,
             else OpenCV's Telea inpainting (classical)
  denoise    non-local means denoising (OpenCV), strength from the image's measured noise
  fade       faded prints: robust levels stretch, colour-cast correction and CLAHE local contrast
  colorize   black-and-white → colour: ECCV16 "Colorful Image Colorization" (Zhang et al., BSD-2), ONNX
  faces      face restoration: GFPGAN v1.4 (TencentARC, Apache-2.0), ONNX, on faces found by YuNet

Images move as BGR uint8 arrays (OpenCV's order). Models load once, on first use.
"""

from __future__ import annotations

import os
import threading

import cv2
import numpy as np

MODELS_DIR = os.environ.get("MODELS_DIR", "")
COLORIZE_MODEL = os.environ.get("COLORIZATION_MODEL") or os.path.join(MODELS_DIR, "colorization_eccv16.onnx")
FACE_RESTORE_MODEL = os.environ.get("FACE_RESTORE_MODEL") or os.path.join(MODELS_DIR, "gfpgan_v1.4.onnx")
FACE_MODEL = os.environ.get("FACE_DETECTOR_MODEL") or os.path.join(MODELS_DIR, "face_detection_yunet_2023mar.onnx")
PROVIDERS = [p.strip() for p in os.environ.get("ONNX_PROVIDERS", "CPUExecutionProvider").split(",") if p.strip()]

OPERATIONS = ("scratches", "denoise", "fade", "colorize", "faces")

# Scratch masks larger than this share of the photo are texture, not damage: the threshold rises until it fits.
SCRATCH_MAX_COVERAGE = 0.04
# A photo whose chroma varies less than this (Lab units, std of a and b) is monochrome — sepia counts.
MONOCHROME_CHROMA_STD = 6.0
# GFPGAN's 512 × 512 FFHQ alignment: where the eyes, nose tip and mouth corners belong (YuNet's order:
# image-left eye, image-right eye, nose, image-left mouth corner, image-right mouth corner).
FACE_TEMPLATE = np.array([[192.98138, 239.94708], [318.90277, 240.19360], [256.63416, 314.01935], [201.26117, 371.41043], [313.08905, 371.15118]], np.float32)
FACE_SIDE = 512
FACE_MIN_SIDE = 40
FACE_MAX_COUNT = 12
# Faces with eyes closer than this (px) hold too little information: GFPGAN would invent a different face.
FACE_MIN_EYE_DISTANCE = 16
# Turned faces (nose off the eyes' midline by more than this share of the eye distance) restore unreliably.
FACE_MAX_YAW = 0.45
# How much of GFPGAN's face replaces the original: some of the real face keeps identity and texture.
FACE_BLEND = 0.7

_sessions: dict[str, object] = {}
_session_lock = threading.Lock()


def available() -> dict[str, bool]:
    return {
        "scratches": True,
        "denoise": True,
        "fade": True,
        "colorize": os.path.isfile(COLORIZE_MODEL),
        "faces": os.path.isfile(FACE_RESTORE_MODEL) and os.path.isfile(FACE_MODEL),
    }


def _session(path: str):
    with _session_lock:
        if path not in _sessions:
            import onnxruntime as ort

            _sessions[path] = ort.InferenceSession(path, providers=PROVIDERS)
        return _sessions[path]


# ---------------------------------------------------------------- scratches & dust


def _line_kernels(length: int) -> list[np.ndarray]:
    """One-pixel-wide straight segments at 24 orientations (fewer miss scratches between two angles)."""
    kernels = []
    centre = length // 2
    for step in range(24):
        angle = np.pi * step / 24
        dx, dy = np.cos(angle) * centre, np.sin(angle) * centre
        kernel = np.zeros((length, length), np.uint8)
        cv2.line(kernel, (round(centre - dx), round(centre - dy)), (round(centre + dx), round(centre + dy)), 1, 1)
        kernels.append(kernel)
    return kernels


def scratch_mask(bgr: np.ndarray) -> np.ndarray:
    """
    Thin bright or dark streaks (scratches, cracks, folds) and small high-contrast specks (dust), as a
    0/255 mask. Top-hat and black-hat keep only structures narrower than the kernel. A scratch is then
    told from texture pixel by pixel: its response survives an opening with a straight segment at some
    orientation (it runs on in a line), which grain, foliage and edges of objects mostly don't. Dust is
    a tiny component far stronger than the floor.
    """
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    height, width = gray.shape
    size = max(7, round(min(height, width) / 140)) | 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
    response = np.maximum(cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel), cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel))
    # Robust noise floor: median + k·MAD, so grain alone never qualifies (a very grainy photo gets a
    # threshold too high for anything: nothing is "repaired" rather than its grain smeared).
    median = float(np.median(response))
    spread = float(np.median(np.abs(response.astype(np.float32) - median))) * 1.4826 + 1.0
    threshold = max(40.0, median + 10.0 * spread)

    # Dilated first, so a scratch a little off every kernel's angle still carries a segment through.
    widened = cv2.dilate(response, np.ones((3, 3), np.uint8))
    linear = np.zeros_like(response)
    for line in _line_kernels(8 * size + 1):
        np.maximum(linear, cv2.morphologyEx(widened, cv2.MORPH_OPEN, line), out=linear)

    for _ in range(6):
        mask = (linear > threshold) & (response > threshold * 0.5)
        count, labels, stats, _ = cv2.connectedComponentsWithStats((response > 2.2 * threshold).astype(np.uint8), connectivity=8)
        small = (stats[:, cv2.CC_STAT_AREA] <= size * size) & (np.maximum(stats[:, cv2.CC_STAT_WIDTH], stats[:, cv2.CC_STAT_HEIGHT]) <= 2 * size)
        small[0] = False
        mask |= small[labels]
        if mask.mean() <= SCRATCH_MAX_COVERAGE:
            break
        threshold *= 1.3
    grow = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    return cv2.dilate(mask.astype(np.uint8) * 255, grow, iterations=max(1, size // 4))


def telea(bgr: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Classical fill (Telea's fast marching), for when LaMa isn't installed. Fine for thin scratches."""
    return cv2.inpaint(bgr, mask, 3, cv2.INPAINT_TELEA)


# ---------------------------------------------------------------- noise


def estimate_noise(gray: np.ndarray) -> float:
    """Immerkær's fast noise estimate (σ of Gaussian noise, in 8-bit levels)."""
    kernel = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], np.float32)
    height, width = gray.shape
    response = cv2.filter2D(gray.astype(np.float32), -1, kernel)
    return float(np.sum(np.abs(response[1:-1, 1:-1])) * np.sqrt(0.5 * np.pi) / (6.0 * max(1, (width - 2) * (height - 2))))


def denoise(bgr: np.ndarray) -> np.ndarray:
    sigma = estimate_noise(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY))
    # Filter strength follows the measured noise: clean photos are barely touched, grainy ones properly.
    strength = float(np.clip(sigma * 0.95, 3.0, 15.0))
    return cv2.fastNlMeansDenoisingColored(bgr, None, strength, strength * 0.8, 7, 21)


# ---------------------------------------------------------------- fading


def fade(bgr: np.ndarray) -> np.ndarray:
    """
    Faded prints lose black point, white point, local contrast and neutral colour. Restore each: stretch
    lightness between robust percentiles, pull the average colour back towards neutral (most of a cast,
    not all — a warm scene stays warm), then CLAHE for local contrast.
    """
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    lightness = lab[..., 0]
    low, high = np.percentile(lightness, (0.5, 99.5))
    if high - low > 8:
        lightness = (lightness - low) * (255.0 / (high - low))
    for channel in (1, 2):
        lab[..., channel] -= (float(np.median(lab[..., channel])) - 128.0) * 0.7
    lab[..., 0] = np.clip(lightness, 0, 255)
    lab = np.clip(lab, 0, 255).astype(np.uint8)
    tiles = max(4, min(16, round(min(bgr.shape[:2]) / 160)))
    lab[..., 0] = cv2.createCLAHE(clipLimit=1.3, tileGridSize=(tiles, tiles)).apply(lab[..., 0])
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


# ---------------------------------------------------------------- colour


def is_monochrome(bgr: np.ndarray) -> bool:
    small = cv2.resize(bgr, (256, max(1, round(256 * bgr.shape[0] / bgr.shape[1]))), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).astype(np.float32)
    return float(max(lab[..., 1].std(), lab[..., 2].std())) < MONOCHROME_CHROMA_STD


def colorize(bgr: np.ndarray) -> np.ndarray:
    """
    Predicts colour (Lab a/b) from lightness at 256 × 256 and keeps the photo's own full-resolution
    lightness, so no detail is lost — only colour is added.
    """
    session = _session(COLORIZE_MODEL)
    as_float = bgr.astype(np.float32) / 255.0
    lab = cv2.cvtColor(as_float, cv2.COLOR_BGR2LAB)
    small = cv2.cvtColor(cv2.resize(as_float, (256, 256), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2LAB)[..., 0]
    ab = session.run(None, {"lightness": small[None, None].astype(np.float32)})[0][0].transpose(1, 2, 0)
    ab = cv2.resize(ab, (bgr.shape[1], bgr.shape[0]), interpolation=cv2.INTER_CUBIC)
    colour = np.concatenate([lab[..., :1], ab], axis=2)
    return (np.clip(cv2.cvtColor(colour, cv2.COLOR_LAB2BGR), 0, 1) * 255).round().astype(np.uint8)


# ---------------------------------------------------------------- faces


def _restorable(landmarks: np.ndarray) -> bool:
    """Near-frontal and large enough for GFPGAN to restore the person rather than invent one."""
    eye_distance = float(np.linalg.norm(landmarks[1] - landmarks[0]))
    yaw = (landmarks[2][0] - (landmarks[0][0] + landmarks[1][0]) / 2) / max(eye_distance, 1.0)
    return eye_distance >= FACE_MIN_EYE_DISTANCE and abs(yaw) <= FACE_MAX_YAW


def _find_faces(bgr: np.ndarray) -> list[np.ndarray]:
    """Five landmarks per face (full-resolution pixels), largest first."""
    height, width = bgr.shape[:2]
    scale = min(1.0, 1280 / max(width, height))
    small = cv2.resize(bgr, (max(1, round(width * scale)), max(1, round(height * scale))), interpolation=cv2.INTER_AREA) if scale < 1 else bgr
    detector = cv2.FaceDetectorYN.create(FACE_MODEL, "", (small.shape[1], small.shape[0]), 0.8, 0.3, 50)
    _, found = detector.detect(small)
    faces = [] if found is None else [row for row in found if row[2] / scale >= FACE_MIN_SIDE]
    faces.sort(key=lambda row: row[2] * row[3], reverse=True)
    return [np.asarray(row[4:14], np.float32).reshape(5, 2) / scale for row in faces[:FACE_MAX_COUNT]]


def restore_faces(bgr: np.ndarray) -> tuple[np.ndarray, int, int]:
    """
    Each restorable face aligned to GFPGAN's template, restored, and blended back through a feathered
    mask. Returns the image, faces restored, and faces left as they were (too small or turned away).
    """
    session = _session(FACE_RESTORE_MODEL)
    name = session.get_inputs()[0].name
    height, width = bgr.shape[:2]
    result = bgr.astype(np.float32)
    feather = np.zeros((FACE_SIDE, FACE_SIDE), np.float32)
    feather[24:-24, 24:-24] = 1.0
    feather = cv2.GaussianBlur(feather, (0, 0), 12)
    found = _find_faces(bgr)
    faces = [landmarks for landmarks in found if _restorable(landmarks)]
    for landmarks in faces:
        matrix, _ = cv2.estimateAffinePartial2D(landmarks, FACE_TEMPLATE, method=cv2.LMEDS)
        if matrix is None:
            continue
        crop = cv2.warpAffine(bgr, matrix, (FACE_SIDE, FACE_SIDE), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
        tensor = (cv2.cvtColor(crop, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0 - 0.5) / 0.5
        output = session.run(None, {name: tensor.transpose(2, 0, 1)[None]})[0][0]
        restored = cv2.cvtColor(((np.clip(output.transpose(1, 2, 0), -1, 1) + 1) * 127.5).astype(np.float32), cv2.COLOR_RGB2BGR)
        inverse = cv2.invertAffineTransform(matrix)
        back = cv2.warpAffine(restored, inverse, (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        weight = cv2.warpAffine(feather, inverse, (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)[..., None] * FACE_BLEND
        result = result * (1 - weight) + back * weight
    return np.clip(result, 0, 255).round().astype(np.uint8), len(faces), len(found) - len(faces)
