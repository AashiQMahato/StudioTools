import sharp from "sharp";
import { env } from "../../config/env.js";
import type { ImageInput, ImageOutput, ProcessingContext } from "../../types/image.js";
import { AppError, type ErrorCode } from "../../utils/AppError.js";
import { ConcurrencyLimiter } from "../../utils/concurrency.js";
import { fetchBuffered } from "../../utils/fetchBuffered.js";
import { imageService } from "../image-service/imageServiceProcess.js";

/** The only background-removal model. */
export const BACKGROUND_REMOVAL_MODEL = "BiRefNet-Massive";

/** Switched off on this server (BACKGROUND_REMOVAL=off): the image service runs without the model, to save memory. */
export const backgroundRemovalDisabled = () => !env.backgroundRemoval.enabled;

const unavailable = () =>
    backgroundRemovalDisabled()
        ? new AppError("Background removal isn't available on this server.", 503, "BACKGROUND_REMOVAL_DISABLED")
        : new AppError("Background removal is temporarily unavailable. Please try again.", 503, "BACKGROUND_REMOVAL_UNAVAILABLE");

/** The service's failure codes and what the person sees for each (its own text is never passed on). */
const FAILURES: Partial<Record<ErrorCode, { status: number; message: string }>> = {
    INVALID_IMAGE: { status: 422, message: "This file couldn't be read as an image." },
    FILE_TOO_LARGE: { status: 413, message: "The image is too large." },
    IMAGE_TOO_LARGE: { status: 413, message: "The image has too many pixels. Please try a smaller one." },
    INSUFFICIENT_MEMORY: { status: 503, message: "Background removal failed. Please try a smaller image." },
};

/** One at a time by default: the model runs one image at a time anyway; this bounds the queue. */
const limiter = new ConcurrencyLimiter(env.backgroundRemoval.concurrency, env.maxQueuedJobs);

export interface BackgroundRemovalStatus {
    available: boolean;
    model: string;
    device?: string;
    precision?: string;
    inputSize?: number;
    loaded: boolean;
    /** Median time of the last few cut-outs (seconds), for the page's progress estimate. */
    typicalSeconds?: number | null;
}

/** Background removal by BiRefNet-Massive in the internal image service: an RGBA PNG at the original resolution. */
export const backgroundRemoval = {
    isAvailable: () => !backgroundRemovalDisabled() && imageService.connection !== null,
    stats: () => limiter.stats,

    remove: (input: ImageInput, { signal }: ProcessingContext): Promise<ImageOutput> =>
        limiter.run(async () => {
            const connection = imageService.connection;
            if (!connection || backgroundRemovalDisabled()) throw unavailable();

            const form = new FormData();
            form.append("file", new Blob([new Uint8Array(input.buffer)]), `upload.${input.format}`);
            let response: Response;
            try {
                response = await fetchBuffered(`${connection.url}/remove-background`, {
                    method: "POST",
                    body: form,
                    headers: { "x-internal-token": connection.token },
                    signal: AbortSignal.any([signal, AbortSignal.timeout(env.backgroundRemoval.timeoutMs)]),
                });
            } catch (error) {
                if (signal.aborted) throw new AppError("The request was cancelled.", 499, "REQUEST_CANCELLED");
                if (error instanceof Error && error.name === "TimeoutError") throw new AppError("Background removal took too long. Please try a smaller image.", 504, "PROCESSING_TIMEOUT");
                throw unavailable();
            }

            if (!response.ok) {
                const body = (await response.json().catch(() => null)) as { code?: string } | null;
                const code = (body?.code ?? "") as ErrorCode;
                const known = Object.hasOwn(FAILURES, code) ? FAILURES[code] : undefined;
                if (known) throw new AppError(known.message, known.status, code);
                if (response.status === 503) throw unavailable();
                throw new AppError("Background removal failed. Please try a smaller image.", 502, "PROCESSING_FAILED");
            }

            const buffer = Buffer.from(await response.arrayBuffer());
            const { width, height, format } = await sharp(buffer).metadata();
            if (format !== "png" || !width || !height) throw new AppError("Background removal failed. Please try again.", 502, "PROCESSING_FAILED");
            return { buffer, mimeType: "image/png", extension: "png", width, height, timing: response.headers.get("Server-Timing") ?? undefined };
        }, signal),

    /** The model's state, for the page and operators (no paths). */
    status: async (): Promise<BackgroundRemovalStatus> => {
        const connection = imageService.connection;
        if (backgroundRemovalDisabled() || !connection) return { available: false, model: BACKGROUND_REMOVAL_MODEL, loaded: false };
        try {
            const response = await fetch(`${connection.url}/remove-background/status`, { headers: { "x-internal-token": connection.token }, signal: AbortSignal.timeout(5000) });
            const body = (await response.json()) as BackgroundRemovalStatus & { reason?: string; disabled?: boolean; loadSeconds?: number; warmUpSeconds?: number };
            return { available: body.available, model: BACKGROUND_REMOVAL_MODEL, device: body.device, precision: body.precision, inputSize: body.inputSize, loaded: body.loaded, typicalSeconds: body.typicalSeconds ?? null };
        } catch {
            return { available: false, model: BACKGROUND_REMOVAL_MODEL, loaded: false };
        }
    },
};
