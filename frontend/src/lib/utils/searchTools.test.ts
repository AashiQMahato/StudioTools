import assert from "node:assert/strict";
import { test } from "node:test";
import { matchRanges, searchTools } from "./searchTools";

const tools = [
    { id: "a", name: "Image Compressor", description: "Smaller files, same look", keywords: ["reduce", "shrink"] },
    { id: "b", name: "Compress PDF", description: "Reduce PDF size", keywords: [] },
    { id: "c", name: "Background Remover", description: "Transparent cut-outs", keywords: ["cutout"] },
];

test("matches names, descriptions and keywords; best name matches first", () => {
    assert.deepEqual(searchTools(tools, "compress").map((tool) => tool.id), ["b", "a"]);
    assert.deepEqual(searchTools(tools, "shrink").map((tool) => tool.id), ["a"]);
    assert.deepEqual(searchTools(tools, "transparent").map((tool) => tool.id), ["c"]);
});

test("every word must match, accents and case are ignored", () => {
    assert.deepEqual(searchTools(tools, "pdf reduce").map((tool) => tool.id), ["b"]);
    assert.deepEqual(searchTools(tools, "BACKGROUND cutout").map((tool) => tool.id), ["c"]);
    assert.deepEqual(searchTools(tools, "pdf background"), []);
});

test("an empty or unmatched query finds nothing", () => {
    assert.deepEqual(searchTools(tools, "   "), []);
    assert.deepEqual(searchTools(tools, "zzz"), []);
});

test("match ranges cover every word, merged and in order", () => {
    assert.deepEqual(matchRanges("Compress PDF", "pdf"), [[9, 12]]);
    assert.deepEqual(matchRanges("Compress PDF", "comp press"), [[0, 8]]);
    assert.deepEqual(matchRanges("PDF to PDF", "pdf"), [[0, 3], [7, 10]]);
    assert.deepEqual(matchRanges("Crop", "zoom"), []);
    assert.deepEqual(matchRanges("Crop", "  "), []);
});
