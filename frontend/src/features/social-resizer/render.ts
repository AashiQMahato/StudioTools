import type { ExportFormat } from "@/features/image-processing/exportFormat";
import { formatOf } from "@/features/image-processing/exportFormat";
import { coverScale, type FitMode, placement, type Size, type View } from "./frame";

/** A colour, or the photo itself blurred behind (Fit's padding). */
export type Background = { kind: "color"; color: string } | { kind: "blur" };

let webp: boolean | null = null;
/** Safari before 17 silently falls back to PNG for WebP; ask a 1×1 canvas once. */
export function canEncodeWebp() {
    if (webp === null) {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        webp = canvas.toDataURL("image/webp").startsWith("data:image/webp");
    }
    return webp;
}

function context2d(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no-canvas");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    return context;
}

/**
 * Halve the source until one more resample is at most 2× down: a single big downscale skips pixels
 * and aliases even at "high" quality in some browsers.
 */
function stepDown(source: ImageBitmap, scale: number): { image: CanvasImageSource; factor: number } {
    let image: CanvasImageSource = source;
    let width = source.width;
    let height = source.height;
    let factor = 1;
    while (scale / factor < 0.5 && width > 2 && height > 2) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(width / 2);
        canvas.height = Math.ceil(height / 2);
        context2d(canvas).drawImage(image, 0, 0, canvas.width, canvas.height);
        image = canvas;
        width = canvas.width;
        height = canvas.height;
        factor = width / source.width;
    }
    return { image, factor };
}

/** Paint the blurred cover behind Fit's padding. */
function paintBlur(context: CanvasRenderingContext2D, source: ImageBitmap, target: Size) {
    const scale = coverScale(source, target) * 1.1;
    const width = source.width * scale;
    const height = source.height * scale;
    // Downsample to a tiny canvas, then stretch back: a soft blur that works where ctx.filter doesn't (Safari).
    const tiny = document.createElement("canvas");
    tiny.width = Math.max(1, Math.round(target.width / 24));
    tiny.height = Math.max(1, Math.round(target.height / 24));
    const small = context2d(tiny);
    small.drawImage(source, ((target.width - width) / 2) * (tiny.width / target.width), ((target.height - height) / 2) * (tiny.height / target.height), width * (tiny.width / target.width), height * (tiny.height / target.height));
    context.drawImage(tiny, 0, 0, target.width, target.height);
    context.fillStyle = "rgb(255 255 255 / 0.12)";
    context.fillRect(0, 0, target.width, target.height);
}

/** Render the frame at its exact pixel size and encode it. */
export async function renderFrame(source: ImageBitmap, view: View, target: Size, mode: FitMode, background: Background, format: ExportFormat, quality: number): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = context2d(canvas);

    if (background.kind === "blur") paintBlur(context, source, target);
    else {
        context.fillStyle = background.color;
        context.fillRect(0, 0, target.width, target.height);
    }

    const place = placement(view, source, target, mode);
    const { image } = stepDown(source, place.scale);
    context.drawImage(image, place.x, place.y, place.width, place.height);

    const { mimeType } = formatOf(format);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, format === "png" ? undefined : quality));
    if (!blob) throw new Error("encode-failed");
    return blob;
}
