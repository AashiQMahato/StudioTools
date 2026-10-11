import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BlockStyle, OcrDocument } from "@/lib/api/ocrApi";
import { applyTranslations, blocksFrom, hasTranslation, isStale, textFile, type TranslatorBlock } from "./blocks";
import { fontStackFor, LANGUAGE_CODE, SOURCE_LANGUAGES, TARGET_LANGUAGES, targetLanguage, translationSource } from "./languages";
import { fitText, planOverlay, wrap } from "./layout";

/** A monospace stand-in for canvas measureText: each character is 0.5 em wide. */
const sizeOf = (font: string) => Number(/([\d.]+)px/.exec(font)?.[1] ?? 10);
const measure = (text: string, font: string) => [...text].length * sizeOf(font) * 0.5;
const chars = (text: string) => [...text].length;

const style = (over: Partial<BlockStyle> = {}): BlockStyle => ({ fontFamily: "Inter", fontSize: 20, fontWeight: 400, fontStyle: "normal", color: "#111111", backgroundColor: "#ffffff", textAlign: "left", lineHeight: 1.2, inferred: {}, ...over });
const block = (id: string, original: string, translated: string | null, over: Partial<TranslatorBlock> = {}): TranslatorBlock => ({ id, bbox: { x: 10, y: 10, width: 200, height: 40 }, style: style(), original, translated, translatedFrom: translated === null ? null : original, ...over });

describe("wrap", () => {
    it("breaks at spaces, never exceeding the width, keeping every word in order", () => {
        const lines = wrap("the quick brown fox jumps over the lazy dog", 10, chars);
        assert.deepEqual(lines, ["the quick", "brown fox", "jumps over", "the lazy", "dog"]);
        assert.equal(lines.join(" "), "the quick brown fox jumps over the lazy dog");
    });
    it("keeps explicit line breaks and breaks a word too long for the line", () => {
        assert.deepEqual(wrap("ab\nabcdefghij", 4, chars), ["ab", "abcd", "efgh", "ij"]);
    });
    it("keeps Devanagari clusters whole when it has to break inside a word", () => {
        const lines = wrap("नमस्ते", 2, chars, "ne");
        assert.equal(lines.join(""), "नमस्ते");
        // No line starts with a combining sign (a vowel sign or virama cut from its consonant).
        for (const line of lines) assert.ok(!/^[ऀ-ःऺ-ॏ]/.test(line), line);
    });
    it("breaks Chinese between words, though it has no spaces", () => {
        const lines = wrap("我们今天去公园散步", 4, chars, "zh");
        assert.ok(lines.length > 1);
        assert.equal(lines.join(""), "我们今天去公园散步");
        for (const line of lines) assert.ok(chars(line) <= 4, line);
    });
});

describe("fitText", () => {
    const font = (size: number) => `400 ${size}px Inter`;
    it("uses the largest size that fits, up to the maximum", () => {
        const fit = fitText("Hi", { width: 200, height: 40 }, { maxSize: 20, minSize: 8, lineHeight: 1.25, font, measure });
        assert.ok(fit);
        assert.equal(fit.size, 20);
        assert.deepEqual(fit.lines, ["Hi"]);
    });
    it("shrinks and wraps a long translation to fit inside the box", () => {
        const box = { width: 100, height: 40 };
        const fit = fitText("a much longer translated sentence", box, { maxSize: 20, minSize: 6, lineHeight: 1.25, font, measure });
        assert.ok(fit);
        assert.ok(fit.size < 20);
        assert.ok(fit.lines.length * fit.lineHeight <= box.height + 0.5);
        for (const line of fit.lines) assert.ok(measure(line, font(fit.size)) <= box.width + 0.5, line);
        assert.equal(fit.lines.join(" "), "a much longer translated sentence");
    });
    it("gives up (null) rather than going below the legible minimum", () => {
        assert.equal(fitText("far too much text for a tiny box ".repeat(5), { width: 40, height: 12 }, { maxSize: 20, minSize: 8, lineHeight: 1.25, font, measure }), null);
    });
});

describe("planOverlay", () => {
    const image = { width: 800, height: 600, fontScale: 1 };
    const options = { fontFamily: fontStackFor(targetLanguage("ne")), locale: "ne", measure };
    it("paints a padded patch in the block's background, kept inside the image, with the block's colour and weight", () => {
        const plan = planOverlay([block("a", "Hello", "नमस्ते", { bbox: { x: 2, y: 3, width: 200, height: 40 }, style: style({ color: "#c00000", backgroundColor: "#fafafa", fontWeight: 700, textAlign: "center" }) })], image, options);
        assert.equal(plan.skipped, 0);
        const draw = plan.draws[0]!;
        assert.equal(draw.background, "#fafafa");
        assert.equal(draw.color, "#c00000");
        assert.equal(draw.align, "center");
        assert.ok(draw.font.startsWith("700 "));
        assert.ok(draw.font.includes("Noto Sans Devanagari"));
        assert.ok(draw.patch.x >= 0 && draw.patch.y >= 0);
        assert.ok(draw.patch.width >= 200 && draw.patch.height >= 40);
    });
    it("skips (and counts) blocks that can't fit, and leaves untranslated or empty ones alone", () => {
        const plan = planOverlay(
            [block("fits", "Hi", "Ok"), block("toolong", "Hi", "an extremely long translation that cannot possibly fit ".repeat(4), { bbox: { x: 0, y: 0, width: 60, height: 14 } }), block("none", "Hi", null), block("blank", "Hi", "  ")],
            image,
            options,
        );
        assert.deepEqual(plan.draws.map((draw) => draw.id), ["fits"]);
        assert.equal(plan.skipped, 1);
    });
    it("scales the OCR's editor font size to image pixels", () => {
        const plan = planOverlay([block("a", "Hi", "Ok", { bbox: { x: 0, y: 0, width: 400, height: 200 } })], { width: 1600, height: 1200, fontScale: 2 }, options);
        assert.equal(sizeOf(plan.draws[0]!.font), 44);
    });
});

describe("blocks", () => {
    const document = {
        document: { width: 800, height: 600, background: "#fff", pageWidth: 800, region: null },
        language: "en",
        blocks: [
            { id: "b1", type: "title", text: "Title", bbox: { x: 0, y: 0, width: 100, height: 20 }, editorBox: { x: 0, y: 0, width: 0.1, height: 0.1 }, confidence: 0.9, language: "en", lines: [], style: style() },
            { id: "b2", type: "paragraph", text: "Body\ntext", bbox: { x: 0, y: 30, width: 100, height: 40 }, editorBox: { x: 0, y: 0, width: 0.1, height: 0.1 }, confidence: 0.9, language: "en", lines: [], style: style() },
        ],
        stats: { blocks: 2, lines: 3, words: 3, averageConfidence: 0.9, lowConfidenceWords: 0 },
        engine: { provider: "test", layout: "geometry" },
    } satisfies OcrDocument;

    it("map one-to-one onto the OCR blocks, untranslated", () => {
        const blocks = blocksFrom(document);
        assert.deepEqual(blocks.map((b) => [b.id, b.original, b.translated, b.bbox]), [["b1", "Title", null, document.blocks[0]!.bbox], ["b2", "Body\ntext", null, document.blocks[1]!.bbox]]);
        assert.equal(hasTranslation(blocks), false);
    });
    it("take translations back in order, and know when an edit made one stale", () => {
        const blocks = blocksFrom(document);
        const translated = applyTranslations(blocks, ["Title", "Body\ntext"], ["शीर्षक", "मुख्य\nपाठ"]);
        assert.deepEqual(translated.map((b) => b.translated), ["शीर्षक", "मुख्य\nपाठ"]);
        assert.equal(hasTranslation(translated), true);
        assert.equal(isStale(translated[0]!), false);
        assert.equal(isStale({ ...translated[0]!, original: "Title!" }), true);
        assert.throws(() => applyTranslations(blocks, ["Title", "Body"], ["one"]));
    });
    it("export .txt: blocks in order, blank line between, nothing untranslated passed off as translated", () => {
        const blocks = [block("a", " First ", "Pahilo"), block("b", "", null), block("c", "Third", null)];
        assert.equal(textFile(blocks, "original"), "First\n\nThird\n");
        assert.equal(textFile(blocks, "translated"), "Pahilo\n");
        assert.equal(textFile([block("x", "only", null)], "translated"), "");
    });
});

describe("languages", () => {
    it("source choices are exactly the OCR's", () => {
        assert.deepEqual([...SOURCE_LANGUAGES], ["auto", "en", "ne", "mixed"]);
        assert.equal(translationSource("auto"), "auto");
        assert.equal(translationSource("mixed"), "auto");
        assert.equal(translationSource("ne"), "ne");
    });
    it("targets are unique, pass the backend's code pattern and include English, Nepali and Hindi", () => {
        const codes = TARGET_LANGUAGES.map((language) => language.code);
        assert.equal(new Set(codes).size, codes.length);
        for (const code of codes) assert.match(code, LANGUAGE_CODE);
        for (const code of ["en", "ne", "hi"]) assert.ok(codes.includes(code), code);
        assert.equal(targetLanguage("ne").script, "devanagari");
        assert.equal(targetLanguage("hi").script, "devanagari");
        assert.ok(fontStackFor(targetLanguage("hi")).startsWith(`"Noto Sans Devanagari"`));
    });
});
