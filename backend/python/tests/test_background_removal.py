"""
The guarantees of the background-removal pipeline that don't need the model: soft alpha survives,
confident pixels aren't touched, the original RGB and resolution are kept, halos lose their colour.
(test_birefnet_integration.py runs the real model when it's installed.)
"""

import io

import numpy as np
import pytest
from PIL import Image

from background_removal import mask_processor as masks
from background_removal.alpha_refiner import RefineSettings, detect_transition_band, refine_alpha_edges
from background_removal.background_removal_service import compose_rgba, encode_png, resize_alpha_to_original
from background_removal.edge_decontaminator import decontaminate_edges
from background_removal.image_preprocessor import ImageTooLarge, InvalidImage, model_input, open_image


def soft_disc(size=200, radius=60, softness=12):
    """An alpha: a disc with a soft edge (like hair), 0 outside, 1 inside."""
    yy, xx = np.mgrid[:size, :size]
    distance = np.hypot(xx - size / 2, yy - size / 2)
    return np.clip((radius - distance) / softness + 0.5, 0, 1).astype(np.float32)


def scene(size=200, subject=(40, 30, 25), background=(240, 240, 240), alpha=None):
    """A photo made from a subject colour over a background colour through the given alpha."""
    alpha = soft_disc(size) if alpha is None else alpha
    a = alpha[..., None]
    rgb = np.array(subject, np.float32) * a + np.array(background, np.float32) * (1 - a)
    return rgb.round().astype(np.uint8), alpha


def test_transition_band_is_only_the_uncertain_pixels():
    alpha = np.array([[0.0, 0.04, 0.05, 0.3, 0.95, 0.96, 1.0]], np.float32)
    assert detect_transition_band(alpha, 0.05, 0.95).tolist() == [[False, False, False, True, False, False, False]]


def test_refinement_keeps_soft_alpha_and_confident_pixels():
    rgb, alpha = scene()
    refined = refine_alpha_edges(rgb, alpha, RefineSettings(low=0.05, high=0.95))
    # No thresholding: the soft edge still has a full range of intermediate values.
    soft = refined[(refined > 0.02) & (refined < 0.98)]
    assert soft.size > 500
    assert len(np.unique(np.round(soft, 2))) > 50
    # Confident pixels, away from the band, are exactly what they were.
    far_inside = soft_disc(radius=40, softness=1) > 0.99
    far_outside = soft_disc(radius=85, softness=1) < 0.01
    assert np.array_equal(refined[far_inside], alpha[far_inside])
    assert np.array_equal(refined[far_outside], alpha[far_outside])


def test_refinement_snaps_a_blurry_alpha_to_the_photos_edge():
    """An alpha blurred by upscaling, over a photo with a crisp edge: the refinement makes it crisper, not softer."""
    sharp = soft_disc(softness=1.5)
    rgb, _ = scene(alpha=sharp)
    blurry = soft_disc(softness=14)
    refined = refine_alpha_edges(rgb, blurry, RefineSettings(low=0.05, high=0.95, radius=12, eps=1e-4))
    assert np.abs(refined - sharp).mean() < np.abs(blurry - sharp).mean() * 0.7


def test_decontamination_removes_a_light_halo_and_leaves_opaque_pixels():
    rgb, alpha = scene(subject=(30, 20, 15), background=(250, 250, 250))
    cleaned = decontaminate_edges(rgb, alpha)
    edge = (alpha > 0.15) & (alpha < 0.85)
    # The fringe takes the subject's dark colour instead of the white wall's.
    assert cleaned[edge].mean() < rgb[edge].mean() - 40
    opaque = alpha >= 0.98
    assert np.array_equal(cleaned[opaque], rgb[opaque])


def test_decontamination_strength_zero_changes_nothing():
    rgb, alpha = scene()
    assert np.array_equal(decontaminate_edges(rgb, alpha, strength=0), rgb)


def test_alpha_resizes_to_the_original_size_without_thresholding():
    alpha = soft_disc(size=96)
    big = resize_alpha_to_original(alpha, 400, 300)
    assert big.shape == (300, 400)
    assert ((big > 0.05) & (big < 0.95)).sum() > 1000
    assert 0.0 <= big.min() and big.max() <= 1.0


def test_composed_png_keeps_rgb_resolution_and_real_transparency():
    rgb, alpha = scene(size=120)
    png = encode_png(compose_rgba(rgb, alpha))
    out = np.asarray(Image.open(io.BytesIO(png)))
    assert out.shape == (120, 120, 4)
    assert np.array_equal(out[..., :3], rgb)
    assert out[0, 0, 3] == 0 and out[60, 60, 3] == 255
    assert len(np.unique(out[..., 3])) > 20  # soft levels, not just 0 and 255


def test_cleanup_drops_specks_and_fills_pinholes_but_keeps_the_edge():
    alpha = soft_disc()
    alpha[5:8, 5:8] = 1.0  # a speck far from the subject
    alpha[100, 100] = 0.0  # a pinhole inside it
    cleaned = masks.fill_holes(masks.remove_specks(alpha))
    assert cleaned[5:8, 5:8].max() == 0.0
    assert cleaned[100, 100] == 1.0
    band = (alpha > 0.05) & (alpha < 0.95)
    assert np.array_equal(cleaned[band], alpha[band])


def test_model_input_keeps_aspect_ratio_and_padding_is_neutral():
    image = Image.new("RGB", (300, 150), (255, 0, 0))
    prepared = model_input(image, 256)
    assert prepared.pixels.shape == (3, 256, 256)
    x0, y0, x1, y1 = prepared.box
    assert (x1 - x0, y1 - y0) == (256, 128)  # 2:1 kept, not stretched to a square
    assert np.allclose(prepared.pixels[:, 0, 0], 0, atol=0.02)  # padding = the mean colour = 0 after normalising


def test_open_image_applies_exif_and_rejects_bad_input():
    image = Image.new("RGB", (40, 20), (10, 20, 30))
    exif = image.getexif()
    exif[0x0112] = 6  # rotate 90° on display
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif)
    assert open_image(buffer.getvalue(), 10_000).size == (20, 40)
    with pytest.raises(InvalidImage):
        open_image(b"not an image", 10_000)
    with pytest.raises(ImageTooLarge):
        open_image(buffer.getvalue(), 100)


def test_speck_removal_keeps_solid_strands_inside_soft_hair():
    """A solid strand surrounded by soft fur is joined to the subject through it — it must not be holed."""
    alpha = soft_disc()
    alpha[20:60, 90:110] = 0.3  # soft fur reaching out from the subject…
    alpha[58:62, 90:110] = np.maximum(alpha[58:62, 90:110], 0.3)
    alpha[30:34, 98:102] = 1.0  # …with a solid strand inside it
    cleaned = masks.remove_specks(alpha)
    assert np.array_equal(cleaned, alpha)


def test_open_image_accepts_camera_jpegs_with_embedded_previews():
    """A camera JPEG carrying previews (Pillow's "MPO") is a JPEG: the main picture is used."""
    main, preview = Image.new("RGB", (60, 40), (200, 10, 10)), Image.new("RGB", (16, 10), (0, 0, 200))
    buffer = io.BytesIO()
    main.save(buffer, format="MPO", save_all=True, append_images=[preview])
    assert Image.open(io.BytesIO(buffer.getvalue())).format == "MPO"
    opened = open_image(buffer.getvalue(), 10_000)
    assert opened.size == (60, 40)
    assert opened.getpixel((5, 5))[0] > 150  # the red main picture, not the blue preview
