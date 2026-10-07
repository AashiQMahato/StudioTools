import { writeFile } from "node:fs/promises";
import { AppError } from "../../utils/AppError.js";
import { fetchBuffered } from "../../utils/fetchBuffered.js";
import { safeDocumentName } from "../../utils/http.js";
import { imageService } from "../image-service/imageServiceProcess.js";
import type { JobContext } from "../jobs/jobService.js";
import { ocr } from "../ocr/ocrService.js";
import type { OcrDocument, OcrLanguage } from "../ocr/types.js";
import { loadPdf } from "./pdfDocument.js";
import { renderingUnavailable, renderPage } from "./renderService.js";

export type TextMode = "auto" | "text" | "ocr";

type Method = "text" | "ocr" | "none";

export interface PageText {
    page: number;
    /** Where the chosen text came from: the PDF's own text, or read from the page image. */
    method: Method;
    text: string;
    /** The other reading, when there is one — the editor lets you switch to it. */
    alternative?: { method: Method; text: string };
    /** Why OCR was used for a page that has text of its own. */
    reason?: "scan" | "legacy-font" | "mismatch";
    /** Why a page has no text: nothing readable, or OCR isn't available on this server. */
    note?: "empty" | "unavailable";
    confidence?: number;
}

/** A page has usable text of its own if it has at least this many letters or digits. */
const MIN_TEXT = 20;
const OCR_DPI = 200;
const DEVANAGARI = /[\u0900-\u097F]/;
/** Legacy Nepali fonts: letters are stored as Latin codes, so their "text" is gibberish. */
const LEGACY_FONT = /preeti|kantipur|himali|sagarmatha|aakriti|ganess?h|kanchan|shangrila|pcs.?nepali|fontasy|navjeevan/i;

const words = (text: string) =>
    text
        .normalize("NFC")
        .split(/[\s।॥.,;:!?()"'\u2013\u2014-]+/u)
        .filter((word) => /\p{L}/u.test(word));

/** How much two readings agree, word for word (Dice coefficient, 0–1). */
function agreement(a: string, b: string) {
    const left = words(a);
    const right = new Map<string, number>();
    for (const word of words(b)) right.set(word, (right.get(word) ?? 0) + 1);
    const total = left.length + [...right.values()].reduce((sum, count) => sum + count, 0);
    if (!total) return 1;
    let shared = 0;
    for (const word of left) {
        const count = right.get(word) ?? 0;
        if (count) {
            shared++;
            right.set(word, count - 1);
        }
    }
    return (2 * shared) / total;
}

/** Devanagari words that begin with a vowel sign or virama: a sign cut off its letter, as broken text layers do. */
const detached = (text: string) => {
    const devanagari = words(text).filter((word) => DEVANAGARI.test(word));
    if (!devanagari.length) return 0;
    return devanagari.filter((word) => /^[\u0900-\u0903\u093A-\u094F\u0951-\u0957\u0962\u0963]/u.test(word)).length / devanagari.length;
};

/** A recognised page as plain text, keeping its structure: blocks apart, list markers, table cells tab-separated. */
function documentText(document: OcrDocument) {
    return document.blocks
        .map((block) => {
            if (block.list) return block.list.items.map((item) => `${item.marker} ${item.text}`).join("\n");
            if (block.table) return block.table.rows.map((row) => row.join("\t")).join("\n");
            return block.text;
        })
        .join("\n\n");
}

async function textLayer(path: string, signal: AbortSignal): Promise<{ text: string; images: number; fonts: string[] }[]> {
    const connection = imageService.connection;
    if (!connection) throw renderingUnavailable();
    const form = new FormData();
    form.append("path", path);
    let response: Response;
    try {
        response = await fetchBuffered(`${connection.url}/pdf/text`, { method: "POST", body: form, headers: { "x-internal-token": connection.token }, signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) });
    } catch {
        if (signal.aborted) throw new AppError("The request was cancelled.", 499, "REQUEST_CANCELLED");
        throw renderingUnavailable();
    }
    if (!response.ok) throw new AppError("We couldn't read this PDF. It may be damaged.", 422, "INVALID_PDF");
    return ((await response.json()) as { pages: { text: string; images: number; fonts: string[] }[] }).pages;
}

/**
 * Text out of a PDF. A page's own text (its text layer) is exact — when it can be trusted. Pages that
 * are pictures of text (scans) are read by OCR. Nepali text layers are often wrong (legacy fonts like
 * Preeti store Latin codes; shaped text can come out broken), so a page with Devanagari is also read by
 * OCR as a check, and when the two disagree the OCR reading is used. Both readings are kept, and the
 * editor lets you choose per page. Results: the text (.txt) and the pages (.json).
 */
export async function pdfToText(input: { path: string; name: string }, options: { mode: TextMode; language: OcrLanguage }, context: JobContext) {
    context.progress("reading");
    await loadPdf(input.path);
    const layer = await textLayer(input.path, context.signal);
    const letters = (text: string) => (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
    const pages: PageText[] = layer.map((page, index) => ({ page: index + 1, method: "text", text: page.text.trim() }));

    const plan = pages.map((page, index) => {
        const info = layer[index]!;
        if (options.mode === "text") return null;
        if (options.mode === "ocr") return "forced" as const;
        if (letters(page.text) < MIN_TEXT) return info.images > 0 || !page.text ? ("scan" as const) : null;
        if (info.fonts.some((font) => LEGACY_FONT.test(font))) return "legacy-font" as const;
        if (DEVANAGARI.test(page.text)) return "check" as const;
        return null;
    });
    const todo = pages.filter((_, index) => plan[index]);

    let ocrAvailable = true;
    for (const [index, page] of todo.entries()) {
        if (context.signal.aborted) return;
        context.progress("recognising", index, todo.length);
        const why = plan[page.page - 1]!;
        const own = page.text;
        if (!ocrAvailable) {
            if (why !== "check") Object.assign(page, { method: own ? "text" : "none", note: own ? undefined : "unavailable" });
            continue;
        }
        let read: { text: string; confidence: number } | null = null;
        try {
            const image = await renderPage(input.path, page.page, OCR_DPI, context.signal);
            const document = await ocr.extract({ upload: image, language: options.language, region: null, preserveLayout: true }, () => undefined, { signal: context.signal });
            read = { text: documentText(document), confidence: document.stats.averageConfidence };
        } catch (error) {
            if (context.signal.aborted) return;
            if (error instanceof AppError && error.code === "NO_TEXT") read = { text: "", confidence: 0 };
            else if (error instanceof AppError && error.code === "OCR_UNAVAILABLE") {
                ocrAvailable = false;
                if (!own) Object.assign(page, { method: "none", note: "unavailable" });
                continue;
            } else throw error;
        }
        const ocrReading = { method: "ocr" as const, text: read.text };
        const layerReading = own ? { method: "text" as const, text: own } : undefined;
        // The page's own text stands if OCR confirms it; otherwise the OCR reading is used.
        const trusted = why === "check" && read.text && agreement(own, read.text) >= 0.5 && detached(own) < 0.05;
        if (trusted) Object.assign(page, { method: "text", text: own, alternative: ocrReading });
        else Object.assign(page, { method: "ocr", text: read.text, confidence: read.confidence, alternative: layerReading, reason: why === "check" ? "mismatch" : why === "forced" ? undefined : why });
    }
    for (const page of pages) if (!page.text && !page.note) page.note = "empty";

    context.progress("saving");
    const base = safeDocumentName(input.name);
    const txt = context.workspace.file("txt");
    await writeFile(txt, pages.map((page) => page.text).join("\n\n"), "utf8");
    await context.addFile({ name: `${base}.txt`, mimeType: "text/plain; charset=utf-8", path: txt });
    const json = context.workspace.file("json");
    await writeFile(json, JSON.stringify({ pages }), "utf8");
    await context.addFile({ name: `${base}-pages.json`, mimeType: "application/json", path: json });
    context.summary({ pages: pages.length, textPages: pages.filter((page) => page.method === "text").length, ocrPages: pages.filter((page) => page.method === "ocr").length, unavailable: pages.filter((page) => page.note === "unavailable").length });
}
