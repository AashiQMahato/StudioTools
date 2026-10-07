import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { AppError } from "../../utils/AppError.js";
import { fetchBuffered } from "../../utils/fetchBuffered.js";
import { safeDocumentName } from "../../utils/http.js";
import { imageService } from "../image-service/imageServiceProcess.js";
import type { JobContext } from "../jobs/jobService.js";
import { type LineInk, measureLine } from "../ocr/formattingService.js";
import { analyzeLayout } from "../ocr/layoutService.js";
import { ocr } from "../ocr/ocrService.js";
import { preparePage } from "../ocr/preprocessingService.js";
import { getOcrProvider } from "../ocr/providers/index.js";
import { EDITOR_PAGE_WIDTH, reconstruct } from "../ocr/reconstructionService.js";
import type { Box, DocBlock, LayoutRegion, OcrDocument, OcrLanguage, Recognition, RecognizedLine } from "../ocr/types.js";
import { loadPdf } from "./pdfDocument.js";
import { renderingUnavailable, renderPage } from "./renderService.js";

/** A run of text as the PDF stores it (points, top-left origin, as the page is shown). */
interface Segment {
    text: string;
    box: [number, number, number, number];
    size: number;
    bold: boolean;
    italic: boolean;
    font: string;
    colour: string | null;
}

export interface Figure {
    /** Where on the page (fractions), for placing it among the text. */
    editorBox: Box;
    width: number;
    height: number;
    /** JPEG, base64. */
    data: string;
}

export interface WordPage {
    page: number;
    method: "text" | "ocr" | "none";
    document: OcrDocument | null;
    figures: Figure[];
}

const DPI = 150;
const MIN_TEXT = 20;
const FIGURE_LABELS = new Set(["image", "figure", "chart", "seal", "header_image", "footer_image"]);
/** Pictures are included up to this much in all (base64 in the result file). */
const FIGURE_BUDGET = 8 * 1024 * 1024;
const DEVANAGARI = /[ऀ-ॿ]/;

async function segments(path: string, page: number, signal: AbortSignal): Promise<{ width: number; height: number; segments: Segment[] }> {
    const connection = imageService.connection;
    if (!connection) throw renderingUnavailable();
    const form = new FormData();
    form.append("path", path);
    form.append("page", String(page - 1));
    const response = await fetchBuffered(`${connection.url}/pdf/segments`, { method: "POST", body: form, headers: { "x-internal-token": connection.token }, signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) }).catch(() => {
        if (signal.aborted) throw new AppError("The request was cancelled.", 499, "REQUEST_CANCELLED");
        throw renderingUnavailable();
    });
    if (!response.ok) throw new AppError("We couldn't read this PDF. It may be damaged.", 422, "INVALID_PDF");
    return (await response.json()) as { width: number; height: number; segments: Segment[] };
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const inside = (box: Box, x: number, y: number) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;

/** The editor's font for a PDF font: serif, monospace or sans, with a Devanagari partner. */
function family(fonts: string[], devanagari: boolean): string {
    const name = fonts.join(" ").toLowerCase();
    if (devanagari) return /serif|mangal|kalimati|preeti/.test(name) && /serif/.test(name) ? "Noto Serif Devanagari" : "Noto Sans Devanagari";
    if (/courier|mono|consol|menlo/.test(name)) return "Monospace";
    if (/times|serif|georgia|garamond|cambria|book|minion|roman/.test(name) && !/sans/.test(name)) return /georgia/.test(name) ? "Georgia" : "Noto Serif";
    if (/arial|helvetica/.test(name)) return "Arial";
    return "Inter";
}

/**
 * A digital page: its own text (exact) laid out by the same pipeline as OCR — the layout model's
 * regions when available, lines into paragraphs, lists and tables — then given the PDF's own
 * formatting: real sizes, bold, italics, colours and font style.
 */
async function fromTextLayer(page: { width: number; height: number; segments: Segment[] }, png: Buffer, signal: AbortSignal): Promise<{ document: OcrDocument; regions: LayoutRegion[]; scale: number }> {
    const { width, height } = await sharp(png).metadata();
    const prepared = await preparePage(png, { width: width!, height: height! }, null);
    // Working pixels per point.
    const scale = prepared.scale * (width! / page.width);
    const lines: RecognizedLine[] = page.segments.map((segment) => {
        const [x, y, w, h] = segment.box;
        const box = { x: x * scale, y: y * scale, width: Math.max(1, w * scale), height: Math.max(1, h * scale) };
        const words = segment.text.split(/(\s+)/);
        let offset = 0;
        const total = segment.text.length || 1;
        const recognized: RecognizedLine = {
            text: segment.text,
            confidence: 1,
            box,
            textHeight: Math.max(1, segment.size * scale),
            words: words
                .map((word) => {
                    const start = offset;
                    offset += word.length;
                    return word.trim() ? { text: word, box: { x: box.x + (box.width * start) / total, y: box.y, width: (box.width * word.length) / total, height: box.height }, confidence: 1, approximate: true } : null;
                })
                .filter((word): word is NonNullable<typeof word> => word !== null),
        };
        return recognized;
    });

    let regions: LayoutRegion[] = [];
    try {
        const provider = await getOcrProvider();
        regions = provider.detectLayout ? await provider.detectLayout(prepared.ocr, signal) : [];
    } catch (error) {
        if (signal.aborted) throw error;
        // No layout model on this server: the page is laid out from positions alone.
    }
    const allText = page.segments.map((segment) => segment.text).join(" ");
    const recognition: Recognition = { width: prepared.width, height: prepared.height, language: DEVANAGARI.test(allText) ? (/[a-z]/i.test(allText) ? "mixed" : "ne") : "en", lines, regions };
    const groups = analyzeLayout(recognition);
    const measured = new Map<RecognizedLine, LineInk | null>();
    for (const group of groups) for (const line of group.lines) measured.set(line, measureLine(prepared.colour, line.box));
    const document = reconstruct(recognition, groups, prepared, measured, { width: width!, height: height! }, "pdf-text", regions.length > 0);

    // The PDF says exactly how its text is set: that replaces the estimates from pixels.
    const toEditor = EDITOR_PAGE_WIDTH / page.width;
    const segmentsIn = (box: Box) =>
        page.segments.filter((segment) => {
            const [x, y, w, h] = segment.box;
            // Block boxes are in rendered pixels; segments in points.
            const px = width! / page.width;
            return inside(box, (x + w / 2) * px, (y + h / 2) * px);
        });
    for (const block of document.blocks) {
        const own = segmentsIn(block.bbox);
        if (!own.length) continue;
        const weight = (pick: (segment: Segment) => boolean) => own.filter(pick).reduce((sum, segment) => sum + segment.text.length, 0) / Math.max(1, own.reduce((sum, segment) => sum + segment.text.length, 0));
        const colours = own.map((segment) => segment.colour).filter((colour): colour is string => Boolean(colour));
        const colour = colours.length ? median(colours.map((value) => Number.parseInt(value.slice(1), 16))) : null;
        block.style = {
            ...block.style,
            fontSize: Math.round(median(own.map((segment) => segment.size)) * toEditor * 2) / 2,
            fontWeight: weight((segment) => segment.bold) > 0.5 ? 700 : 400,
            fontStyle: weight((segment) => segment.italic) > 0.5 ? "italic" : "normal",
            ...(colour !== null ? { color: `#${colour.toString(16).padStart(6, "0").toUpperCase()}` } : {}),
            fontFamily: family(own.map((segment) => segment.font), DEVANAGARI.test(block.text)),
            inferred: { ...block.style.inferred, fontSize: 0.95, fontWeight: 0.95, fontStyle: 0.95, color: 0.95, fontFamily: 0.6 },
        };
        // Lines that differ from their block (a bold label in a plain paragraph) keep their own look,
        // and lines mixing styles ("Note: …" in bold red, then plain) keep each run's.
        for (const line of block.lines) {
            const mine = segmentsIn(line.bbox).sort((a, b) => a.box[0] - b.box[0]);
            if (!mine.length) continue;
            const styles = new Set(mine.map((segment) => `${segment.bold}|${segment.italic}|${segment.colour}`));
            if (styles.size > 1) line.spans = mine.map((segment, index) => ({ text: (index ? " " : "") + segment.text, bold: segment.bold, italic: segment.italic, color: segment.colour?.toUpperCase() ?? null }));
            const bold = mine.some((segment) => segment.bold) && mine.every((segment) => segment.bold);
            const lineColour = mine[0]!.colour?.toUpperCase();
            const style: NonNullable<typeof line.style> = {};
            if (bold !== (block.style.fontWeight >= 600)) style.fontWeight = bold ? 700 : 400;
            if (lineColour && lineColour !== block.style.color.toUpperCase()) style.color = lineColour;
            line.style = Object.keys(style).length ? style : undefined;
        }
    }
    return { document, regions, scale: prepared.scale };
}

const words = (text: string) => text.normalize("NFC").split(/[\s।॥.,;:!?()"'-]+/u).filter((word) => /\p{L}/u.test(word));
function agreement(a: string, b: string) {
    const left = words(a);
    const right = new Map<string, number>();
    for (const word of words(b)) right.set(word, (right.get(word) ?? 0) + 1);
    const total = left.length + [...right.values()].reduce((sum, count) => sum + count, 0);
    let shared = 0;
    for (const word of left) {
        const count = right.get(word) ?? 0;
        if (!count) continue;
        shared++;
        right.set(word, count - 1);
    }
    return total ? (2 * shared) / total : 1;
}
const blocksText = (blocks: DocBlock[]) => blocks.map((block) => block.text).join("\n");

/**
 * PDF → an editable, structured document per page (for Word, or the editors). Digital pages keep
 * their exact text and formatting; scans are read by OCR; Nepali text layers are checked against OCR
 * and replaced when they don't match the page. Pictures are cropped from the page and kept in place.
 */
export async function pdfToWord(input: { path: string; name: string }, options: { language: OcrLanguage }, context: JobContext) {
    context.progress("reading");
    const count = (await loadPdf(input.path)).getPageCount();
    const pages: WordPage[] = [];
    let figureBytes = 0;
    let ocrAvailable = true;
    for (let number = 1; number <= count; number++) {
        if (context.signal.aborted) return;
        context.progress("converting", number - 1, count);
        const layer = await segments(input.path, number, context.signal);
        const png = await renderPage(input.path, number, DPI, context.signal);
        const letters = layer.segments.reduce((sum, segment) => sum + (segment.text.match(/[\p{L}\p{N}]/gu) ?? []).length, 0);
        let result: WordPage = { page: number, method: "none", document: null, figures: [] };
        let regions: LayoutRegion[] = [];
        let scale = 1;

        const readByOcr = async () => {
            if (!ocrAvailable) return null;
            try {
                return await ocr.extract({ upload: png, language: options.language, region: null, preserveLayout: true }, () => undefined, { signal: context.signal });
            } catch (error) {
                if (context.signal.aborted) throw error;
                if (error instanceof AppError && error.code === "OCR_UNAVAILABLE") ocrAvailable = false;
                else if (!(error instanceof AppError && error.code === "NO_TEXT")) throw error;
                return null;
            }
        };

        if (letters >= MIN_TEXT) {
            const fromText = await fromTextLayer(layer, png, context.signal);
            regions = fromText.regions;
            scale = fromText.scale;
            result = { page: number, method: "text", document: fromText.document, figures: [] };
            // Nepali text layers are often broken (legacy fonts, shaping): OCR checks them.
            if (DEVANAGARI.test(blocksText(fromText.document.blocks))) {
                const read = await readByOcr();
                if (read && agreement(blocksText(fromText.document.blocks), blocksText(read.blocks)) < 0.5) result = { page: number, method: "ocr", document: read, figures: [] };
            }
        } else {
            const read = await readByOcr();
            if (read) result = { page: number, method: "ocr", document: read, figures: [] };
        }

        // Pictures, from the layout model's regions, cropped from the rendered page.
        if (regions.length) {
            const { width, height } = await sharp(png).metadata();
            for (const region of regions.filter((candidate) => FIGURE_LABELS.has(candidate.label) && candidate.score >= 0.5).slice(0, 12)) {
                const box = { x: Math.max(0, Math.floor(region.box.x / scale)), y: Math.max(0, Math.floor(region.box.y / scale)), width: Math.ceil(region.box.width / scale), height: Math.ceil(region.box.height / scale) };
                box.width = Math.min(box.width, width! - box.x);
                box.height = Math.min(box.height, height! - box.y);
                if (box.width < 24 || box.height < 24) continue;
                const jpeg = await sharp(png).extract({ left: box.x, top: box.y, width: box.width, height: box.height }).jpeg({ quality: 85 }).toBuffer();
                if (figureBytes + jpeg.length > FIGURE_BUDGET) break;
                figureBytes += jpeg.length;
                result.figures.push({ editorBox: { x: box.x / width!, y: box.y / height!, width: box.width / width!, height: box.height / height! }, width: box.width, height: box.height, data: jpeg.toString("base64") });
            }
        }
        pages.push(result);
    }
    context.progress("saving", count, count);
    const json = context.workspace.file("json");
    await writeFile(json, JSON.stringify({ pages }), "utf8");
    await context.addFile({ name: `${safeDocumentName(input.name)}-document.json`, mimeType: "application/json", path: json });
    context.summary({ pages: count, textPages: pages.filter((page) => page.method === "text").length, ocrPages: pages.filter((page) => page.method === "ocr").length, figures: pages.reduce((sum, page) => sum + page.figures.length, 0), ocrUnavailable: ocrAvailable ? 0 : 1 });
}
