import { type Adjustments, applyMatrix, buildMatrix, type FilterId } from "./color";
import type { CropRect, Orientation } from "./geometry";

export type ExportFormat = "jpeg" | "png" | "webp";

export interface EditState {
    orientation: Orientation;
    /** Crop in on-screen space (see geometry.ts). */
    crop: CropRect;
    adjustments: Adjustments;
    filter: FilterId;
    /** Output size; null = the crop's own pixel size. */
    resize: { width: number; height: number } | null;
}

/** Decode once, honouring EXIF orientation, so every later step works in upright pixels. */
export async function decodeSource(file: File): Promise<ImageBitmap> {
    return createImageBitmap(file, { imageOrientation: "from-image" });
}

/** A small, colour-accurate working copy for live preview. */
export function makePreviewBase(source: ImageBitmap, maxSide = 1600) {
    const ratio = Math.min(1, maxSide / Math.max(source.width, source.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * ratio));
    canvas.height = Math.max(1, Math.round(source.height * ratio));
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** Paint `base` with adjustments into `canvas` (preview). */
export function paintPreview(canvas: HTMLCanvasElement, base: ImageData, filter: FilterId, adjustments: Adjustments) {
    if (canvas.width !== base.width) canvas.width = base.width;
    if (canvas.height !== base.height) canvas.height = base.height;
    const matrix = buildMatrix(filter, adjustments);
    const context = canvas.getContext("2d")!;
    if (!matrix) {
        context.putImageData(base, 0, 0);
        return;
    }
    const copy = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
    applyMatrix(copy.data, matrix);
    context.putImageData(copy, 0, 0);
}

/** Largest output we attempt (pixels). Mobile Safari refuses canvases much bigger than ~16 MP. */
const MAX_OUTPUT_PIXELS = 50_000_000;

/**
 * Render the final image at full resolution: one resample for crop + straighten + rotate + flip + resize,
 * then the colour matrix. Returns a Blob in the requested format.
 */
export async function renderEdit(source: ImageBitmap, edit: EditState, format: ExportFormat, quality = 0.92): Promise<Blob> {
    const { crop, orientation, resize } = edit;
    const width = Math.max(1, Math.round(resize?.width ?? crop.w));
    const height = Math.max(1, Math.round(resize?.height ?? crop.h));
    if (width * height > MAX_OUTPUT_PIXELS) throw new Error("too-large");

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("no-canvas");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    if (format === "jpeg") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
    }

    // Output pixel → screen space → source, the inverse of the on-screen transform chain.
    context.scale(width / crop.w, height / crop.h);
    context.translate(crop.w / 2 - crop.cx, crop.h / 2 - crop.cy);
    context.rotate((orientation.angle * Math.PI) / 180);
    context.scale(orientation.flipX ? -1 : 1, orientation.flipY ? -1 : 1);
    context.rotate((-90 * orientation.quarter * Math.PI) / 180);
    context.drawImage(source, -source.width / 2, -source.height / 2);
    context.setTransform(1, 0, 0, 1, 0, 0);

    const matrix = buildMatrix(edit.filter, edit.adjustments);
    if (matrix) {
        const pixels = context.getImageData(0, 0, width, height);
        applyMatrix(pixels.data, matrix);
        context.putImageData(pixels, 0, 0);
    }

    const type = format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, format === "png" ? undefined : quality));
    if (!blob) throw new Error("encode-failed");
    return blob;
}

export function formatFromMime(mimeType: string): ExportFormat {
    if (mimeType === "image/png") return "png";
    if (mimeType === "image/webp") return "webp";
    return "jpeg";
}

export const EXTENSIONS: Record<ExportFormat, string> = { jpeg: "jpg", png: "png", webp: "webp" };
