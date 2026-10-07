import { copyFile, stat } from "node:fs/promises";
import { AppError } from "../../utils/AppError.js";
import { fetchBuffered } from "../../utils/fetchBuffered.js";
import { safeDocumentName } from "../../utils/http.js";
import { imageService } from "../image-service/imageServiceProcess.js";
import type { JobContext } from "../jobs/jobService.js";
import { loadPdf } from "./pdfDocument.js";
import { renderingUnavailable } from "./renderService.js";

export type CompressPreset = "maximum" | "recommended" | "high" | "custom";

/** Photo quality (JPEG) and the longest side photos are kept at, per preset. */
export const PRESETS: Record<Exclude<CompressPreset, "custom">, { quality: number; maxSide: number }> = {
    maximum: { quality: 50, maxSide: 1200 },
    recommended: { quality: 70, maxSide: 1800 },
    high: { quality: 85, maxSide: 2600 },
};

/**
 * Compression by qpdf (pikepdf) in the internal service: photos re-encoded and reduced, streams
 * recompressed, unused objects dropped. If the result isn't smaller, the original is returned — and
 * the numbers say so; nothing is claimed that didn't happen.
 */
export async function compressPdf(input: { path: string; name: string }, settings: { quality: number; maxSide: number }, context: JobContext) {
    context.progress("reading");
    await loadPdf(input.path);
    const connection = imageService.connection;
    if (!connection) throw renderingUnavailable();
    context.progress("compressing");
    const output = context.workspace.file("pdf");
    const form = new FormData();
    form.append("source", input.path);
    form.append("target", output);
    form.append("quality", String(settings.quality));
    form.append("max_side", String(settings.maxSide));
    let response: Response;
    try {
        response = await fetchBuffered(`${connection.url}/pdf/compress`, { method: "POST", body: form, headers: { "x-internal-token": connection.token }, signal: AbortSignal.any([context.signal, AbortSignal.timeout(300_000)]) });
    } catch {
        if (context.signal.aborted) return;
        throw renderingUnavailable();
    }
    if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === "PDF_ENCRYPTED") throw new AppError("This PDF is password-protected. Remove the password, then try again.", 422, "PDF_ENCRYPTED");
        if (body?.code === "INVALID_PDF") throw new AppError("We couldn't read this PDF. It may be damaged.", 422, "INVALID_PDF");
        throw new AppError("Compression failed. Please try again.", 502, "PROCESSING_FAILED");
    }
    const { images, recompressed } = (await response.json()) as { images: number; recompressed: number };
    context.progress("saving");
    const before = (await stat(input.path)).size;
    let after = (await stat(output)).size;
    const smaller = after < before;
    // Not smaller: the original is the better file.
    if (!smaller) {
        await copyFile(input.path, output);
        after = before;
    }
    const pages = (await loadPdf(output)).getPageCount();
    await context.addFile({ name: `${safeDocumentName(input.name)}-compressed.pdf`, mimeType: "application/pdf", path: output, pages });
    context.summary({ before, after, smaller: smaller ? 1 : 0, images, recompressed });
}
