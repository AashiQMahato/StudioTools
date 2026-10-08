"""
From an upload to what the model sees — without touching the original. The model works on a copy whose
longest side is its input size (aspect kept, centred on a neutral square); the cut-out is made from the
original pixels at full resolution.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageOps

# MPO: a JPEG from many cameras (Nikon, Fujifilm, Sony…) that also carries preview images — the first
# frame is the photo itself, and browsers and the API treat the file as an ordinary JPEG.
ALLOWED_FORMATS = {"JPEG", "MPO", "PNG", "WEBP"}
MEAN = np.array((0.485, 0.456, 0.406), np.float32)
STD = np.array((0.229, 0.224, 0.225), np.float32)


class InvalidImage(ValueError):
    """Not a JPEG/PNG/WebP, unreadable, or corrupt."""


class ImageTooLarge(ValueError):
    """More pixels than the server allows."""


@dataclass
class ModelInput:
    pixels: np.ndarray  # CHW float32, normalised, size × size
    box: tuple[int, int, int, int]  # where the image sits inside the square: x0, y0, x1, y1


def open_image(data: bytes, max_pixels: int) -> Image.Image:
    """The upload as an upright RGB image (alpha dropped — the model decides it), or InvalidImage / ImageTooLarge."""
    try:
        with Image.open(io.BytesIO(data)) as probe:
            if probe.format not in ALLOWED_FORMATS:
                raise InvalidImage("format")
            if probe.width * probe.height > max_pixels:
                raise ImageTooLarge("pixels")
            probe.verify()
        image = Image.open(io.BytesIO(data))
        if getattr(image, "n_frames", 1) > 1:
            image.seek(0)  # the main picture, not an embedded preview
        image.load()
    except (ImageTooLarge, InvalidImage):
        raise
    except Image.DecompressionBombError as error:
        raise ImageTooLarge("pixels") from error
    except Exception as error:  # noqa: BLE001 — corrupt or truncated files fail in many ways
        raise InvalidImage("unreadable") from error
    image = ImageOps.exif_transpose(image)
    if image.mode != "RGB":
        # Transparent uploads: flatten onto white, so hidden colours in clear pixels don't show up.
        if image.mode in ("RGBA", "LA", "PA") or (image.mode == "P" and "transparency" in image.info):
            rgba = image.convert("RGBA")
            flat = Image.new("RGB", rgba.size, (255, 255, 255))
            flat.paste(rgba, mask=rgba.getchannel("A"))
            image = flat
        else:
            image = image.convert("RGB")
    return image


def model_input(image: Image.Image, size: int) -> ModelInput:
    """The image scaled so its longest side is `size` (aspect kept), centred on a neutral square, normalised."""
    scale = size / max(image.size)
    width, height = max(1, round(image.width * scale)), max(1, round(image.height * scale))
    resized = image.resize((width, height), Image.LANCZOS if scale < 1 else Image.BICUBIC)
    square = Image.new("RGB", (size, size), tuple(int(v * 255) for v in MEAN))  # the mean colour: zero after normalising
    x0, y0 = (size - width) // 2, (size - height) // 2
    square.paste(resized, (x0, y0))
    pixels = (np.asarray(square, np.float32) / 255.0 - MEAN) / STD
    return ModelInput(pixels=np.ascontiguousarray(pixels.transpose(2, 0, 1)), box=(x0, y0, x0 + width, y0 + height))
