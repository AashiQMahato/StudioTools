import assert from "node:assert/strict";
import { test } from "node:test";
import { clampZoom, MAX_ZOOM, MIN_ZOOM, zoomAroundCenter, zoomLabel } from "./viewport";

const view = { scrollX: -40, scrollY: 25, zoom: 1, width: 1000, height: 600 };
const centerOf = (v: { scrollX: number; scrollY: number; zoom: number }) => [view.width / 2 / v.zoom - v.scrollX, view.height / 2 / v.zoom - v.scrollY];

test("zooming keeps the scene point in the middle of the canvas in place", () => {
    for (const next of [0.5, 1.1, 2, 3.7]) {
        const zoomed = zoomAroundCenter(view, next);
        const [x0, y0] = centerOf(view);
        const [x1, y1] = centerOf(zoomed);
        assert.ok(Math.abs(x0! - x1!) < 1e-9 && Math.abs(y0! - y1!) < 1e-9, String(next));
    }
});

test("zoom stays within the editor's range and rounds to whole percents", () => {
    assert.equal(clampZoom(0.01), MIN_ZOOM);
    assert.equal(clampZoom(99), MAX_ZOOM);
    assert.equal(clampZoom(1.2345), 1.23);
    assert.equal(zoomAroundCenter(view, 50).zoom, MAX_ZOOM);
    assert.equal(zoomLabel(1.1), "110%");
});
