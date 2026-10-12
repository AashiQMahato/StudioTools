import { ApiError, type BinaryResult, postFormForBlob, type UploadOptions } from "./apiClient";

export type RetouchMode = "remove" | "heal" | "smooth" | "enhance" | "relight";

export interface RetouchRequest {
    /** The image to retouch, at full resolution. */
    image: Blob;
    /** Sent as the upload's file name (the server derives the download name from it). */
    fileName: string;
    /** The selection: a PNG, transparent outside the selected area. Sent separately, never merged into the image. */
    mask: Blob;
    mode: RetouchMode;
    /** 0–1. */
    strength: number;
    /** 0–1, how much fine texture smoothing keeps. */
    texture?: number;
    /** "high" asks for the slower, better PowerPaint engine where the server has it; the server says which one ran. */
    quality?: "fast" | "high";
}

/** A little longer than the server's own limit, so its (friendlier) timeout normally arrives first. */
const TIMEOUT_MS = 150_000;
/** High quality takes minutes on a laptop. */
const HIGH_QUALITY_TIMEOUT_MS = 660_000;

/**
 * Retouches the selected area. Which engine does the work — the built-in one or an AI model — is the
 * server's choice; this only knows the contract: image + mask + mode in, processed image out.
 */
export function retouchImage({ image, fileName, mask, mode, strength, texture, quality }: RetouchRequest, options: UploadOptions = {}): Promise<BinaryResult> {
    const form = new FormData();
    form.append("mode", mode);
    form.append("strength", strength.toFixed(2));
    if (texture !== undefined) form.append("texture", texture.toFixed(2));
    form.append("file", image, fileName);
    form.append("mask", mask, "mask.png");
    if (quality === "high") form.append("quality", "high");
    return postWithTimeout("/retouch", form, options, quality === "high");
}

/**
 * Removes the selected objects with AI inpainting (LaMa) — never the built-in classical fill: without
 * an AI engine the server answers OBJECT_REMOVAL_UNAVAILABLE. The X-Inpaint-Engine header names the model.
 */
export function removeObject({ image, fileName, mask, quality }: Pick<RetouchRequest, "image" | "fileName" | "mask" | "quality">, options: UploadOptions = {}): Promise<BinaryResult> {
    const form = new FormData();
    form.append("file", image, fileName);
    form.append("mask", mask, "mask.png");
    if (quality === "high") form.append("quality", "high");
    return postWithTimeout("/remove-object", form, options, quality === "high");
}

function postWithTimeout(path: string, form: FormData, { signal, ...options }: UploadOptions, high = false): Promise<BinaryResult> {

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, high ? HIGH_QUALITY_TIMEOUT_MS : TIMEOUT_MS);

    return postFormForBlob(path, form, { ...options, signal: controller.signal })
        .catch((error: unknown) => {
            if (timedOut) throw new ApiError("Retouching took too long.", 408, "PROCESSING_TIMEOUT");
            throw error;
        })
        .finally(() => {
            window.clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
        });
}
