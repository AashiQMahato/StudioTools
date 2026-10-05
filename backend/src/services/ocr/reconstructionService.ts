import { blockStyle, bodyMeasures, type LineInk, lineStyle } from "./formattingService.js";
import type { LayoutGroup } from "./layoutService.js";
import type { PreparedPage } from "./preprocessingService.js";
import type { Box, DocBlock, DocLine, OcrDocument, Recognition, RecognizedLine } from "./types.js";

/** The editor's page width in CSS pixels (A4/Letter-like at 96 dpi); heights follow the image. */
export const EDITOR_PAGE_WIDTH = 816;
/** Words the engine was less sure of than this are flagged for review (never changed). */
const LOW_CONFIDENCE = 0.8;

const DEVANAGARI = /[ऀ-ॿ]/u;
const LATIN = /[A-Za-z]/;

const scaleBox = (box: Box, scale: number): Box => ({ x: box.x / scale, y: box.y / scale, width: box.width / scale, height: box.height / scale });
const round = (box: Box): Box => ({ x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) });

function languageOf(text: string): DocBlock["language"] {
    const devanagari = DEVANAGARI.test(text);
    const latin = LATIN.test(text);
    return devanagari && latin ? "mixed" : devanagari ? "ne" : "en";
}

/**
 * The editable document: every block with its text (line breaks as in the image), its place in the
 * image (pixels) and on the editor page (fractions of the page), its structure and its estimated
 * formatting. Image and editor coordinates are kept separately, so the editor can render at any size.
 */
export function reconstruct(recognition: Recognition, groups: LayoutGroup[], page: PreparedPage, measured: Map<RecognizedLine, LineInk | null>, size: { width: number; height: number }, provider: string, layoutAware: boolean): OcrDocument {
    const { bodyStroke } = bodyMeasures(groups, measured);
    const context = { bodyStroke, pageWidth: page.width, editorWidth: EDITOR_PAGE_WIDTH, scale: page.scale };
    let lineCount = 0;
    let wordCount = 0;
    let lowConfidenceWords = 0;
    let confidenceSum = 0;

    const blocks: DocBlock[] = groups.map((group, index) => {
        const id = `b${index + 1}`;
        const style = blockStyle(group, group.lines.map((line) => measured.get(line) ?? null), context);
        const lines: DocLine[] = group.lines.map((line, lineIndex) => {
            lineCount++;
            confidenceSum += line.confidence;
            const words = line.words.map((word) => {
                wordCount++;
                if (word.confidence < LOW_CONFIDENCE) lowConfidenceWords++;
                return { text: word.text, bbox: round(scaleBox(word.box, page.scale)), confidence: Math.round(word.confidence * 1000) / 1000 };
            });
            const own = group.table ? undefined : lineStyle(measured.get(line) ?? null, style, bodyStroke);
            return { id: `${id}-l${lineIndex + 1}`, text: line.text.trim(), bbox: round(scaleBox(line.box, page.scale)), confidence: Math.round(line.confidence * 1000) / 1000, words, ...(own ? { style: own } : {}) };
        });
        const bbox = round(scaleBox(group.box, page.scale));
        const text = group.table
            ? group.table.rows.map((row) => row.join("\t")).join("\n")
            : group.list
              ? group.list.items.map((item) => `${item.marker} ${item.lines.map((line) => line.text.trim()).join("\n")}`).join("\n")
              : lines.map((line) => line.text).join("\n");
        return {
            id,
            type: group.kind,
            text,
            bbox,
            editorBox: { x: bbox.x / size.width, y: bbox.y / size.height, width: bbox.width / size.width, height: bbox.height / size.height },
            confidence: Math.round((group.lines.reduce((sum, line) => sum + line.confidence, 0) / Math.max(1, group.lines.length)) * 1000) / 1000,
            language: languageOf(text),
            lines,
            ...(group.list ? { list: { ordered: group.list.ordered, items: group.list.items.map((item) => ({ marker: item.marker, text: item.lines.map((line) => line.text.trim()).join("\n") })) } } : {}),
            ...(group.table ? { table: group.table } : {}),
            style,
        };
    });

    const backgrounds = blocks.map((block) => block.style.backgroundColor);
    const background = backgrounds.sort((a, b) => backgrounds.filter((c) => c === b).length - backgrounds.filter((c) => c === a).length)[0] ?? "#FFFFFF";
    return {
        document: { width: size.width, height: size.height, background, pageWidth: EDITOR_PAGE_WIDTH, region: page.region, rotation: 0 },
        language: recognition.language,
        blocks,
        stats: { blocks: blocks.length, lines: lineCount, words: wordCount, averageConfidence: lineCount ? Math.round((confidenceSum / lineCount) * 1000) / 1000 : 0, lowConfidenceWords },
        engine: { provider, layout: layoutAware && recognition.regions.length ? "model" : "geometry" },
    };
}
