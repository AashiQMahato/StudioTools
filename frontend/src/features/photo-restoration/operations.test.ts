import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSelection, engineName, isMonochrome, OPERATIONS, parseSteps } from "./operations";

const fill = (pixel: (index: number) => [number, number, number]) => {
    const data = new Uint8ClampedArray(64 * 64 * 4);
    for (let index = 0; index < 64 * 64; index++) data.set([...pixel(index), 255], index * 4);
    return data;
};

test("operations are listed in the server's order", () => {
    assert.deepEqual(
        OPERATIONS.map((operation) => operation.id),
        ["denoise", "scratches", "fade", "colorize", "faces", "upscale"],
    );
});

test("the default is the gentle clean-up, plus colorize for black-and-white photos", () => {
    assert.deepEqual(defaultSelection(false), ["denoise", "scratches", "fade"]);
    assert.deepEqual(defaultSelection(true), ["denoise", "scratches", "fade", "colorize"]);
});

test("grey and sepia photos are monochrome; a colourful one isn't", () => {
    assert.ok(isMonochrome(fill((index) => [index % 256, index % 256, index % 256])));
    assert.ok(isMonochrome(fill((index) => [Math.min(255, (index % 200) + 40), Math.min(255, (index % 200) + 20), index % 200])));
    assert.ok(!isMonochrome(fill((index) => (index % 3 === 0 ? [220, 40, 40] : index % 3 === 1 ? [40, 200, 60] : [30, 60, 220]))));
    assert.ok(!isMonochrome(new Uint8ClampedArray(0)));
});

test("the steps header is read defensively", () => {
    assert.deepEqual(parseSteps(null), []);
    assert.deepEqual(parseSteps("not json"), []);
    assert.deepEqual(parseSteps('{"id":"fade"}'), []);
    const steps = parseSteps('[{"id":"fade","engine":"opencv-clahe","skipped":null},{"id":"colorize","engine":null,"skipped":"already-colour"},42]');
    assert.equal(steps.length, 2);
    assert.equal(steps[1]?.skipped, "already-colour");
});

test("engine ids read as names", () => {
    assert.equal(engineName("gfpgan-1.4-onnx"), "GFPGAN 1.4");
    assert.equal(engineName("something-new"), "something-new");
    assert.equal(engineName(null), "");
});
