import assert from "node:assert/strict";
import { test } from "node:test";
import { capabilities, parseOperations, RESTORE_OPERATIONS } from "./restorationService.js";

test("operations run in pipeline order, each once, whatever order they were asked in", () => {
    assert.deepEqual(parseOperations("upscale, faces,scratches,faces,denoise"), ["denoise", "scratches", "faces", "upscale"]);
    assert.deepEqual(parseOperations("COLORIZE"), ["colorize"]);
});

test("unknown or missing operations are refused", () => {
    for (const value of [undefined, "", " , ", "scratches,sharpen", "../etc"]) {
        assert.throws(() => parseOperations(value), (error: { code?: string; statusCode?: number }) => error.code === "INVALID_OPERATIONS" && error.statusCode === 400);
    }
});

test("every operation reports availability, an engine and no filesystem paths", () => {
    const list = capabilities();
    assert.deepEqual(
        list.map((capability) => capability.id),
        [...RESTORE_OPERATIONS],
    );
    for (const capability of list) {
        assert.ok(capability.engine);
        assert.equal(capability.available, capability.reason === null);
        assert.doesNotMatch(JSON.stringify(capability), /\//);
    }
    // The image service isn't running in a unit test: its steps say so instead of claiming to work.
    assert.equal(list.find((capability) => capability.id === "denoise")?.reason, "starting");
});
