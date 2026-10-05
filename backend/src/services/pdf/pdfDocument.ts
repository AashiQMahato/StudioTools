import { open, readFile, writeFile } from "node:fs/promises";
import { EncryptedPDFError, PDFDocument } from "pdf-lib";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";

export const invalidPdf = () => new AppError("We couldn't read this PDF. It may be damaged.", 422, "INVALID_PDF");
const encryptedPdf = () => new AppError("This PDF is password-protected. Remove the password, then try again.", 422, "PDF_ENCRYPTED");
export const tooManyPages = () => new AppError(`That's more than ${env.documents.maxPages} pages. Please use a shorter document.`, 413, "TOO_MANY_PAGES");

/** A PDF starts with "%PDF-" (a few bytes of junk before it are tolerated, as readers do). */
export async function hasPdfSignature(path: string): Promise<boolean> {
    const handle = await open(path, "r");
    try {
        const head = Buffer.alloc(1024);
        const { bytesRead } = await handle.read(head, 0, head.length, 0);
        return head.subarray(0, bytesRead).includes("%PDF-");
    } finally {
        await handle.close();
    }
}

/** Opens a PDF for editing. Damaged, encrypted and over-long documents are refused with clear messages. */
export async function loadPdf(path: string): Promise<PDFDocument> {
    const bytes = await readFile(path);
    let document: PDFDocument;
    try {
        document = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (error) {
        // Some encryption (AES-256) fails before pdf-lib recognises it: the trailer says so either way.
        if (error instanceof EncryptedPDFError || bytes.includes("/Encrypt")) throw encryptedPdf();
        throw invalidPdf();
    }
    if (document.getPageCount() === 0) throw invalidPdf();
    if (document.getPageCount() > env.documents.maxPages) throw tooManyPages();
    return document;
}

/** Writes a PDF compactly (object streams), returning its page count. */
export async function savePdf(document: PDFDocument, path: string): Promise<number> {
    document.setProducer("Studio Tools");
    document.setModificationDate(new Date());
    await writeFile(path, await document.save({ useObjectStreams: true }));
    return document.getPageCount();
}
