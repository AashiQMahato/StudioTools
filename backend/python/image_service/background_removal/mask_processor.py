"""
Subtle clean-up of BiRefNet's alpha — it stays the source of truth. Nothing here blurs, erodes or
thresholds the edge: soft hair and semi-transparent boundaries keep their values. Only clear mistakes
are touched: stray specks away from the subject and pinholes inside it. Each step can be switched off
(model_config). Edges are refined in alpha_refiner.py, halos removed in edge_decontaminator.py.
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


def remove_specks(alpha: np.ndarray, share: float = 0.0015, low: float = 0.05) -> np.ndarray:
    """
    Clear specks: pieces cut off from the subject even through its soft alpha (anything above `low`) —
    dust, a fleck of background. A strand joined to the subject by soft hair or fur is part of it and stays;
    only a speck's own pixels are cleared, nothing around them.
    """
    present = (alpha > low).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(present, connectivity=8)
    if count <= 2:
        return alpha
    areas = stats[1:, cv2.CC_STAT_AREA]
    total = int(areas.sum())
    small = [index + 1 for index, area in enumerate(areas) if area < total * share]
    if not small:
        return alpha
    out = alpha.copy()
    out[np.isin(labels, small)] = 0.0
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


def resize_alpha(alpha: np.ndarray, width: int, height: int) -> np.ndarray:
    """The alpha at another size, smoothly (bicubic up — keeps hair strands soft, not blocky); never thresholded."""
    if alpha.shape[1] == width and alpha.shape[0] == height:
        return alpha
    interpolation = cv2.INTER_CUBIC if width > alpha.shape[1] else cv2.INTER_AREA
    return np.clip(cv2.resize(alpha, (width, height), interpolation=interpolation), 0.0, 1.0)

