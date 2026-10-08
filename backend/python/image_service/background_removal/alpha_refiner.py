"""
Edge-aware refinement of BiRefNet's alpha — no second model, the photo itself is the guide.

BiRefNet sees the image at its input size (512–1024 px), so its alpha, scaled up to a 12-megapixel photo,
is soft where the photo is sharp: hair strands smear into a haze, fabric edges blur. A colour-guided
filter (He, Sun & Tang, "Guided Image Filtering") re-fits the alpha to the photo's own edges, locally,
as a linear function of its colours — strands and edges come back, and nothing is thresholded.

Only the transition band (between EDGE_LOW and EDGE_HIGH) is touched: pixels BiRefNet is confident
about stay exactly as they were, and the change fades in at the band's border, so there's no seam.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class RefineSettings:
    low: float = 0.05  # below: confident background
    high: float = 0.95  # above: confident foreground
    radius: int = 0  # guided-filter window radius (px): ≈ the alpha's blur width; 0 = from the image size
    eps: float = 1e-4  # regularisation: smaller follows the photo more closely (sharper), larger is smoother
    max_side: int = 2048  # refinement runs at most at this size (memory); the alpha is scaled up after


def detect_transition_band(alpha: np.ndarray, low: float, high: float) -> np.ndarray:
    """Pixels whose alpha is neither confidently background nor confidently foreground."""
    return (alpha > low) & (alpha < high)


def _box(x: np.ndarray, radius: int) -> np.ndarray:
    return cv2.boxFilter(x, -1, (2 * radius + 1, 2 * radius + 1), borderType=cv2.BORDER_REFLECT)


def guided_filter_colour(guide: np.ndarray, source: np.ndarray, radius: int, eps: float) -> np.ndarray:
    """
    He et al.'s guided filter with a colour guide: in each window the output is a linear function of the
    guide's R, G and B, so it follows colour edges (dark hair against a mid-grey wall) that a greyscale
    guide would miss. All in box filters — linear time in the pixels, independent of the radius.
    """
    i = guide.astype(np.float32) / 255.0
    p = source.astype(np.float32)
    r, g, b = i[..., 0], i[..., 1], i[..., 2]
    mean_r, mean_g, mean_b, mean_p = _box(r, radius), _box(g, radius), _box(b, radius), _box(p, radius)
    cov_rp = _box(r * p, radius) - mean_r * mean_p
    cov_gp = _box(g * p, radius) - mean_g * mean_p
    cov_bp = _box(b * p, radius) - mean_b * mean_p
    # The guide's colour covariance in each window (symmetric 3×3), regularised.
    rr = _box(r * r, radius) - mean_r * mean_r + eps
    rg = _box(r * g, radius) - mean_r * mean_g
    rb = _box(r * b, radius) - mean_r * mean_b
    gg = _box(g * g, radius) - mean_g * mean_g + eps
    gb = _box(g * b, radius) - mean_g * mean_b
    bb = _box(b * b, radius) - mean_b * mean_b + eps
    # Its inverse, per pixel (adjugate / determinant), then a = Σ⁻¹ · cov(I, p).
    inv_rr = gg * bb - gb * gb
    inv_rg = gb * rb - rg * bb
    inv_rb = rg * gb - gg * rb
    inv_gg = rr * bb - rb * rb
    inv_gb = rb * rg - rr * gb
    inv_bb = rr * gg - rg * rg
    det = rr * inv_rr + rg * inv_rg + rb * inv_rb
    det = np.where(np.abs(det) < 1e-12, 1e-12, det)
    a_r = (inv_rr * cov_rp + inv_rg * cov_gp + inv_rb * cov_bp) / det
    a_g = (inv_rg * cov_rp + inv_gg * cov_gp + inv_gb * cov_bp) / det
    a_b = (inv_rb * cov_rp + inv_gb * cov_gp + inv_bb * cov_bp) / det
    b_ = mean_p - a_r * mean_r - a_g * mean_g - a_b * mean_b
    return _box(a_r, radius) * r + _box(a_g, radius) * g + _box(a_b, radius) * b + _box(b_, radius)


def refine_alpha_edges(rgb: np.ndarray, alpha: np.ndarray, settings: RefineSettings) -> np.ndarray:
    """
    The alpha (same size as `rgb`), refined inside the transition band only. Everything outside the band
    — and the soft values inside it that the photo agrees with — is kept; nothing becomes binary.
    """
    band = detect_transition_band(alpha, settings.low, settings.high)
    if not band.any():
        return alpha
    height, width = alpha.shape
    radius = settings.radius or max(2, round(max(height, width) / 700))
    # Where the filter may change things: the band grown by the window, faded in so there's no seam.
    reach = cv2.dilate(band.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1)))
    ys, xs = np.nonzero(reach)
    pad = 3 * radius
    y0, y1 = max(0, ys.min() - pad), min(height, ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(width, xs.max() + pad + 1)

    region = alpha[y0:y1, x0:x1]
    filtered = np.clip(guided_filter_colour(rgb[y0:y1, x0:x1], region, radius, settings.eps), 0.0, 1.0)
    weight = cv2.GaussianBlur(reach[y0:y1, x0:x1].astype(np.float32), (0, 0), sigmaX=max(1.0, radius / 2))
    # Confident pixels stay exactly as they were, whatever the filter says next to them.
    confident = (region <= settings.low) | (region >= settings.high)
    weight[confident & ~band[y0:y1, x0:x1]] = 0.0
    out = alpha.copy()
    out[y0:y1, x0:x1] = region * (1.0 - weight) + filtered * weight
    return np.clip(out, 0.0, 1.0)
