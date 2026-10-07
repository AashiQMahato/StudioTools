import { randomBytes } from "node:crypto";
import { AppError } from "../../utils/AppError.js";
import { fetchBuffered } from "../../utils/fetchBuffered.js";
import { safeDocumentName } from "../../utils/http.js";
import { imageService } from "../image-service/imageServiceProcess.js";
import type { JobContext } from "../jobs/jobService.js";
import { loadPdf } from "./pdfDocument.js";
import { renderingUnavailable } from "./renderService.js";

async function call(path: string, fields: Record<string, string>, signal: AbortSignal) {
    const connection = imageService.connection;
    if (!connection) throw renderingUnavailable();
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    let response: Response;
    try {
        response = await fetchBuffered(`${connection.url}${path}`, { method: "POST", body: form, headers: { "x-internal-token": connection.token }, signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]) });
    } catch {
        if (signal.aborted) throw new AppError("The request was cancelled.", 499, "REQUEST_CANCELLED");
        throw renderingUnavailable();
    }
    const body = (await response.json().catch(() => null)) as { code?: string; pages?: number } | null;
    if (!response.ok) {
        if (body?.code === "WRONG_PASSWORD") throw new AppError("That password isn't right. Check it and try again.", 422, "WRONG_PASSWORD");
        if (body?.code === "PDF_ENCRYPTED") throw new AppError("This PDF is already password-protected. Unlock it first.", 422, "PDF_ENCRYPTED");
        throw new AppError("We couldn't read this PDF. It may be damaged.", 422, "INVALID_PDF");
    }
    return body ?? {};
}

export interface ProtectOptions {
    password: string;
    /** Changing permissions later needs this; generated (and never shown) when not given. */
    ownerPassword: string | null;
    allowPrint: boolean;
    allowCopy: boolean;
    allowEdit: boolean;
}

/**
 * AES-256 encryption (qpdf, via pikepdf): the password opens the PDF; the permissions say what
 * compliant readers allow once it's open. Passwords are never logged or kept.
 */
export async function protectPdf(input: { path: string; name: string }, options: ProtectOptions, context: JobContext) {
    context.progress("reading");
    await loadPdf(input.path);
    context.progress("encrypting");
    const output = context.workspace.file("pdf");
    const { pages } = await call(
        "/pdf/protect",
        {
            source: input.path,
            target: output,
            user_password: options.password,
            owner_password: options.ownerPassword ?? randomBytes(24).toString("hex"),
            allow_print: String(options.allowPrint),
            allow_copy: String(options.allowCopy),
            allow_edit: String(options.allowEdit),
        },
        context.signal,
    );
    await context.addFile({ name: `${safeDocumentName(input.name)}-protected.pdf`, mimeType: "application/pdf", path: output, ...(pages ? { pages } : {}) });
    context.summary({ pages: pages ?? 0 });
}

/** Removes a PDF's password — with the password (or none, when only printing or copying was restricted). */
export async function unlockPdf(input: { path: string; name: string }, password: string, context: JobContext) {
    context.progress("decrypting");
    const output = context.workspace.file("pdf");
    const { pages } = await call("/pdf/unlock", { source: input.path, target: output, password }, context.signal);
    await context.addFile({ name: `${safeDocumentName(input.name)}-unlocked.pdf`, mimeType: "application/pdf", path: output, ...(pages ? { pages } : {}) });
    context.summary({ pages: pages ?? 0 });
}
