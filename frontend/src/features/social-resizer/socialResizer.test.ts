import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alignView, centreView, clampView, containScale, coverScale, cropShare, cropWarning, placement, upscaleWarning, zoomAbout } from "./frame";
import { exportName, PLATFORMS, PRESETS, presetsFor, ratioLabel, ratioValue, validateCustom } from "./presets";

const photo = { width: 4000, height: 3000 };
const close = (a: number, b: number, epsilon = 1e-6) => assert.ok(Math.abs(a - b) < epsilon, `${a} ≉ ${b}`);

describe("presets", () => {
    it("have positive integer sizes, unique ids and a ratio matching the label", () => {
        const ids = new Set<string>();
        for (const preset of PRESETS) {
            assert.ok(Number.isInteger(preset.width) && preset.width > 0, preset.id);
            assert.ok(Number.isInteger(preset.height) && preset.height > 0, preset.id);
            assert.ok(!ids.has(preset.id), `duplicate ${preset.id}`);
            ids.add(preset.id);
            const ratio = ratioValue(preset.ratio);
            assert.ok(Math.abs(ratio - preset.width / preset.height) / ratio < 0.01, `${preset.id}: ${preset.ratio} vs ${preset.width}×${preset.height}`);
            assert.ok(preset.id.startsWith(`${preset.platform}-`), preset.id);
        }
    });

    it("keep safe areas inside the frame", () => {
        for (const { id, safe } of PRESETS) {
            if (!safe) continue;
            assert.ok(Object.values(safe).every((value) => value >= 0 && value < 1), id);
            assert.ok(safe.left + safe.right < 1 && safe.top + safe.bottom < 1, id);
        }
    });

    it("cover every platform, and quote the platforms' own sizes", () => {
        for (const platform of PLATFORMS) assert.ok(presetsFor(platform).length > 0, platform);
        const banner = PRESETS.find((preset) => preset.id === "youtube-banner")!;
        assert.equal(`${banner.width}x${banner.height}`, "2560x1440");
        close(banner.width * (1 - banner.safe!.left - banner.safe!.right), 1546);
        close(banner.height * (1 - banner.safe!.top - banner.safe!.bottom), 423);
    });
});

describe("cover / contain", () => {
    it("cover fills the frame, contain fits inside it", () => {
        const target = { width: 1080, height: 1350 };
        close(coverScale(photo, target), 0.45); // height-bound: 1350 / 3000
        close(containScale(photo, target), 0.27); // width-bound: 1080 / 4000
        const fill = placement(centreView(photo), photo, target, "fill");
        assert.ok(fill.width >= target.width - 1e-9 && fill.height >= target.height - 1e-9);
        close(fill.y, 0);
        const fit = placement(centreView(photo), photo, target, "fit");
        close(fit.width, 1080);
        close(fit.y, (1350 - 3000 * 0.27) / 2);
    });

    it("keeps Fill gap-free and Fit inside the frame", () => {
        const target = { width: 1080, height: 1080 };
        const far = clampView({ fx: -500, fy: 99999, zoom: 1 }, photo, target, "fill");
        const place = placement(far, photo, target, "fill");
        close(place.x, 0);
        close(place.y + place.height, 1080);
        const fit = placement(clampView({ fx: 0, fy: 0, zoom: 1 }, photo, target, "fit"), photo, target, "fit");
        assert.ok(fit.y + fit.height <= 1080 + 1e-9 && fit.x >= -1e-9);
    });

    it("aligns to the edges in both modes", () => {
        const target = { width: 1080, height: 1080 };
        const top = placement(alignView(centreView(photo), "top", photo, target, "fit"), photo, target, "fit");
        close(top.y, 0);
        const right = placement(alignView(centreView(photo), "right", photo, target, "fill"), photo, target, "fill");
        close(right.x + right.width, 1080);
    });

    it("zooms about a point without moving it", () => {
        const target = { width: 1080, height: 1080 };
        const view = centreView(photo);
        const point = { x: 200, y: -100 };
        const before = placement(view, photo, target, "fill");
        const after = placement(zoomAbout(view, 2, point, photo, target, "fill"), photo, target, "fill");
        // The image pixel under the point stays under it.
        const imageX = (540 + point.x - before.x) / before.scale;
        close(after.x + imageX * after.scale, 540 + point.x, 1e-6);
    });
});

describe("focal point across presets", () => {
    it("keeps the same image point centred when switching ratios", () => {
        const view = { fx: 1800, fy: 1400, zoom: 1.5 };
        for (const target of [{ width: 1080, height: 1920 }, { width: 1200, height: 627 }, { width: 1080, height: 1080 }]) {
            const kept = clampView(view, photo, target, "fill");
            assert.deepEqual(kept, view);
            const place = placement(kept, photo, target, "fill");
            close(place.x + 1800 * place.scale, target.width / 2);
            close(place.y + 1400 * place.scale, target.height / 2);
        }
    });

    it("only moves it as far as the new frame needs", () => {
        const edge = { fx: 100, fy: 1500, zoom: 1 };
        const kept = clampView(edge, photo, { width: 1080, height: 1920 }, "fill");
        assert.ok(kept.fx > 100);
        assert.equal(kept.fy, 1500);
    });
});

describe("warnings", () => {
    it("warn when Fill crops more than 25%", () => {
        assert.equal(cropWarning(centreView(photo), photo, { width: 1600, height: 1200 }, "fill"), null); // same ratio
        assert.equal(cropWarning(centreView(photo), photo, { width: 1080, height: 1080 }, "fill"), null); // exactly 25% is fine
        assert.equal(cropWarning(centreView(photo), photo, { width: 1080, height: 1920 }, "fill"), 58);
        assert.equal(cropWarning(centreView(photo), photo, { width: 1080, height: 1920 }, "fit"), null);
        close(cropShare(centreView(photo), photo, { width: 1080, height: 1350 }, "fill").x, 0.4);
    });

    it("warn when the output is upscaled", () => {
        const small = { width: 800, height: 600 };
        assert.equal(upscaleWarning(centreView(small), small, { width: 1080, height: 1080 }, "fill"), 1.8);
        assert.equal(upscaleWarning(centreView(photo), photo, { width: 1080, height: 1080 }, "fill"), null);
    });
});

describe("file names and custom sizes", () => {
    it("name exports after the preset and size", () => {
        assert.equal(exportName("Holiday Photo", "instagram-portrait", 1080, 1350, "jpg"), "holiday-photo-instagram-portrait-1080x1350.jpg");
        assert.equal(exportName("  ", "custom", 500, 500, "png"), "image-custom-500x500.png");
        assert.equal(exportName("काठमाडौं_2026", "tiktok-video", 1080, 1920, "webp"), "काठमाडौं-2026-tiktok-video-1080x1920.webp");
    });

    it("validates custom sizes", () => {
        assert.deepEqual(validateCustom("1200", "800"), { width: 1200, height: 800 });
        assert.deepEqual(validateCustom("", "800"), { error: "invalid" });
        assert.deepEqual(validateCustom("12.5", "800"), { error: "invalid" });
        assert.deepEqual(validateCustom("abc", "800"), { error: "invalid" });
        assert.deepEqual(validateCustom("8", "800"), { error: "tooSmall" });
        assert.deepEqual(validateCustom("8193", "800"), { error: "tooLarge" });
        assert.deepEqual(validateCustom("8192", "8192"), { error: "tooManyPixels" });
        assert.deepEqual(validateCustom("8192", "4096"), { width: 8192, height: 4096 });
    });

    it("labels ratios readably", () => {
        assert.equal(ratioLabel(1080, 1350), "4:5");
        assert.equal(ratioLabel(1920, 1080), "16:9");
        assert.equal(ratioLabel(1200, 627), "1.91:1");
        assert.equal(ratioLabel(627, 1200), "1:1.91");
    });
});
