import assert from "node:assert/strict";
import { test } from "node:test";
import { detectDocument, otsu } from "./detect";
import { homography, project, type Quad } from "./geometry";

/** A seeded generator, so the noise is the same every run. */
function random(seed: number) {
    return () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 2 ** 32;
    };
}

/** A bright page with lines of "text" on a darker, noisy, slightly coloured table. */
function photo(width: number, height: number, corners: Quad) {
    const next = random(7);
    const toPage = homography(corners, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const p = project(toPage, x + 0.5, y + 0.5);
            const inside = p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
            const noise = (next() - 0.5) * 40;
            const text = inside && p.x > 0.15 && p.x < 0.85 && Math.floor(p.y * 40) % 3 === 0 && p.y > 0.1 && p.y < 0.9;
            const rgb = !inside ? [110 + noise, 85 + noise, 60 + noise] : text ? [30 + noise, 30 + noise, 35 + noise] : [228 + noise / 2, 226 + noise / 2, 220 + noise / 2];
            data.set([...rgb, 255], (y * width + x) * 4);
        }
    }
    return data;
}

test("otsu splits a two-peak histogram between the peaks", () => {
    const histogram = new Array(256).fill(0);
    histogram[40] = 500;
    histogram[200] = 300;
    const threshold = otsu(histogram);
    assert.ok(threshold >= 40 && threshold < 200);
});

test("detectDocument finds a tilted page within a few pixels", () => {
    const corners: Quad = [
        { x: 92, y: 61 },
        { x: 402, y: 88 },
        { x: 380, y: 342 },
        { x: 70, y: 318 },
    ];
    const { quad, confident } = detectDocument(photo(480, 400, corners), 480, 400);
    assert.ok(confident);
    quad.forEach((corner, i) => {
        const error = Math.hypot(corner.x - corners[i]!.x, corner.y - corners[i]!.y);
        assert.ok(error < 4, `corner ${i} off by ${error.toFixed(1)} px`);
    });
});

test("detectDocument falls back to an inset frame when there's no page", () => {
    const next = random(3);
    const data = new Uint8ClampedArray(200 * 150 * 4).map((_, i) => (i % 4 === 3 ? 255 : next() * 255));
    const { quad, confident } = detectDocument(data, 200, 150);
    assert.equal(confident, false);
    assert.deepEqual(quad[0], { x: 10, y: 7.5 });
});
