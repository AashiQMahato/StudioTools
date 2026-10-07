import type { SupportedFormat } from "../config/upload.js";

/** An upload that has passed validation: its real format and dimensions come from decoding it. */
export interface ImageInput {
    buffer: Buffer;
    originalName: string;
    format: SupportedFormat;
    width: number;
    height: number;
    hasAlpha: boolean;
}

export interface ImageOutput {
    buffer: Buffer;
    mimeType: string;
    /** Extension for the download filename, without the dot. */
    extension: string;
    width: number;
    height: number;
    /** The processor's stage timings (Server-Timing header value), when it reports them. */
    timing?: string;
}

export type UpscaleScale = 2 | 4;

export interface UpscaleOptions {
    scale: UpscaleScale;
}

export interface ProcessingContext {
    /** Aborted when the client disconnects or the request times out. */
    signal: AbortSignal;
}

/** Contract every background-removal provider must implement, so providers can be swapped. */
/** Contract every upscaling provider must implement, so providers can be swapped. */
export interface UpscaleProvider {
    readonly name: string;
    isAvailable(): boolean;
    upscale(input: ImageInput, options: UpscaleOptions, context: ProcessingContext): Promise<ImageOutput>;
}

export type RetouchMode = "remove" | "heal" | "smooth" | "enhance" | "relight";

export interface RetouchOptions {
    mode: RetouchMode;
    /** 0–1. How strong the effect is (smooth, enhance, relight). */
    strength: number;
    /** 0–1. How much fine skin texture survives smoothing (smooth only). */
    texture: number;
}

/** Interleaved RGB pixels, 8 bits per channel. */
export interface RawImage {
    data: Buffer;
    width: number;
    height: number;
}

/** One 8-bit channel per pixel: 255 is fully selected, 0 is untouched. */
export interface RawMask {
    data: Buffer;
    width: number;
    height: number;
}

/**
 * Contract every retouch provider must implement, so providers can be swapped. The service hands a
 * provider only the region around the selection (already scaled to a workable size) and blends the
 * result back itself, so a provider only has to produce pixels — and only the masked ones matter.
 */
export interface RetouchProvider {
    readonly name: string;
    isAvailable(): boolean;
    supports(mode: RetouchMode): boolean;
    /** Returns an image the same size as `image`. */
    retouch(image: RawImage, mask: RawMask, options: RetouchOptions, context: ProcessingContext): Promise<RawImage>;
}
