"""
Precise eye positions for head alignment, from MediaPipe's Face Landmarker (478-point face mesh, Apache-2.0).

YuNet finds the faces (and its five landmarks are enough to find them), but its eye points are coarse:
on the same face tilted by known amounts its eye-line angle varied by up to 20°. The face mesh is fitted
to the whole face, so its eye line is stable to under a degree — even behind sunglasses within ~3°.
Each YuNet face gets the mesh's eye, nose and mouth points; where the mesh finds a face YuNet missed
(a strongly tilted head), that face is added.

Optional: without mediapipe or its model (scripts/setup-ml.sh), faces keep YuNet's points.
"""

from __future__ import annotations

import logging
import os
import threading

import numpy as np

log = logging.getLogger("image_service.face_landmarks")

MODEL = os.environ.get("FACE_LANDMARKER_MODEL") or os.path.join(os.environ.get("MODELS_DIR", ""), "face_landmarker.task")
# The mesh is fitted on a copy no larger than this (measured: 0.6–0.9° eye-line spread at 1600 px).
MAX_SIDE = 1600
# Each detected face is also fitted close up — a crop this many face-widths across, at this size — so a
# face that's small in a big photo gets as many pixels as a portrait's.
CLOSE_UP_FACES = 2.4
CLOSE_UP_SIDE = 640
MAX_CLOSE_UPS = 3

# Mesh indices: each eye's two corners (the subject's right eye appears on the image's left).
RIGHT_EYE = (33, 133)
LEFT_EYE = (362, 263)
NOSE_TIP = 1
MOUTH_RIGHT, MOUTH_LEFT = 61, 291

_state: dict[str, object] = {"landmarker": None, "tried": False}
_lock = threading.Lock()


def _landmarker():
    """The Face Landmarker, created once; None if mediapipe or the model isn't installed."""
    with _lock:
        if not _state["tried"]:
            _state["tried"] = True
            try:
                import mediapipe  # noqa: F401
                from mediapipe.tasks.python import BaseOptions, vision

                if not os.path.isfile(MODEL):
                    raise FileNotFoundError(MODEL)
                options = vision.FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path=MODEL), num_faces=6, output_facial_transformation_matrixes=True)
                _state["landmarker"] = vision.FaceLandmarker.create_from_options(options)
                log.info("face landmarks: MediaPipe Face Landmarker ready")
            except Exception as error:  # noqa: BLE001 — optional: fall back to YuNet's points
                log.info("face landmarks: MediaPipe unavailable (%s); using YuNet's points", type(error).__name__)
        return _state["landmarker"]


def _meshes(pixels_bgr: np.ndarray, region: tuple[int, int, int, int] | None = None, max_side: int = MAX_SIDE) -> list[dict]:
    """Every face mesh in the image (or in `region` of it: x0, y0, x1, y1), in the image's pixel coordinates."""
    import cv2
    import mediapipe as mp

    landmarker = _landmarker()
    if landmarker is None:
        return []
    ox, oy = 0, 0
    if region is not None:
        ox, oy, x1, y1 = region
        pixels_bgr = pixels_bgr[oy:y1, ox:x1]
    height, width = pixels_bgr.shape[:2]
    if width < 16 or height < 16:
        return []
    scale = max_side / max(width, height) if region is not None else min(1.0, max_side / max(width, height))
    interpolation = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
    small = cv2.resize(pixels_bgr, (max(1, round(width * scale)), max(1, round(height * scale))), interpolation=interpolation) if scale != 1 else pixels_bgr
    rgb = np.ascontiguousarray(cv2.cvtColor(small, cv2.COLOR_BGR2RGB))
    with _lock:  # the landmarker isn't thread-safe
        result = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    sw, sh = small.shape[1], small.shape[0]
    meshes = []
    for index, points in enumerate(result.face_landmarks):
        xy = np.array([(ox + p.x * sw / scale, oy + p.y * sh / scale) for p in points], np.float64)
        centre = lambda pair: xy[list(pair)].mean(axis=0)  # noqa: E731
        right, left = centre(RIGHT_EYE), centre(LEFT_EYE)
        if right[0] > left[0]:  # a mirrored or upside-down fit: keep image-left as the subject's right
            right, left = left, right
        x0, y0 = xy.min(axis=0)
        x1, y1 = xy.max(axis=0)
        pose = None
        if result.facial_transformation_matrixes:
            m = np.array(result.facial_transformation_matrixes[index])[:3, :3]
            pose = {
                "yaw": float(np.degrees(np.arctan2(-m[2, 0], np.hypot(m[2, 1], m[2, 2])))),
                "pitch": float(np.degrees(np.arctan2(m[2, 1], m[2, 2]))),
            }
        meshes.append(
            {
                "box": {"x": float(x0), "y": float(y0), "width": float(x1 - x0), "height": float(y1 - y0)},
                "landmarks": {
                    "rightEye": {"x": float(right[0]), "y": float(right[1])},
                    "leftEye": {"x": float(left[0]), "y": float(left[1])},
                    "nose": {"x": float(xy[NOSE_TIP][0]), "y": float(xy[NOSE_TIP][1])},
                    "mouthRight": {"x": float(xy[MOUTH_RIGHT][0]), "y": float(xy[MOUTH_RIGHT][1])},
                    "mouthLeft": {"x": float(xy[MOUTH_LEFT][0]), "y": float(xy[MOUTH_LEFT][1])},
                },
                "pose": pose,
            }
        )
    return meshes


def _inside(point: dict, box: dict) -> bool:
    return box["x"] <= point["x"] <= box["x"] + box["width"] and box["y"] <= point["y"] <= box["y"] + box["height"]


def refine(pixels_bgr: np.ndarray, faces: list[dict], measure) -> list[dict]:
    """
    YuNet's faces with the mesh's precise landmarks (matched by the mesh's eyes lying in the face's box),
    plus faces only the mesh found. `measure(box)` gives a new face's sharpness and brightness.
    """
    try:
        meshes = _meshes(pixels_bgr)
    except Exception:  # noqa: BLE001 — never let refinement break detection
        log.exception("face landmarks failed; using YuNet's points")
        return faces
    # Close-ups of the main faces: their meshes replace the whole-photo ones (same face, more pixels).
    height, width = pixels_bgr.shape[:2]
    for face in faces[:MAX_CLOSE_UPS]:
        box = face["box"]
        side = max(box["width"], box["height"]) * CLOSE_UP_FACES
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        region = (int(max(0, cx - side / 2)), int(max(0, cy - side / 2)), int(min(width, cx + side / 2)), int(min(height, cy + side / 2)))
        try:
            close = [m for m in _meshes(pixels_bgr, region, CLOSE_UP_SIDE) if _inside(m["landmarks"]["rightEye"], box) and _inside(m["landmarks"]["leftEye"], box)]
        except Exception:  # noqa: BLE001
            log.exception("close-up face landmarks failed")
            close = []
        if close:
            meshes = [m for m in meshes if not (_inside(m["landmarks"]["rightEye"], box) and _inside(m["landmarks"]["leftEye"], box))] + close[:1]
    used = set()
    for face in faces:
        for index, mesh in enumerate(meshes):
            if index in used:
                continue
            eyes = mesh["landmarks"]
            if _inside(eyes["rightEye"], face["box"]) and _inside(eyes["leftEye"], face["box"]):
                face["landmarks"] = mesh["landmarks"]
                face["pose"] = mesh["pose"]
                face["landmarkSource"] = "mediapipe"
                used.add(index)
                break
    for index, mesh in enumerate(meshes):
        if index not in used:
            sharpness, brightness = measure(mesh["box"])
            faces.append({"box": mesh["box"], "score": 0.8, "landmarks": mesh["landmarks"], "pose": mesh["pose"], "landmarkSource": "mediapipe", "sharpness": sharpness, "brightness": brightness})
    return faces
