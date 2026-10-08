import sharp from "sharp";
import { env } from "../../config/env.js";
import type { ImageInput, ImageOutput, ProcessingContext, RetouchMode, RetouchOptions, RetouchProvider } from "../../types/image.js";
import { AppError } from "../../utils/AppError.js";
import { ConcurrencyLimiter } from "../../utils/concurrency.js";
import { encodeLike } from "../image-processing/encode.js";
import { iopaintProvider } from "./providers/iopaintProvider.js";
import { lamaProvider } from "./providers/lamaProvider.js";
import { localRetouchProvider } from "./providers/localProvider.js";
import { dilate, gaussianBlur } from "./providers/pixels.js";

export const RETOUCH_MODES: readonly RetouchMode[] = ["remove", "heal", "smooth", "enhance", "relight"];

/** Mask values at or below this count as unselected (anti-aliasing dust from the brush). */
const SELECTED = 8;

interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** Swap providers here; controllers only ever call this service. */
export type ProviderPreference = "auto" | "local" | "lama" | "iopaint";

/**
 * Filling modes (remove, repair) use AI inpainting when there is one: an IOPaint server if configured,
 * else LaMa in the local image service if its model is installed, else the built-in engine. Everything
 * else is the built-in engine's job. A preference pins the choice.
 */
function providerFor(mode: RetouchMode, preference: ProviderPreference = env.retouch.provider): RetouchProvider {
    if (preference === "local" || !lamaProvider.supports(mode)) return localRetouchProvider;
    if (preference === "iopaint") return iopaintProvider;
    if (preference === "lama") return lamaProvider;
    if (iopaintProvider.isAvailable()) return iopaintProvider;
    return lamaProvider.isAvailable() ? lamaProvider : localRetouchProvider;
}

const limiter = new ConcurrencyLimiter(env.retouch.concurrency, env.maxQueuedJobs);

const invalidMask = () => new AppError("The selection couldn't be read. Please paint the area again.", 422, "INVALID_MASK");

/** The selection as one 8-bit channel at the image's size. Transparency (or, without it, brightness) is the selection. */
async function readMask(buffer: Buffer, width: number, height: number): Promise<Buffer> {
    try {
        const image = sharp(buffer, { failOn: "error", limitInputPixels: env.maxImagePixels });
        const { hasAlpha } = await image.metadata();
        const channel = hasAlpha ? image.extractChannel(3) : image.greyscale();
        const data = await channel.resize(width, height, { fit: "fill" }).raw().toBuffer();
        if (data.length !== width * height) throw new Error("unexpected channels");
        return data;
    } catch {
        throw invalidMask();
    }
}

function selectionBounds(mask: Buffer, width: number, height: number): Rect | null {
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            if (mask[row + x]! <= SELECTED) continue;
            if (x < left) left = x;
            if (x > right) right = x;
            if (y < top) top = y;
            bottom = y;
        }
    }
    return right < 0 ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function expand(rect: Rect, margin: number, width: number, height: number): Rect {
    const left = Math.max(0, rect.left - margin);
    const top = Math.max(0, rect.top - margin);
    const right = Math.min(width, rect.left + rect.width + margin);
    const bottom = Math.min(height, rect.top + rect.height + margin);
    return { left, top, width: right - left, height: bottom - top };
}

function cropChannel(data: Buffer, width: number, rect: Rect): Buffer {
    const out = Buffer.allocUnsafe(rect.width * rect.height);
    for (let y = 0; y < rect.height; y++) {
        const from = (rect.top + y) * width + rect.left;
        data.copy(out, y * rect.width, from, from + rect.width);
    }
    return out;
}

/** A 0–1 plane as 8-bit values (rounded and clamped). */
const toBytes = (plane: Float32Array) => Buffer.from(Uint8ClampedArray.from(plane, (value) => value * 255).buffer);

const resizeRaw = (data: Buffer, width: number, height: number, channels: 1 | 3, to: { width: number; height: number }) =>
    width === to.width && height === to.height
        ? Promise.resolve(data)
        : sharp(data, { raw: { width, height, channels } }).resize(to.width, to.height, { fit: "fill", kernel: channels === 1 ? "cubic" : "lanczos3" }).raw().toBuffer();

/**
 * Retouches the selected area of an image and returns the whole image at its original resolution.
 *
 * Only the region around the selection is processed: it's cropped with enough surroundings for
 * context, scaled down if it's larger than a provider should handle, retouched, and blended back
 * through the (feathered) selection — so every unselected pixel leaves exactly as it arrived.
 */
async function retouch(input: ImageInput, maskFile: Buffer, options: RetouchOptions, context: ProcessingContext, preference?: ProviderPreference): Promise<ImageOutput> {
    const provider = providerFor(options.mode, preference);
    if (!provider.isAvailable()) throw new AppError("Retouching is temporarily unavailable. Please try again in a moment.", 503, "RETOUCH_UNAVAILABLE");

    const { width, height } = input;
    // EXIF orientation applied: the browser painted the selection over the upright image.
    const upright = () => sharp(input.buffer, { limitInputPixels: env.maxImagePixels }).rotate();
    const selection = await readMask(maskFile, width, height);
    const bounds = selectionBounds(selection, width, height);
    if (!bounds) throw new AppError("Select an area to retouch first.", 400, "EMPTY_MASK");

    const fills = options.mode === "remove" || options.mode === "heal";
    // Filling needs to see plenty of what surrounds the hole; filters only need room for their radius.
    const side = Math.max(bounds.width, bounds.height);
    const region = expand(bounds, Math.round(fills ? Math.max(48, side * 0.6) : Math.max(24, side * 0.15)), width, height);
    const scale = Math.min(1, env.retouch.maxWorkingSize / Math.max(region.width, region.height));
    const work = { width: Math.max(1, Math.round(region.width * scale)), height: Math.max(1, Math.round(region.height * scale)) };

    // Only the region is ever decoded into memory — never the whole photo (a 12 MP photo is 48 MB raw,
    // and a few full copies are what ran a 512 MB server out of memory).
    const pixels = await upright().extract(region).ensureAlpha().raw().toBuffer();
    if (pixels.length !== region.width * region.height * 4) throw new AppError("This file couldn't be read as an image. It may be damaged.", 422, "INVALID_IMAGE");
    const regionRgb = await sharp(pixels, { raw: { width: region.width, height: region.height, channels: 4 } })
        .removeAlpha()
        .resize(work.width, work.height, { fit: "fill", kernel: "lanczos3" })
        .raw()
        .toBuffer();
    const regionMask = await resizeRaw(cropChannel(selection, width, region), region.width, region.height, 1, work);

    // What the provider fills, and how its result is blended back. Filling works on a hard hole grown a
    // little past the brush, so no outline of the object survives; the blend feathers that hole's edge.
    let providerMask = regionMask;
    let blend = regionMask;
    if (fills) {
        const hole = dilate(regionMask, work.width, work.height, Math.max(2, Math.round(3 + side * scale * 0.01)), 64);
        providerMask = toBytes(hole);
        blend = toBytes(gaussianBlur(hole, work.width, work.height, 1.5));
    }

    let processed = await provider.retouch({ data: regionRgb, ...work }, { data: providerMask, ...work }, options, context);
    if (processed.width !== work.width || processed.height !== work.height) {
        processed = { data: await resizeRaw(processed.data, processed.width, processed.height, 3, work), ...work };
    }
    if (context.signal.aborted) throw new AppError("The request was cancelled.", 499, "REQUEST_CANCELLED");

    // Back to full size. Only blended pixels change, so the rest keep their full resolution.
    const [rgb, alpha] = await Promise.all([resizeRaw(processed.data, work.width, work.height, 3, region), resizeRaw(blend, work.width, work.height, 1, region)]);
    for (let y = 0; y < region.height; y++) {
        for (let x = 0; x < region.width; x++) {
            const r = y * region.width + x;
            const a = alpha[r]! / 255;
            if (a === 0) continue;
            const o = r * 4;
            for (let c = 0; c < 3; c++) pixels[o + c] = Math.round(pixels[o + c]! + (rgb[r * 3 + c]! - pixels[o + c]!) * a);
        }
    }

    // The retouched region laid back into the photo as it's encoded: libvips streams the rest in tiles,
    // so every other pixel is the original's. The region carries the photo's own alpha (opaque for a
    // photo), so laying it "over" replaces the area with the retouched pixels.
    const output = upright()
        .ensureAlpha()
        .composite([{ input: pixels, raw: { width: region.width, height: region.height, channels: 4 }, left: region.left, top: region.top, blend: "over" }]);
    return encodeLike(input.hasAlpha ? output : output.removeAlpha(), input);
}

/**
 * On a small server, hand the job's buffers back now: they're large (the region and its float copies)
 * and the collector would otherwise let a few jobs' worth pile up first. Needs node --expose-gc.
 */
function releaseMemory() {
    if (env.lowMemory) (globalThis as { gc?: () => void }).gc?.();
}

export const retouching = {
    isAvailable: () => RETOUCH_MODES.every((mode) => providerFor(mode).isAvailable()),
    /** Which engine handles each mode, for the health endpoint. */
    engines: () => Object.fromEntries(RETOUCH_MODES.map((mode) => [mode, providerFor(mode).name])) as Record<RetouchMode, string>,
    stats: () => limiter.stats,
    /** Which engine a mode would use (for health reports and callers with their own preference). */
    providerName: (mode: RetouchMode, preference?: ProviderPreference) => providerFor(mode, preference).name,
    /** `preference` overrides RETOUCH_PROVIDER for this call (e.g. the watermark remover's own setting). */
    retouch: (input: ImageInput, mask: Buffer, options: RetouchOptions, context: ProcessingContext, preference?: ProviderPreference): Promise<ImageOutput> =>
        limiter.run(() => retouch(input, mask, options, context, preference).finally(releaseMemory), context.signal),
};
