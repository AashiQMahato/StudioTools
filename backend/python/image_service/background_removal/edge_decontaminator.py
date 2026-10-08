"""
Halo removal without touching the alpha: at a soft edge a pixel is a mix of subject and old background
(I = αF + (1−α)B), so a white wall leaves a light fringe on dark hair, a green screen a green one. This
estimates the subject's own colour F there and uses it — only in the transition band; opaque pixels keep
their original values exactly, and the alpha is never eroded.

Method: approximate fast foreground colour estimation by blur fusion (Forte & Pitié, 2021, as used by
Photoroom). The local foreground/background colour estimates are smooth, so they're computed at a reduced
size and scaled up; the per-pixel solve then runs at full resolution, on band pixels only.
"""

from __future__ import annotations

import cv2
import numpy as np


def _fuse(image: np.ndarray, f: np.ndarray, b: np.ndarray, alpha: np.ndarray, radius: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """One blur-fusion pass: the local (alpha-weighted) foreground and background means, and F from them."""
    a = alpha[..., None]
    size = (radius, radius)
    blurred_a = cv2.blur(alpha, size)[..., None]
    blurred_f = cv2.blur(f * a, size) / (blurred_a + 1e-5)
    blurred_b = cv2.blur(b * (1 - a), size) / ((1 - blurred_a) + 1e-5)
    estimate = np.clip(blurred_f + a * (image - a * blurred_f - (1 - a) * blurred_b), 0, 1)
    return estimate, blurred_f, blurred_b


def decontaminate_edges(rgb: np.ndarray, alpha: np.ndarray, low: float = 0.02, high: float = 0.98, strength: float = 1.0, max_side: int = 1536) -> np.ndarray:
    """
    The photo with the old background's colour taken out of its soft edges. `strength` 0–1 blends between
    the original (0) and the estimated subject colour (1). Pixels outside (low, high) are returned unchanged.
    """
    band = (alpha > low) & (alpha < high)
    if not band.any() or strength <= 0:
        return rgb
    height, width = alpha.shape
    scale = min(1.0, max_side / max(height, width))
    small_size = (max(1, round(width * scale)), max(1, round(height * scale)))
    small = cv2.resize(rgb, small_size, interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    small_alpha = cv2.resize(alpha, small_size, interpolation=cv2.INTER_AREA)
    # Pass 1, wide: the window must reach past the soft edge to pure subject and pure background.
    wide = max(31, round(max(small_size) / 25)) | 1
    first, _, first_b = _fuse(small, small, small, small_alpha, wide)
    # Pass 2, narrow: local means from pass 1's estimates — the smooth part of the answer.
    _, local_f, local_b = _fuse(small, first, first_b, small_alpha, 7)

    ys, xs = np.nonzero(band)
    # Those means scaled up, read at the band's pixels; the per-pixel solve uses the full-resolution photo.
    f = cv2.resize(local_f, (width, height), interpolation=cv2.INTER_LINEAR)[ys, xs]
    b = cv2.resize(local_b, (width, height), interpolation=cv2.INTER_LINEAR)[ys, xs]
    image = rgb[ys, xs].astype(np.float32) / 255.0
    a = alpha[ys, xs][:, None]
    foreground = np.clip(f + a * (image - a * f - (1 - a) * b), 0, 1)
    mixed = image + strength * (foreground - image)
    out = rgb.copy()
    out[ys, xs] = (mixed * 255).round().astype(np.uint8)
    return out
