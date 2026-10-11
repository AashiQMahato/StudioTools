import type { TranslatorBlock } from "./blocks";

/** Width of `text` set in `font` (a canvas font string), in pixels. */
export type Measure = (text: string, font: string) => number;

const segmenters = new Map<string, Intl.Segmenter>();
function segmenter(locale: string, granularity: "word" | "grapheme") {
    const key = `${locale}|${granularity}`;
    let found = segmenters.get(key);
    if (!found) segmenters.set(key, (found = new Intl.Segmenter(locale, { granularity })));
    return found;
}

/**
 * Greedy line breaking at word boundaries for the language (so Chinese, Japanese and Thai break between
 * words too); a word too long for the line is broken between characters. Explicit newlines are kept.
 */
export function wrap(text: string, maxWidth: number, width: (text: string) => number, locale = "en"): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/).map((part) => part.trim())) {
        let line = "";
        for (const { segment } of segmenter(locale, "word").segment(paragraph)) {
            const next = line + segment;
            if (width(next.trimEnd()) <= maxWidth) {
                line = next;
                continue;
            }
            if (line.trim() !== "") lines.push(line.trimEnd());
            line = "";
            const word = segment.trimStart();
            if (width(word) <= maxWidth) {
                line = word;
                continue;
            }
            // A single word wider than the line: break it between characters (grapheme clusters, so Devanagari stays whole).
            for (const { segment: char } of segmenter(locale, "grapheme").segment(word)) {
                if (line && width(line + char) > maxWidth) {
                    lines.push(line);
                    line = "";
                }
                line += char;
            }
        }
        lines.push(line.trimEnd());
    }
    // A trailing empty paragraph adds nothing visible.
    while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    return lines;
}

export interface Fit {
    size: number;
    lines: string[];
    lineHeight: number;
}

/**
 * The largest size from `maxSize` down to `minSize` at which the text, wrapped, fits the box.
 * null = it doesn't fit legibly (the caller reports it rather than drawing it unreadably small).
 */
export function fitText(text: string, box: { width: number; height: number }, options: { maxSize: number; minSize: number; lineHeight: number; locale?: string; font: (size: number) => string; measure: Measure }): Fit | null {
    const { minSize, lineHeight, locale, font, measure } = options;
    const maxSize = Math.min(options.maxSize, box.height / lineHeight);
    for (let size = Math.floor(maxSize * 2) / 2; size >= minSize; size -= Math.max(0.5, size * 0.06)) {
        const css = font(size);
        const width = (line: string) => measure(line, css);
        const lines = wrap(text, box.width, width, locale);
        if (lines.length * size * lineHeight <= box.height + 0.5 && lines.every((line) => width(line) <= box.width + 0.5)) return { size, lines, lineHeight: size * lineHeight };
    }
    return null;
}

export interface OverlayDraw {
    id: string;
    /** The patch painted over the original text (the box, padded, inside the image). */
    patch: { x: number; y: number; width: number; height: number };
    background: string;
    color: string;
    font: string;
    lines: string[];
    lineHeight: number;
    align: "left" | "center" | "right";
    /** Where the text box starts. */
    x: number;
    y: number;
    width: number;
}

export interface OverlayPlan {
    draws: OverlayDraw[];
    /** Blocks with a translation that couldn't be set legibly in their box (left as they were). */
    skipped: number;
}

/**
 * Where each translated block goes on the image. Sizes are in image pixels; `fontScale` turns the OCR's
 * editor-pixel font sizes into image pixels (image width ÷ editor page width).
 */
export function planOverlay(
    blocks: readonly TranslatorBlock[],
    image: { width: number; height: number; fontScale: number },
    options: { fontFamily: string; locale: string; measure: Measure; rtl?: boolean },
): OverlayPlan {
    const draws: OverlayDraw[] = [];
    let skipped = 0;
    // Too small to read on the exported image, whatever the original was.
    const legible = Math.max(8, Math.min(image.width, image.height) / 160);
    for (const block of blocks) {
        const text = block.translated?.trim();
        if (!text) continue;
        const { bbox, style } = block;
        const original = Math.max(1, style.fontSize * image.fontScale);
        const weight = style.fontWeight ?? 400;
        const fit = fitText(text, bbox, {
            maxSize: original * 1.1,
            minSize: Math.max(legible, original * 0.4),
            lineHeight: 1.25,
            locale: options.locale,
            font: (size) => `${weight} ${size}px ${options.fontFamily}`,
            measure: options.measure,
        });
        if (!fit) {
            skipped++;
            continue;
        }
        const pad = Math.max(2, original * 0.15);
        const x0 = Math.max(0, bbox.x - pad);
        const y0 = Math.max(0, bbox.y - pad);
        const patch = { x: x0, y: y0, width: Math.min(image.width, bbox.x + bbox.width + pad) - x0, height: Math.min(image.height, bbox.y + bbox.height + pad) - y0 };
        const textHeight = fit.lines.length * fit.lineHeight;
        const align = style.textAlign === "center" || style.textAlign === "right" ? style.textAlign : options.rtl ? "right" : "left";
        draws.push({
            id: block.id,
            patch,
            background: style.backgroundColor,
            color: style.color,
            font: `${weight} ${fit.size}px ${options.fontFamily}`,
            lines: fit.lines,
            lineHeight: fit.lineHeight,
            align,
            x: bbox.x,
            // Centred vertically in the box, as text usually sits.
            y: bbox.y + (bbox.height - textHeight) / 2,
            width: bbox.width,
        });
    }
    return { draws, skipped };
}
