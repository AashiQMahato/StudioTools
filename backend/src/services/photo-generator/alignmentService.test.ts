import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { checkRoll, measureRoll, rotateCutout, rotateFace, rotationFor } from "./alignmentService.js";
import type { DetectedFace } from "./faceDetectionService.js";

const face = (rightEye: [number, number], leftEye: [number, number]): DetectedFace => ({
    box: { x: rightEye[0] - 20, y: rightEye[1] - 30, width: leftEye[0] - rightEye[0] + 40, height: 100 },
    score: 0.9,
    sharpness: 100,
    brightness: 120,
    landmarks: { rightEye: { x: rightEye[0], y: rightEye[1] }, leftEye: { x: leftEye[0], y: leftEye[1] }, nose: { x: 0, y: 0 }, mouthRight: { x: 0, y: 0 }, mouthLeft: { x: 0, y: 0 } },
});

test("roll is the eye line's angle: level 0, sloping down to the person's left positive", () => {
    assert.equal(measureRoll(face([100, 100], [200, 100])), 0);
    assert.ok(Math.abs(measureRoll(face([100, 100], [200, 100 + Math.tan((7 * Math.PI) / 180) * 100])) - 7) < 1e-9);
});

test("turning by minus the roll levels the eyes (landmarks carried through)", () => {
    for (const roll of [-12, -5, 3, 10]) {
        const tilted = face([300, 200], [300 + 120 * Math.cos((roll * Math.PI) / 180), 200 + 120 * Math.sin((roll * Math.PI) / 180)]);
        const turned = rotateFace(tilted, rotationFor(800, 600, -measureRoll(tilted)));
        assert.ok(Math.abs(measureRoll(turned)) < 1e-6, `roll ${roll}`);
    }
});

test("map and unmap are inverses", () => {
    const rotation = rotationFor(640, 480, 11.5);
    for (const point of [{ x: 0, y: 0 }, { x: 320, y: 100 }, { x: 639, y: 479 }]) {
        const back = rotation.unmap(rotation.map(point));
        assert.ok(Math.hypot(back.x - point.x, back.y - point.y) < 1e-9);
    }
});

test("the cut-out's colour and alpha are turned together, once; tiny angles leave it alone", async () => {
    const width = 120, height = 80;
    const raw = Buffer.alloc(width * height * 4);
    for (let y = 20; y < 60; y++) for (let x = 30; x < 90; x++) raw.set([200, 50, 50, 255], (y * width + x) * 4);
    const png = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const alpha = await sharp(png).extractChannel(3).raw().toBuffer();
    const untouched = await rotateCutout({ png, alpha, width, height }, 0.1);
    assert.equal(untouched.rotation, null);
    assert.equal(untouched.png, png);
    const turned = await rotateCutout({ png, alpha, width, height }, 10);
    assert.ok(turned.width > width && turned.height > height);
    assert.equal(turned.alpha.length, turned.width * turned.height);
    // Where the colour is, the alpha is: the solid block moved as one.
    const colour = await sharp(turned.png).raw().toBuffer();
    let mismatched = 0;
    for (let i = 0; i < turned.alpha.length; i++) if ((turned.alpha[i]! > 200) !== (colour[i * 4 + 3]! > 200)) mismatched++;
    assert.equal(mismatched, 0);
    // Corners outside the turned photo are transparent (they become background), not black.
    assert.equal(turned.alpha[0], 0);
});

test("tilts beyond the limit are refused, not turned", () => {
    assert.doesNotThrow(() => checkRoll(14.9));
    assert.throws(() => checkRoll(-15.1), /too extreme/);
});
