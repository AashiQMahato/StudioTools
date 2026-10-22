import assert from "node:assert/strict";
import { test } from "node:test";
import { readSavedScene, SAVED_SCENE_VERSION } from "./storage";

const scene = JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {} });

test("a well-formed record is read back with its view", () => {
    const record = readSavedScene({ version: SAVED_SCENE_VERSION, savedAt: 5, scene, view: { scrollX: 10, scrollY: -4, zoom: 1.5 } });
    assert.deepEqual(record, { version: SAVED_SCENE_VERSION, savedAt: 5, scene, view: { scrollX: 10, scrollY: -4, zoom: 1.5 } });
});

test("malformed, empty or unknown-version records read as nothing", () => {
    for (const value of [undefined, null, "scene", 42, {}, { version: 2, scene }, { version: SAVED_SCENE_VERSION, scene: "" }, { version: SAVED_SCENE_VERSION, scene: 1 }]) {
        assert.equal(readSavedScene(value), null, JSON.stringify(value));
    }
});

test("a broken view is dropped but the drawing is kept", () => {
    for (const view of [{ scrollX: 0, scrollY: 0, zoom: 0 }, { scrollX: Number.NaN, scrollY: 0, zoom: 1 }, "far", null]) {
        const record = readSavedScene({ version: SAVED_SCENE_VERSION, savedAt: "yesterday", scene, view });
        assert.equal(record?.scene, scene);
        assert.equal(record?.view, undefined);
        assert.equal(record?.savedAt, 0);
    }
});
