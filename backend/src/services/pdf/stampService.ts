import { readFile } from "node:fs/promises";
import type { PDFFont } from "pdf-lib";
import sharp from "sharp";
import { AppError } from "../../utils/AppError.js";
import { safeDocumentName } from "../../utils/http.js";
import type { JobContext } from "../jobs/jobService.js";
import { loadPdf, savePdf } from "./pdfDocument.js";
import { pagesIn, parsePageRanges } from "./pageRanges.js";
import { imageStamp, placeCentred, type Stamp, textStamp, visualPage } from "./stamp.js";

export type Position = "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right";

export interface WatermarkOptions {
    kind: "text" | "image";
    text: string;
    fontSize: number;
    color: { r: number; g: number; b: number };
    opacity: number;
    rotation: number;
    position: Position | "tile";
    /** Image width as a share of the page width (0–1). */
    imageScale: number;
    /** Page ranges, or null for every page. */
    pages: string | null;
}

/** Distance from the page edge for edge and corner positions (points). */
const EDGE = 36;

/**
 * Where the stamp's centre goes on a page the reader sees as width × height: one of nine positions
 * (kept `EDGE` in from the edges, allowing for the turn), or a staggered tiling across the page.
 * The editor's preview uses the same arithmetic.
 */
function stampCentres(page: { width: number; height: number }, stamp: { width: number; height: number }, rotation: number, position: Position | "tile") {
    const radians = (rotation * Math.PI) / 180;
    const boxWidth = Math.abs(stamp.width * Math.cos(radians)) + Math.abs(stamp.height * Math.sin(radians));
    const boxHeight = Math.abs(stamp.width * Math.sin(radians)) + Math.abs(stamp.height * Math.cos(radians));
    if (position === "tile") {
        const stepX = boxWidth * 1.25 + 48;
        const stepY = boxHeight * 1.6 + 72;
        const centres: { x: number; y: number }[] = [];
        for (let row = 0, y = stepY / 2; y - boxHeight / 2 < page.height; row++, y += stepY) {
            for (let x = row % 2 ? 0 : stepX / 2; x - boxWidth / 2 < page.width; x += stepX) centres.push({ x, y });
        }
        return centres;
    }
    const column = position.endsWith("left") ? 0 : position.endsWith("right") ? 2 : 1;
    const row = position.startsWith("top") ? 0 : position.startsWith("bottom") ? 2 : 1;
    const x = [EDGE + boxWidth / 2, page.width / 2, page.width - EDGE - boxWidth / 2][column]!;
    const y = [EDGE + boxHeight / 2, page.height / 2, page.height - EDGE - boxHeight / 2][row]!;
    return [{ x, y }];
}

/** Your text or image over the chosen pages. */
export async function watermarkPdf(input: { path: string; name: string }, options: WatermarkOptions, image: { path: string } | null, context: JobContext) {
    context.progress("reading");
    const document = await loadPdf(input.path);
    const count = document.getPageCount();
    const targets = options.pages ? pagesIn(parsePageRanges(options.pages, count)) : Array.from({ length: count }, (_, index) => index + 1);
    const fonts = new Map<string, PDFFont>();

    let stamp: Stamp | null = null;
    let embedded: Awaited<ReturnType<typeof document.embedPng>> | null = null;
    if (options.kind === "text") {
        stamp = await textStamp(document, options.text, { size: options.fontSize, color: options.color, bold: true }, fonts);
    } else {
        if (!image) throw new AppError("Choose an image for the watermark.", 400, "FILE_REQUIRED");
        // Any common image, as PNG (keeps transparency); refused if it isn't really an image.
        const png = await sharp(await readFile(image.path), { limitInputPixels: 40_000_000 })
            .rotate()
            .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
            .png()
            .toBuffer()
            .catch(() => {
                throw new AppError("The watermark image couldn't be read. Please use a JPG, PNG or WebP.", 422, "INVALID_IMAGE");
            });
        embedded = await document.embedPng(png);
    }

    for (const [index, number] of targets.entries()) {
        if (context.signal.aborted) return;
        context.progress("stamping", index, targets.length);
        const target = visualPage(document.getPage(number - 1));
        const current = stamp ?? imageStamp(embedded!, target.width * options.imageScale, (target.width * options.imageScale * embedded!.height) / embedded!.width);
        for (const centre of stampCentres(target, current, options.rotation, options.position)) placeCentred(target, current, centre, options.rotation, options.opacity);
    }
    context.progress("saving", targets.length, targets.length);
    const path = context.workspace.file("pdf");
    const pages = await savePdf(document, path);
    await context.addFile({ name: `${safeDocumentName(input.name)}-watermarked.pdf`, mimeType: "application/pdf", path, pages });
    context.summary({ pages, stamped: targets.length });
}

export type NumberPosition = "top-left" | "top" | "top-right" | "bottom-left" | "bottom" | "bottom-right";

export interface PageNumberOptions {
    position: NumberPosition;
    /** "{n}", "Page {n} of {total}"… */
    template: string;
    fontSize: number;
    margin: number;
    start: number;
    color: { r: number; g: number; b: number };
    pages: string | null;
}

/** Numbers on the chosen pages, counting from `start` on the first of them. */
export async function numberPages(input: { path: string; name: string }, options: PageNumberOptions, context: JobContext) {
    context.progress("reading");
    const document = await loadPdf(input.path);
    const count = document.getPageCount();
    const targets = options.pages ? pagesIn(parsePageRanges(options.pages, count)) : Array.from({ length: count }, (_, index) => index + 1);
    const fonts = new Map<string, PDFFont>();
    const total = options.start + targets.length - 1;
    for (const [index, number] of targets.entries()) {
        if (context.signal.aborted) return;
        context.progress("numbering", index, targets.length);
        const label = options.template.replaceAll("{n}", String(options.start + index)).replaceAll("{total}", String(total));
        const stamp = await textStamp(document, label, { size: options.fontSize, color: options.color }, fonts);
        const target = visualPage(document.getPage(number - 1));
        const column = options.position.endsWith("left") ? 0 : options.position.endsWith("right") ? 2 : 1;
        const x = [options.margin + stamp.width / 2, target.width / 2, target.width - options.margin - stamp.width / 2][column]!;
        const y = options.position.startsWith("top") ? options.margin + stamp.height / 2 : target.height - options.margin - stamp.height / 2;
        placeCentred(target, stamp, { x, y }, 0, 1);
    }
    context.progress("saving", targets.length, targets.length);
    const path = context.workspace.file("pdf");
    const pages = await savePdf(document, path);
    await context.addFile({ name: `${safeDocumentName(input.name)}-numbered.pdf`, mimeType: "application/pdf", path, pages });
    context.summary({ pages, numbered: targets.length });
}
