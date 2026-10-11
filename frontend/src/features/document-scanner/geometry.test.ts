import assert from "node:assert/strict";
import { test } from "node:test";
import { homography, orderCorners, outputSize, project, type Quad, rotateQuad, warpPerspective } from "./geometry";

const quad: Quad = [
    { x: 40, y: 30 },
    { x: 260, y: 55 },
    { x: 240, y: 290 },
    { x: 25, y: 250 },
];
const square: Quad = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
];

test("homography maps the four corners exactly", () => {
    const h = homography(square, quad);
    square.forEach((corner, i) => {
        const p = project(h, corner.x, corner.y);
        assert.ok(Math.abs(p.x - quad[i]!.x) < 1e-6 && Math.abs(p.y - quad[i]!.y) < 1e-6, `corner ${i}`);
    });
});

test("homography maps an interior point like the inverse does", () => {
    // The centre of the square goes to where the quad's diagonals cross (projective maps keep incidence).
    const p = project(homography(square, quad), 50, 50);
    const [a, b, c, d] = quad;
    // Intersection of a–c and b–d.
    const den = (a.x - c.x) * (b.y - d.y) - (a.y - c.y) * (b.x - d.x);
    const t = ((a.x - b.x) * (b.y - d.y) - (a.y - b.y) * (b.x - d.x)) / den;
    assert.ok(Math.abs(p.x - (a.x + t * (c.x - a.x))) < 1e-6);
    assert.ok(Math.abs(p.y - (a.y + t * (c.y - a.y))) < 1e-6);
    const back = project(homography(quad, square), p.x, p.y);
    assert.ok(Math.abs(back.x - 50) < 1e-6 && Math.abs(back.y - 50) < 1e-6);
});

test("orderCorners puts shuffled corners in reading order", () => {
    assert.deepEqual(orderCorners([quad[2], quad[0], quad[3], quad[1]]), quad);
});

test("rotateQuad turns the output clockwise", () => {
    const turned = rotateQuad(square, 1);
    assert.deepEqual(turned[0], square[3]);
    assert.deepEqual(rotateQuad(square, 4), square);
    assert.deepEqual(outputSize(rotateQuad([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }], 1)), { width: 100, height: 200 });
});

test("outputSize averages opposite edges and caps the long side", () => {
    assert.deepEqual(outputSize(quad, 10_000), { width: Math.round((Math.hypot(220, 25) + Math.hypot(215, 40)) / 2), height: Math.round((Math.hypot(15, 220) + Math.hypot(20, 235)) / 2) });
    assert.equal(Math.max(...Object.values(outputSize([{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 3000 }, { x: 0, y: 3000 }]))), 3500);
});

test("warping a skewed rectangle gives the upright rectangle back", () => {
    // A 300×300 image with a 120×80 "page" (white, with a black block in its top-left quarter) drawn
    // through a known homography, then flattened again.
    const W = 300;
    const pageW = 120;
    const pageH = 80;
    const corners: Quad = [
        { x: 60, y: 40 },
        { x: 250, y: 80 },
        { x: 220, y: 260 },
        { x: 40, y: 200 },
    ];
    const toPage = homography(corners, [{ x: 0, y: 0 }, { x: pageW, y: 0 }, { x: pageW, y: pageH }, { x: 0, y: pageH }]);
    const data = new Uint8ClampedArray(W * W * 4);
    for (let y = 0; y < W; y++) {
        for (let x = 0; x < W; x++) {
            const p = project(toPage, x + 0.5, y + 0.5);
            const inside = p.x >= 0 && p.x < pageW && p.y >= 0 && p.y < pageH;
            const ink = p.x < pageW / 2 && p.y < pageH / 2;
            const v = inside ? (ink ? 0 : 255) : 100;
            data.set([v, v, v, 255], (y * W + x) * 4);
        }
    }
    const out = warpPerspective({ data, width: W, height: W }, corners, pageW, pageH);
    let wrong = 0;
    for (let y = 0; y < pageH; y++) {
        for (let x = 0; x < pageW; x++) {
            // Skip a 2 px band at the boundaries, where any resampling blends.
            const nearEdge = x < 2 || y < 2 || x >= pageW - 2 || y >= pageH - 2 || Math.abs(x - pageW / 2) < 2 || Math.abs(y - pageH / 2) < 2;
            if (nearEdge) continue;
            const expected = x < pageW / 2 && y < pageH / 2 ? 0 : 255;
            if (Math.abs(out[(y * pageW + x) * 4]! - expected) > 40) wrong++;
        }
    }
    assert.equal(wrong, 0);
});
