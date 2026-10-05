import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { BlockStyle, DocBlock, DocLine, DocWord, OcrDocument } from "@/lib/api/ocrApi";
import type { BlockLayout } from "./extensions";

export type EditorMode = "document" | "layout";

const luminance = (hex: string) => {
    const value = Number.parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
    return (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255;
};

/** The paper colour and the ink for new text. A light page reads as clean white in Document mode. */
export function pageColours(result: OcrDocument, mode: EditorMode) {
    const background = result.document.background || "#ffffff";
    const dark = luminance(background) < 0.45;
    return { background: mode === "document" && !dark ? "#ffffff" : background, ink: dark ? "#f5f5f5" : "#1a1a1a" };
}

/** Below this, a word is shown as uncertain (the server uses the same line). */
const LOW_CONFIDENCE = 0.8;

/**
 * Fonts on offer. Each is a stack with a Devanagari partner, so Nepali in a Latin font (and Latin in a
 * Devanagari one) still renders with a matching design rather than whatever the system picks.
 */
export const FONTS = [
    { label: "Inter", stack: 'Inter, "Noto Sans Devanagari", sans-serif' },
    { label: "Noto Sans Devanagari", stack: '"Noto Sans Devanagari", Inter, sans-serif' },
    { label: "Noto Serif", stack: '"Noto Serif", "Noto Serif Devanagari", serif' },
    { label: "Noto Serif Devanagari", stack: '"Noto Serif Devanagari", "Noto Serif", serif' },
    { label: "Arial", stack: 'Arial, "Noto Sans Devanagari", sans-serif' },
    { label: "Times New Roman", stack: '"Times New Roman", "Noto Serif Devanagari", serif' },
    { label: "Georgia", stack: 'Georgia, "Noto Serif Devanagari", serif' },
    { label: "Monospace", stack: 'ui-monospace, Menlo, Consolas, "Noto Sans Devanagari", monospace' },
] as const;

/** The first family of a stack, unquoted — the font's name (e.g. for Word). */
export const primaryFamily = (stack: string | null | undefined) => (stack ?? "").split(",")[0]!.trim().replace(/^["']|["']$/g, "") || "Inter";

const stackFor = (family: string) => FONTS.find((font) => font.label === family)?.stack ?? FONTS[0].stack;

// ------------------------------------------------------------------ size fitting

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

/**
 * Refines each block's estimated size so its lines, set in the font the editor uses, span the width
 * they span in the image. The height-based estimate can't know the original font's proportions; this
 * uses them, within ±25% of that estimate. Still an estimate — the original font is unknown.
 */
export async function fitFontSizes(result: OcrDocument): Promise<OcrDocument> {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return result;
    const toPage = result.document.pageWidth / result.document.width;
    const fontFor = (style: BlockStyle, weight: number, size: number) => `${style.fontStyle} ${weight} ${size}px ${stackFor(style.fontFamily)}`;
    const faces = new Map<string, string>();
    for (const block of result.blocks) {
        for (const line of block.lines) {
            const font = fontFor(block.style, line.style?.fontWeight ?? block.style.fontWeight, 32);
            faces.set(font, (faces.get(font) ?? "") + line.text);
        }
    }
    await Promise.all([...faces].map(([font, sample]) => document.fonts.load(font, sample.slice(0, 200)).catch(() => [])));

    return {
        ...result,
        blocks: result.blocks.map((block) => {
            if (block.type === "table") return block;
            const { style } = block;
            const ratios = block.lines
                .filter((line) => line.text.trim().length >= 3 && line.bbox.width > 0)
                .map((line) => {
                    context.font = fontFor(style, line.style?.fontWeight ?? style.fontWeight, style.fontSize);
                    const measured = context.measureText(line.text.trim()).width;
                    // Detected boxes run a little past the ink at each end.
                    const inked = Math.max(1, line.bbox.width - line.bbox.height * 0.25);
                    return measured > 0 ? (inked * toPage) / measured : 0;
                })
                .filter((ratio) => ratio > 0);
            if (!ratios.length) return block;
            const ratio = Math.min(1.25, Math.max(0.8, median(ratios)));
            return { ...block, style: { ...style, fontSize: Math.round(style.fontSize * ratio * 2) / 2 } };
        }),
    };
}

// ------------------------------------------------------------------ OCR document → editor content

type MarkJSON = { type: string; attrs?: Record<string, unknown> };

function baseMarks(style: BlockStyle): MarkJSON[] {
    const marks: MarkJSON[] = [{ type: "textStyle", attrs: { fontFamily: stackFor(style.fontFamily), fontSize: `${style.fontSize}px`, color: style.color } }];
    if (style.fontWeight >= 600) marks.push({ type: "bold" });
    if (style.fontStyle === "italic") marks.push({ type: "italic" });
    return marks;
}

/** A line of text as runs, with the words the engine was unsure of marked (never changed). */
function runs(text: string, words: readonly DocWord[], marks: MarkJSON[]): JSONContent[] {
    const nodes: JSONContent[] = [];
    let position = 0;
    const push = (value: string, extra?: MarkJSON) => value && nodes.push({ type: "text", text: value, marks: extra ? [...marks, extra] : marks });
    for (const word of words) {
        if (word.confidence >= LOW_CONFIDENCE || !word.text.trim()) continue;
        const at = text.indexOf(word.text, position);
        if (at < 0) continue;
        push(text.slice(position, at));
        push(word.text, { type: "lowConfidence", attrs: { confidence: Math.round(word.confidence * 100) / 100 } });
        position = at + word.text.length;
    }
    push(text.slice(position));
    return nodes;
}

interface LineSource {
    text: string;
    words: readonly DocWord[];
    style?: DocLine["style"];
    spans?: DocLine["spans"];
}

/** A line whose runs differ in style (a bold label, a red word), each run in its own. */
function spanRuns(spans: NonNullable<DocLine["spans"]>, style: BlockStyle): JSONContent[] {
    return spans
        .filter((span) => span.text)
        .map((span) => ({ type: "text", text: span.text, marks: baseMarks({ ...style, fontWeight: span.bold ? 700 : 400, fontStyle: span.italic ? "italic" : "normal", color: span.color ?? style.color }) }));
}

/** Lines joined by line breaks, as in the image; a line that looks different from its block keeps its own colour and weight. */
function lineContent(lines: readonly LineSource[], style: BlockStyle): JSONContent[] {
    return lines.flatMap((line, index) => [
        ...(index ? [{ type: "hardBreak" }] : []),
        ...(line.spans?.length && line.spans.map((span) => span.text).join("") === line.text ? spanRuns(line.spans, style) : runs(line.text, line.words, baseMarks(line.style ? { ...style, ...line.style } : style))),
    ]);
}

const BULLETS: Record<string, string> = { "•": "disc", "●": "disc", "·": "disc", "○": "circle", "◦": "circle", "▪": "square", "■": "square" };

function listStyle(marker: string, ordered: boolean): string | null {
    if (!ordered) return BULLETS[marker] ?? `"${marker.replace(/["\\]/g, "")} "`;
    const body = marker.replace(/[.)]$/, "");
    if (/^[०-९]+$/.test(body)) return "devanagari";
    if (/^\d+$/.test(body)) return null;
    if (/^[ivxlc]+$/.test(body) && body !== "c") return "lower-roman";
    if (/^[IVXLC]+$/.test(body) && body !== "C") return "upper-roman";
    return /^[a-z]$/.test(body) ? "lower-alpha" : /^[A-Z]$/.test(body) ? "upper-alpha" : null;
}

function listStart(marker: string): number {
    const body = marker.replace(/[.)]$/, "");
    const digits = body.replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x966));
    if (/^\d+$/.test(digits)) return Number(digits);
    if (/^[a-z]$/i.test(body)) return body.toLowerCase().charCodeAt(0) - 96;
    return 1;
}

/**
 * A list item's lines are the block's lines in order (the first of each item without its marker),
 * so each gets the uncertain words of its own line.
 */
function listItems(block: DocBlock): JSONContent[] {
    let lineIndex = 0;
    return block.list!.items.map((item) => {
        const lines = item.text.split("\n").map((text) => {
            const source = block.lines[lineIndex++];
            return { text, words: source?.words ?? [], style: source?.style, spans: source?.spans?.map((span) => span.text).join("") === text ? source.spans : undefined };
        });
        return { type: "listItem", content: [{ type: "paragraph", content: lineContent(lines, block.style) }] };
    });
}

function tableRows(block: DocBlock, marks: MarkJSON[], pageWidth: number, pageAspect: number): JSONContent[] {
    const uncertain = block.lines.flatMap((line: DocLine) => line.words).filter((word) => word.confidence < LOW_CONFIDENCE);
    const width = Math.max(...block.table!.rows.map((row) => row.length));
    // Columns as wide, relative to each other, as in the image.
    const shares = block.table!.columns?.length === width ? block.table!.columns : null;
    const tableWidth = block.editorBox.width * pageWidth;
    const heights = block.table!.rowHeights?.length === block.table!.rows.length ? block.table!.rowHeights : null;
    const tableHeight = block.editorBox.height * pageWidth * pageAspect;
    return block.table!.rows.map((row, rowIndex) => ({
        type: "tableRow",
        attrs: { rowHeight: heights ? Math.round(heights[rowIndex]! * tableHeight) : null },
        content: Array.from({ length: width }, (_, index) => {
            const text = row[index] ?? "";
            const words = uncertain.filter((word) => text.includes(word.text));
            const colwidth = shares ? [Math.max(24, Math.round(shares[index]! * tableWidth))] : null;
            return { type: "tableCell", attrs: { colwidth }, content: [{ type: "paragraph", content: runs(text, words, marks) }] };
        }),
    }));
}

const rgbOf = (hex: string) => [1, 3, 5].map((start) => Number.parseInt(hex.replace("#", "").padEnd(6, "0").slice(start - 1, start + 1), 16) || 0);
/** How different two colours look — paper under uneven light varies a little and isn't a coloured box. */
function colourDistance(a: string, b: string) {
    const [r1, g1, b1] = rgbOf(a);
    const [r2, g2, b2] = rgbOf(b);
    return Math.hypot(r1! - r2!, g1! - g2!, b1! - b2!);
}

function blockNode(block: DocBlock, background: string, pageWidth: number, pageAspect: number): JSONContent {
    const { style } = block;
    const marks = baseMarks(style);
    const layout: BlockLayout = { id: block.id, x: block.editorBox.x, y: block.editorBox.y, w: block.editorBox.width, h: block.editorBox.height };
    const shared = {
        layout,
        lang: block.language === "en" ? "en" : "ne",
        // Its own background only where it differs from the page (a coloured banner, a highlighted note).
        background: colourDistance(style.backgroundColor, background) > 60 ? style.backgroundColor : null,
    };
    const text = { ...shared, textAlign: style.textAlign, lineHeight: style.lineHeight };
    const lines: LineSource[] = block.lines;

    switch (block.type) {
        case "title":
        case "heading":
            return { type: "heading", attrs: { ...text, level: block.type === "title" ? 1 : 2 }, content: lineContent(lines, style) };
        case "list": {
            const ordered = block.list!.ordered;
            const first = block.list!.items[0]?.marker ?? "";
            return {
                type: ordered ? "orderedList" : "bulletList",
                attrs: { ...shared, listStyle: listStyle(first, ordered), ...(ordered ? { start: listStart(first) } : {}) },
                content: listItems(block),
            };
        }
        case "table":
            return { type: "table", attrs: shared, content: tableRows(block, marks, pageWidth, pageAspect) };
        default:
            return { type: "paragraph", attrs: text, content: lineContent(lines, style) };
    }
}

/** The recognised document as editor content: one node per block, formatting as estimated. */
export function toEditorContent(result: OcrDocument): JSONContent {
    const content = result.blocks.map((block) => blockNode(block, result.document.background, result.document.pageWidth, result.document.height / result.document.width));
    return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

// ------------------------------------------------------------------ editor content → plain text

const DEVANAGARI_DIGITS = "०१२३४५६७८९";
const roman = (value: number) => {
    const numerals: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
    let rest = value;
    let out = "";
    for (const [amount, letters] of numerals) {
        while (rest >= amount) {
            out += letters;
            rest -= amount;
        }
    }
    return out;
};

/** The marker a list shows for its nth item, so copied and exported text keeps its numbering. */
export function listMarker(list: PMNode, index: number): string {
    const style = (list.attrs.listStyle as string | null) ?? (list.type.name === "orderedList" ? "decimal" : "disc");
    if (list.type.name === "bulletList") {
        if (style.startsWith('"')) return style.slice(1, -1).trim();
        return style === "circle" ? "◦" : style === "square" ? "▪" : "•";
    }
    const value = ((list.attrs.start as number) ?? 1) + index;
    switch (style) {
        case "devanagari":
            return `${String(value).replace(/\d/g, (digit) => DEVANAGARI_DIGITS[Number(digit)]!)}.`;
        case "lower-alpha":
            return `${String.fromCharCode(96 + (((value - 1) % 26) + 1))}.`;
        case "upper-alpha":
            return `${String.fromCharCode(64 + (((value - 1) % 26) + 1))}.`;
        case "lower-roman":
            return `${roman(value)}.`;
        case "upper-roman":
            return `${roman(value).toUpperCase()}.`;
        default:
            return `${value}.`;
    }
}

/** A paragraph's text, line breaks included. */
function inlineText(node: PMNode): string {
    let text = "";
    node.forEach((child) => {
        text += child.isText ? child.text! : child.type.name === "hardBreak" ? "\n" : "";
    });
    return text;
}

function listText(list: PMNode, depth: number): string[] {
    const lines: string[] = [];
    list.forEach((item, _offset, index) => {
        const indent = "    ".repeat(depth);
        let first = true;
        item.forEach((child) => {
            if (child.type.name === "bulletList" || child.type.name === "orderedList") return void lines.push(...listText(child, depth + 1));
            const text = inlineText(child).replace(/\n/g, `\n${indent}   `);
            lines.push(first ? `${indent}${listMarker(list, index)} ${text}` : `${indent}   ${text}`);
            first = false;
        });
    });
    return lines;
}

/** Plain text of the whole document: blocks separated by a blank line, list markers kept, table cells tab-separated. */
export function plainText(doc: PMNode): string {
    const blocks: string[] = [];
    doc.forEach((block) => {
        const name = block.type.name;
        if (name === "bulletList" || name === "orderedList") blocks.push(listText(block, 0).join("\n"));
        else if (name === "table") {
            const rows: string[] = [];
            block.forEach((row) => {
                const cells: string[] = [];
                row.forEach((cell) => cells.push(cell.textBetween(0, cell.content.size, " ", " ").trim()));
                rows.push(cells.join("\t"));
            });
            blocks.push(rows.join("\n"));
        } else blocks.push(inlineText(block));
    });
    return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
