import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
import { fetchBuffered } from "../../utils/fetchBuffered.js";
import { safeDocumentName } from "../../utils/http.js";
import { imageService } from "../image-service/imageServiceProcess.js";
import type { JobContext } from "../jobs/jobService.js";
import { loadPdf } from "./pdfDocument.js";
import { pagesIn, parsePageRanges } from "./pageRanges.js";

export interface RenderOptions {
    format: "jpg" | "png" | "webp";
    dpi: number;
    quality: number;
    /** Page ranges ("1-3, 5"), or null for every page. */
    pages: string | null;
}

export const renderingUnavailable = () => new AppError("Page rendering is temporarily unavailable. Please try again in a moment.", 503, "RENDERING_UNAVAILABLE");

/**
 * One page as a PNG, drawn by PDFium in the internal image service. The service reads the file
 * from the job's workspace (it only accepts paths inside the documents temp root).
 */
export async function renderPage(path: string, page: number, dpi: number, signal: AbortSignal): Promise<Buffer> {
    const connection = imageService.connection;
    if (!connection) throw renderingUnavailable();
    const form = new FormData();
    form.append("path", path);
    form.append("page", String(page - 1));
    form.append("scale", String(dpi / 72));
    form.append("max_pixels", String(env.documents.maxRenderPixels));
    let response: Response;
    try {
        response = await fetchBuffered(`${connection.url}/pdf/render`, { method: "POST", body: form, headers: { "x-internal-token": connection.token }, signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) });
    } catch {
        if (signal.aborted) throw new AppError("The request was cancelled.", 499, "REQUEST_CANCELLED");
        throw renderingUnavailable();
    }
    if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === "INVALID_PDF") throw new AppError("We couldn't read this PDF. It may be damaged.", 422, "INVALID_PDF");
        if (response.status === 503) throw renderingUnavailable();
        throw new AppError("A page couldn't be rendered. Please try again.", 502, "PROCESSING_FAILED");
    }
    return Buffer.from(await response.arrayBuffer());
}

/** Each chosen page as an image file (JPG, PNG or WebP) at the chosen resolution. */
export async function pdfToImages(input: { path: string; name: string }, options: RenderOptions, context: JobContext) {
    context.progress("reading");
    const document = await loadPdf(input.path);
    const count = document.getPageCount();
    const pages = options.pages ? pagesIn(parsePageRanges(options.pages, count)) : Array.from({ length: count }, (_, index) => index + 1);
    const base = safeDocumentName(input.name, "document");
    const digits = String(count).length;
    for (const [index, page] of pages.entries()) {
        if (context.signal.aborted) return;
        context.progress("rendering", index, pages.length);
        const png = await renderPage(input.path, page, options.dpi, context.signal);
        const image = sharp(png).withMetadata({ density: options.dpi });
        const encoded =
            options.format === "png"
                ? await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
                : options.format === "webp"
                  ? await image.webp({ quality: options.quality }).toBuffer()
                  : await image.jpeg({ quality: options.quality, mozjpeg: true }).toBuffer();
        const path = context.workspace.file(options.format);
        await writeFile(path, encoded);
        const mimeType = options.format === "jpg" ? "image/jpeg" : `image/${options.format}`;
        await context.addFile({ name: `${base}-page-${String(page).padStart(digits, "0")}.${options.format}`, mimeType, path, pages: undefined });
    }
    context.progress("finishing", pages.length, pages.length);
    context.summary({ images: pages.length, sourcePages: count });
}
