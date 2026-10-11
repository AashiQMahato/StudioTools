import assert from "node:assert/strict";
import { test } from "node:test";
import { adaptiveThreshold, reduceShadows, stretchContrast } from "./filters";

const W = 200;
const H = 100;
/** Paper lit from the right: the left half in shadow. Small dark "letters" on both halves. */
function shadowedPage() {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const paper = x < W / 2 ? 110 : 230;
            const ink = x % 20 < 4 && y % 20 < 8;
            const v = ink ? paper * 0.3 : paper;
            data.set([v, v, v, 255], (y * W + x) * 4);
        }
    }
    return data;
}
const isInk = (x: number, y: number) => x % 20 < 4 && y % 20 < 8;

test("adaptiveThreshold keeps shaded paper white and ink black", () => {
    const data = shadowedPage();
    const lum = new Uint8ClampedArray(W * H).map((_, i) => data[i * 4]!);
    const out = adaptiveThreshold(lum, W, H, 10);
    let wrong = 0;
    // A plain global threshold would turn the whole shaded half black. Only the window's width either
    // side of this (unrealistically hard) shadow line is allowed to blend.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.abs(x - W / 2) > 10 && out[y * W + x] !== (isInk(x, y) ? 0 : 255)) wrong++;
    assert.equal(wrong, 0);
});

test("reduceShadows evens out the paper and keeps the ink dark", () => {
    const data = shadowedPage();
    reduceShadows(data, W, H);
    const at = (x: number, y: number) => data[(y * W + x) * 4]!;
    // Paper on both sides, away from the letters and the shadow line.
    const shaded = at(30, 15);
    const lit = at(170, 15);
    assert.ok(shaded > 225 && lit > 225, `paper ${shaded} / ${lit}`);
    assert.ok(Math.abs(shaded - lit) < 15);
    assert.ok(at(21, 2) < 110 && at(161, 2) < 110, `ink ${at(21, 2)} / ${at(161, 2)}`);
});

test("stretchContrast spreads a dull range to full black and white", () => {
    const data = new Uint8ClampedArray(100 * 4);
    for (let i = 0; i < 100; i++) data.set([80 + i, 80 + i, 80 + i, 255], i * 4);
    stretchContrast(data);
    assert.ok(data[0]! <= 3 && data[99 * 4]! >= 252);
});
