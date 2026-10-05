import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { AppError } from "../../utils/AppError.js";
import { safeDocumentName } from "../../utils/http.js";
import type { JobContext } from "../jobs/jobService.js";
import { prepareImage } from "../photo-generator/formatConversionService.js";
import { savePdf } from "./pdfDocument.js";

export type PageSize = "a4" | "letter" | "legal" | "original" | "custom";

export interface ImagesToPdfOptions {
    size: PageSize;
    orientation: "auto" | "portrait" | "landscape";
    /** For "custom": the page in millimetres. */
    custom: { width: number; height: number };
    margin: number; // millimetres
    fit: "contain" | "cover" | "original";
    /** JPEG quality, 40–100. */
    quality: number;
    /** Images are reduced to at most this resolution where they're placed (null: kept as they are). */
    maxDpi: number | null;
}

export interface ImageInput {
    path: string;
    name: string;
    /** Clockwise quarter turns chosen in the editor, on top of the photo's own orientation. */
    rotate: 0 | 90 | 180 | 270;
}

// Points (1/72 inch).
const SIZES: Record<Exclude<PageSize, "original" | "custom">, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008] };
const MM = 72 / 25.4;
/** An image's natural size on paper: 96 pixels per inch, as browsers and office apps assume. */
const PX = 72 / 96;

interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Where an image goes: the page's size and the box the image is drawn in (points, from the top
 * left). The frontend's preview uses the same arithmetic, so what you see is what you get.
 */
function placeImage(image: { width: number; height: number }, options: ImagesToPdfOptions): { page: { width: number; height: number }; box: Box; crop: boolean } {
    const margin = Math.max(0, options.margin) * MM;
    const natural = { width: image.width * PX, height: image.height * PX };
    if (options.size === "original") {
        return { page: { width: natural.width + margin * 2, height: natural.height + margin * 2 }, box: { x: margin, y: margin, ...natural }, crop: false };
    }
    let [width, height] = options.size === "custom" ? [options.custom.width * MM, options.custom.height * MM] : SIZES[options.size];
    const landscape = options.orientation === "landscape" || (options.orientation === "auto" && image.width > image.height);
    if (landscape !== width > height) [width, height] = [height, width];
    const area = { x: margin, y: margin, width: Math.max(1, width - margin * 2), height: Math.max(1, height - margin * 2) };
    if (options.fit === "cover") return { page: { width, height }, box: area, crop: true };
    const scale = options.fit === "original" ? Math.min(1, area.width / natural.width, area.height / natural.height) : Math.min(area.width / natural.width, area.height / natural.height);
    const drawn = { width: natural.width * scale, height: natural.height * scale };
    return { page: { width, height }, box: { x: area.x + (area.width - drawn.width) / 2, y: area.y + (area.height - drawn.height) / 2, ...drawn }, crop: false };
}

/** One page per image, in the order given. */
export async function imagesToPdf(inputs: ImageInput[], options: ImagesToPdfOptions, context: JobContext) {
    const output = await PDFDocument.create();
    for (const [index, input] of inputs.entries()) {
        if (context.signal.aborted) return;
        context.progress("placing", index, inputs.length);
        // The same checks as every image tool: real format from the bytes, HEIC converted, upright.
        const prepared = await prepareImage(await readFile(input.path), context.signal).catch((error: unknown) => {
            if (error instanceof AppError) throw new AppError(`${input.name.slice(0, 80)}: ${error.message}`, error.statusCode, error.code);
            throw error;
        });
        let image = sharp(prepared.buffer).rotate(input.rotate || undefined);
        const turned = input.rotate === 90 || input.rotate === 270;
        const size = turned ? { width: prepared.height, height: prepared.width } : { width: prepared.width, height: prepared.height };
        const { page, box, crop } = placeImage(size, options);
        if (crop) {
            // Cover: the image fills the area, trimmed evenly on the long side.
            const aspect = box.width / box.height;
            const cropWidth = Math.min(size.width, Math.round(size.height * aspect));
            const cropHeight = Math.min(size.height, Math.round(size.width / aspect));
            image = sharp(await image.toBuffer()).extract({ left: Math.floor((size.width - cropWidth) / 2), top: Math.floor((size.height - cropHeight) / 2), width: cropWidth, height: cropHeight });
        }
        if (options.maxDpi) {
            const maxWidth = Math.round((box.width / 72) * options.maxDpi);
            image = image.resize({ width: maxWidth, withoutEnlargement: true });
        }
        const jpeg = await image.flatten({ background: "#ffffff" }).jpeg({ quality: options.quality, mozjpeg: true, chromaSubsampling: options.quality >= 90 ? "4:4:4" : "4:2:0" }).toBuffer();
        const embedded = await output.embedJpg(jpeg);
        const pdfPage = output.addPage([page.width, page.height]);
        // PDF's origin is the bottom left.
        pdfPage.drawImage(embedded, { x: box.x, y: page.height - box.y - box.height, width: box.width, height: box.height });
    }
    context.progress("saving", inputs.length, inputs.length);
    const path = context.workspace.file("pdf");
    const pages = await savePdf(output, path);
    const name = inputs.length === 1 ? safeDocumentName(inputs[0]!.name, "images") : "images";
    await context.addFile({ name: `${name}.pdf`, mimeType: "application/pdf", path, pages });
    context.summary({ pages });
}
