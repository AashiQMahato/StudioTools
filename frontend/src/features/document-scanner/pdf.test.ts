import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPdf, jpegInfo, layoutPage } from "./pdf";

// A 16×8 baseline JPEG.
const JPEG = Uint8Array.from(Buffer.from("/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAACAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgACAAQAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMABgYGBgYGCgYGCg4KCgoOEg4ODg4SFxISEhISFxwXFxcXFxccHBwcHBwcHCIiIiIiIicnJycnLCwsLCwsLCwsLP/bAEMBBwcHCwoLEwoKEy4fGh8uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLv/dAAQAAf/aAAwDAQACEQMRAD8Aiooor48++P/Z", "base64"));

test("jpegInfo reads the frame header", () => {
    assert.deepEqual(jpegInfo(JPEG), { width: 16, height: 8, components: 3 });
});

test("layoutPage fits the image on turned paper, or makes the page its shape", () => {
    const a4 = layoutPage("a4", 1600, 800);
    assert.equal(a4.width, 841.89);
    assert.equal(a4.height, 595.28);
    assert.ok(Math.abs(a4.image.width - 841.89) < 1e-9 && Math.abs(a4.image.x) < 1e-9);
    const fit = layoutPage("fit", 1000, 2000);
    assert.ok(Math.abs(fit.height - 841.89) < 1e-9 && Math.abs(fit.width - 420.945) < 1e-9);
});

test("buildPdf writes a well-formed file with exact xref offsets", async () => {
    const bytes = buildPdf([JPEG, JPEG, JPEG], "letter");
    const text = Buffer.from(bytes).toString("latin1");
    assert.ok(text.startsWith("%PDF-1.4\n"));
    assert.ok(text.endsWith("%%EOF\n"));
    assert.match(text, /\/Count 3 >>/);
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1]);
    assert.ok(text.slice(startxref).startsWith("xref\n0 12\n"));
    const entries = text.slice(startxref).split("\n").slice(2, 14);
    assert.equal(entries[0], "0000000000 65535 f ");
    for (let id = 1; id < 12; id++) {
        const offset = Number(entries[id]!.slice(0, 10));
        assert.ok(text.slice(offset).startsWith(`${id} 0 obj\n`), `object ${id} at ${offset}`);
    }
    // The embedded image is the JPEG, byte for byte.
    assert.ok(text.includes(Buffer.from(JPEG).toString("latin1")));

    // And a real PDF reader opens it.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({ data: bytes.slice() });
    const pdf = await task.promise;
    assert.equal(pdf.numPages, 3);
    const page = await pdf.getPage(2);
    assert.deepEqual(page.view.map((value: number) => Math.round(value)), [0, 0, 792, 612]);
    await task.destroy();
});
