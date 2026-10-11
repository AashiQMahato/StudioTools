"""
Photo restoration on real photos (CC0 fixtures), degraded in known ways so each step's effect is measured
against the clean original — not just "it ran". Model-backed steps are skipped when their model isn't
installed (scripts/setup-ml.sh).
"""

from __future__ import annotations

import os
from pathlib import Path

import cv2
import numpy as np
import pytest

MODELS = Path(__file__).resolve().parents[1] / ".models"
os.environ.setdefault("MODELS_DIR", str(MODELS))

import restoration  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"


def photo(name: str) -> np.ndarray:
    image = cv2.imread(str(FIXTURES / f"{name}.jpg"))
    assert image is not None
    return image


def psnr(a: np.ndarray, b: np.ndarray, where: np.ndarray | None = None) -> float:
    error = (a.astype(np.float32) - b.astype(np.float32)) ** 2
    if where is not None:
        error = error[where]
    return float(10 * np.log10(255**2 / max(float(error.mean()), 1e-9)))


def scratched(clean: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Fourteen 2-px bright and dark scratches across the photo, and where they are."""
    height, width = clean.shape[:2]
    rng = np.random.default_rng(1)
    damaged, truth = clean.copy(), np.zeros((height, width), np.uint8)
    for index in range(14):
        a, b = (tuple(int(v) for v in point) for point in rng.integers(0, [width, height], size=(2, 2)))
        cv2.line(damaged, a, b, (235, 235, 235) if index % 2 else (25, 25, 25), 2, cv2.LINE_AA)
        cv2.line(truth, a, b, 255, 2)
    return damaged, truth > 0


@pytest.mark.parametrize("name", ["crowd-man", "curly-hair-bright-bg", "bicycle-thin-details"])
def test_scratches_are_found_and_repaired(name: str) -> None:
    clean = photo(name)
    damaged, truth = scratched(clean)
    mask = restoration.scratch_mask(damaged)
    assert (mask[truth] > 0).mean() > 0.4
    repaired = restoration.telea(damaged, mask)
    # The scratches themselves get much closer to the original, and the photo as a whole improves.
    assert psnr(repaired, clean, truth) > psnr(damaged, clean, truth) + 4
    assert psnr(repaired, clean) > psnr(damaged, clean) + 2


@pytest.mark.parametrize("name", ["crowd-man", "curly-hair-bright-bg", "bicycle-thin-details", "group-pupils", "group-statue"])
def test_clean_photos_are_mostly_left_alone(name: str) -> None:
    assert (restoration.scratch_mask(photo(name)) > 0).mean() < 0.02


def test_denoise_recovers_the_original() -> None:
    clean = photo("crowd-man")
    noisy = np.clip(clean.astype(np.float32) + np.random.default_rng(2).normal(0, 14, clean.shape), 0, 255).astype(np.uint8)
    gray = lambda image: cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)  # noqa: E731
    assert restoration.estimate_noise(gray(noisy)) > 4 * restoration.estimate_noise(gray(clean))
    assert psnr(restoration.denoise(noisy), clean) > psnr(noisy, clean) + 5


def test_fade_restores_contrast_and_neutral_colour() -> None:
    clean = photo("crowd-man")
    faded = np.clip(clean.astype(np.float32) * 0.55 + np.array([60, 95, 120], np.float32), 0, 255).astype(np.uint8)
    fixed = restoration.fade(faded)
    assert psnr(fixed, clean) > psnr(faded, clean) + 4
    lab = cv2.cvtColor(fixed, cv2.COLOR_BGR2LAB).astype(np.float32)
    # The yellow cast (b well above neutral 128) is mostly gone.
    assert abs(float(np.median(lab[..., 2])) - 128) < abs(float(np.median(cv2.cvtColor(faded, cv2.COLOR_BGR2LAB)[..., 2])) - 128) * 0.5


def test_monochrome_detection() -> None:
    colour = photo("crowd-man")
    gray = cv2.cvtColor(cv2.cvtColor(colour, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
    sepia = cv2.addWeighted(gray, 0.7, np.full_like(gray, (60, 110, 150)), 0.3, 0)
    assert restoration.is_monochrome(gray)
    assert restoration.is_monochrome(sepia)
    assert not restoration.is_monochrome(colour)


@pytest.mark.skipif(not restoration.available()["colorize"], reason="colorization model not installed")
def test_colorize_adds_colour_and_keeps_detail() -> None:
    gray = cv2.cvtColor(cv2.cvtColor(photo("crowd-man"), cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
    colour = restoration.colorize(gray)
    assert colour.shape == gray.shape
    assert not restoration.is_monochrome(colour)
    # Only colour is predicted: the photo's own lightness (its detail) comes through.
    difference = np.abs(cv2.cvtColor(colour, cv2.COLOR_BGR2GRAY).astype(int) - gray[..., 0].astype(int))
    assert float(difference.mean()) < 3


@pytest.mark.skipif(not restoration.available()["faces"], reason="face restoration model not installed")
def test_faces_are_found_restored_and_only_faces_change() -> None:
    clean = photo("curly-hair-bright-bg")
    height, width = clean.shape[:2]
    soft = cv2.resize(cv2.resize(clean, (width // 2, height // 2), interpolation=cv2.INTER_AREA), (width, height), interpolation=cv2.INTER_CUBIC)
    restored, count, _ = restoration.restore_faces(soft)
    assert count >= 1
    changed = np.abs(restored.astype(int) - soft.astype(int)).max(axis=2) > 2
    assert 0 < changed.mean() < 0.3
    # Restored faces carry real detail again (sharper than the soft copy).
    assert cv2.Laplacian(cv2.cvtColor(restored, cv2.COLOR_BGR2GRAY), cv2.CV_64F)[changed].var() > cv2.Laplacian(cv2.cvtColor(soft, cv2.COLOR_BGR2GRAY), cv2.CV_64F)[changed].var()


@pytest.mark.skipif(not restoration.available()["faces"], reason="face restoration model not installed")
def test_photo_without_faces_is_unchanged() -> None:
    image = photo("bicycle-thin-details")
    restored, count, _ = restoration.restore_faces(image)
    assert count == 0
    assert np.array_equal(restored, image)


def test_turned_and_tiny_faces_are_left_alone() -> None:
    frontal = np.array([[100, 100], [140, 100], [120, 125], [105, 145], [135, 145]], np.float32)
    turned = frontal.copy()
    turned[2, 0] = 145
    assert restoration._restorable(frontal)
    assert not restoration._restorable(turned)
    assert not restoration._restorable(frontal * 0.3)
