"""
Subtle clean-up of BiRefNet's alpha — it stays the source of truth. Nothing here blurs, erodes or
thresholds the edge: soft hair and semi-transparent boundaries keep their values. Only clear mistakes
are touched: stray specks away from the subject, pinholes inside it, and the background's colour
bleeding into soft edges. Each step can be switched off (model_config).
"""

from __future__ import annotations

import cv2
import numpy as np


def normalise(alpha: np.ndarray) -> np.ndarray:
    """Clamp to 0–1 and settle near-certain values (< 1% / > 99%) — invisible noise in flat areas, not edges."""
    alpha = np.clip(alpha.astype(np.float32), 0.0, 1.0)
    alpha[alpha < 0.01] = 0.0
    alpha[alpha > 0.99] = 1.0
    return alpha


def remove_specks(alpha: np.ndarray, share: float = 0.0015) -> np.ndarray:
    """Clear small islands that aren't attached to anything substantial (dust, a speck of background)."""
    solid = (alpha > 0.5).astype(np.uint8)
    total = int(solid.sum())
    if total == 0:
        return alpha
    count, labels, stats, _ = cv2.connectedComponentsWithStats(solid, connectivity=8)
    if count <= 2:
        return alpha
    small = [index for index in range(1, count) if stats[index, cv2.CC_STAT_AREA] < total * share]
    if not small:
        return alpha
    # Drop the island and its own soft fringe (grown a few pixels), nothing else.
    speck = np.isin(labels, small).astype(np.uint8)
    speck = cv2.dilate(speck, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    keep_area = cv2.dilate((solid & ~np.isin(labels, small)).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    out = alpha.copy()
    out[(speck > 0) & (keep_area == 0)] = 0.0
    return out


def fill_holes(alpha: np.ndarray, share: float = 0.0005) -> np.ndarray:
    """Fill pinholes fully inside the subject (a few pixels of background it shouldn't have). Real gaps — between an arm and the body — are larger and stay."""
    solid = (alpha > 0.5).astype(np.uint8)
    total = int(solid.sum())
    if total == 0:
        return alpha
    background = (1 - solid).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(background, connectivity=4)
    height, width = alpha.shape
    out = alpha.copy()
    for index in range(1, count):
        x, y, w, h, area = stats[index]
        if x == 0 or y == 0 or x + w >= width or y + h >= height:
            continue  # touches the border: real background
        if area <= total * share:
            out[labels == index] = 1.0
    return out


def resize(alpha: np.ndarray, width: int, height: int) -> np.ndarray:
    """The alpha at another size, smoothly (bicubic up — keeps hair strands soft, not blocky)."""
    if alpha.shape[1] == width and alpha.shape[0] == height:
        return alpha
    interpolation = cv2.INTER_CUBIC if width > alpha.shape[1] else cv2.INTER_AREA
    return np.clip(cv2.resize(alpha, (width, height), interpolation=interpolation), 0.0, 1.0)


def decontaminate(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """
    The subject's own colour at soft edges, without the old background bleeding in (no halo, no light
    or dark outline): approximate blur-fusion foreground estimation (Forte & Pitié). Opaque and empty
    pixels are left exactly as they were — only the edge band changes, and only its colour, not alpha.
    """
    edge = (alpha > 0.02) & (alpha < 0.98)
    if not edge.any():
        return rgb
    ys, xs = np.nonzero(edge)
    pad = 64
    h, w = alpha.shape
    x0, y0, x1, y1 = max(0, xs.min() - pad), max(0, ys.min() - pad), min(w, xs.max() + pad + 1), min(h, ys.max() + pad + 1)
    image = rgb[y0:y1, x0:x1].astype(np.float32) / 255.0
    a = alpha[y0:y1, x0:x1, None].astype(np.float32)

    def fuse(f: np.ndarray, b: np.ndarray, r: int) -> tuple[np.ndarray, np.ndarray]:
        blurred_a = cv2.blur(a, (r, r))[..., None]
        blurred_f = cv2.blur(f * a, (r, r)) / (blurred_a + 1e-5)
        blurred_b = cv2.blur(b * (1 - a), (r, r)) / ((1 - blurred_a) + 1e-5)
        return np.clip(blurred_f + a * (image - a * blurred_f - (1 - a) * blurred_b), 0, 1), blurred_b

    f, b = fuse(image, image, 61)
    f, _ = fuse(f, b, 5)
    out = rgb.copy()
    band = edge[y0:y1, x0:x1]
    out[y0:y1, x0:x1][band] = (f[band] * 255).round().astype(np.uint8)
    return out
