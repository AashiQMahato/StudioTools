import type { PDFDocumentProxy } from "pdfjs-dist";
import { pdfjs } from "@/lib/pdf/pdfjs";
import type { ImageFile } from "@/types/image";

/** A PDF opened in the OCR editor. It stays on this device: only rendered pages are sent to be read. */
export interface PdfSource {
    id: string;
    file: File;
    name: string;
    pageCount: number;
}

const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const MAX_PDF_PAGES = 200;
/** Pages are rendered with this long side: ~200–300 dpi for a normal page, plenty for small text. */
const RENDER_LONG_SIDE = 2400;

export type PdfProblem = "locked" | "unreadable" | "tooLarge" | "empty";
export class PdfError extends Error {
    readonly problem: PdfProblem;
    constructor(problem: PdfProblem) {
        super(problem);
        this.problem = problem;
    }
}

export const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

/** Open documents, by source id — each file is parsed once, however many pages are viewed. */
const open = new Map<string, Promise<PDFDocumentProxy>>();

async function load(source: Pick<PdfSource, "id" | "file">): Promise<PDFDocumentProxy> {
    let pending = open.get(source.id);
    if (!pending) {
        pending = (async () => {
            const library = await pdfjs();
            try {
                // The file's own bytes, read here: nothing is fetched from anywhere, and scripts in the PDF never run.
                return await library.getDocument({ data: new Uint8Array(await source.file.arrayBuffer()), enableXfa: false }).promise;
            } catch (error) {
                throw new PdfError(error instanceof library.PasswordException ? "locked" : "unreadable");
            }
        })();
        pending.catch(() => open.delete(source.id));
        open.set(source.id, pending);
    }
    return pending;
}

/** Checks a picked PDF and counts its pages. */
export async function openPdf(file: File): Promise<PdfSource> {
    if (file.size > MAX_PDF_BYTES) throw new PdfError("tooLarge");
    const id = crypto.randomUUID();
    const document = await load({ id, file });
    if (!document.numPages) throw new PdfError("empty");
    return { id, file, name: file.name, pageCount: Math.min(document.numPages, MAX_PDF_PAGES) };
}

/** Forgets an opened PDF (when another file replaces it). */
export function closePdf(id: string) {
    const pending = open.get(id);
    open.delete(id);
    void pending?.then((document) => document.loadingTask.destroy()).catch(() => undefined);
}

/** A page's id: stable, so each page keeps its own reading. */
export const pageId = (sourceId: string, page: number) => `${sourceId}:p${page}`;

/** Which page of which PDF an image is, if it is one. */
export function pageOf(imageId: string): { sourceId: string; page: number } | null {
    const match = /^(.+):p(\d+)$/.exec(imageId);
    return match ? { sourceId: match[1]!, page: Number(match[2]) } : null;
}

/** A canvas turned clockwise by a quarter-turn multiple. */
function turned(source: CanvasImageSource & { width: number; height: number }, degrees: number) {
    const canvas = document.createElement("canvas");
    const sideways = degrees === 90 || degrees === 270;
    canvas.width = sideways ? source.height : source.width;
    canvas.height = sideways ? source.width : source.height;
    const context = canvas.getContext("2d")!;
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((degrees * Math.PI) / 180);
    context.drawImage(source, -source.width / 2, -source.height / 2);
    return canvas;
}

const toPng = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new PdfError("unreadable"))), "image/png"));

async function describe(id: string, file: File, name: string, convertedFrom?: string): Promise<ImageFile> {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return { id, file, name, size: file.size, mimeType: file.type, previewUrl: URL.createObjectURL(file), dimensions, ...(convertedFrom ? { convertedFrom } : {}) };
}

/**
 * The image turned upright, as reading found it (a sideways or upside-down scan). Same id and name:
 * it's the same picture, the right way up.
 */
export async function turnImage(image: ImageFile, degrees: number): Promise<ImageFile> {
    const bitmap = await createImageBitmap(image.file);
    const blob = await toPng(turned(bitmap, degrees));
    bitmap.close();
    const file = new File([blob], image.file.name.replace(/\.[^.]*$/, "") + ".png", { type: "image/png" });
    return describe(image.id, file, image.name, image.convertedFrom);
}

const rendered = new Map<string, Promise<File>>();

/**
 * A page as an image (PNG, white paper), ready for the same reading as any photo or scan. Rendered
 * once per page; each call gets its own preview URL.
 */
export async function renderPage(source: PdfSource, page: number, pageName: string, rotation = 0): Promise<ImageFile> {
    const id = pageId(source.id, page);
    const key = `${id}@${rotation}`;
    let pending = rendered.get(key);
    if (!pending) {
        pending = (async () => {
            const document = await load(source);
            const pdfPage = await document.getPage(page);
            const base = pdfPage.getViewport({ scale: 1 });
            const scale = Math.min(6, RENDER_LONG_SIDE / Math.max(base.width, base.height));
            const viewport = pdfPage.getViewport({ scale });
            const canvas = window.document.createElement("canvas");
            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);
            await pdfPage.render({ canvas, viewport, background: "#ffffff" }).promise;
            pdfPage.cleanup();
            // A page found sideways when it was read is shown upright from then on.
            const blob = await toPng(rotation ? turned(canvas, rotation) : canvas);
            return new File([blob], pageName.replace(/[\\/:*?"<>|]+/g, "-") + ".png", { type: "image/png" });
        })();
        pending.catch(() => rendered.delete(key));
        rendered.set(key, pending);
    }
    return describe(id, await pending, pageName, "PDF");
}
