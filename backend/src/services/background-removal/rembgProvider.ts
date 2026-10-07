import sharp from "sharp";
import { env } from "../../config/env.js";
import type { BackgroundRemovalProvider, ImageInput, ImageOutput, ProcessingContext } from "../../types/image.js";
import { AppError } from "../../utils/AppError.js";
import { rembgProcess } from "./rembgProcess.js";
import { fetchBuffered } from "../../utils/fetchBuffered.js";

/** Switched off on this server (REMBG_MODEL=none: the service runs without the model, to save memory). */
export const backgroundRemovalDisabled = () => env.rembg.model === "none";

const unavailable = () =>
    backgroundRemovalDisabled()
        ? new AppError("Background removal isn't available on this server.", 503, "BACKGROUND_REMOVAL_DISABLED")
        : new AppError("Background removal is temporarily unavailable. Please try again.", 503, "BACKGROUND_REMOVAL_UNAVAILABLE");

/** Background removal through the internal rembg service (Python, one persistent model session). */
export const rembgProvider: BackgroundRemovalProvider = {
    name: "rembg",

    // REMBG_MODEL=none: the service runs (for PDFs and the rest) without the background-removal model.
    isAvailable: () => !backgroundRemovalDisabled() && rembgProcess.connection !== null,

    async removeBackground(input: ImageInput, { signal }: ProcessingContext): Promise<ImageOutput> {
        const connection = rembgProcess.connection;
        if (!connection) throw unavailable();

        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(input.buffer)]), `upload.${input.format}`);

        let response: Response;
        try {
            response = await fetchBuffered(`${connection.url}/remove-background`, {
                method: "POST",
                body: form,
                headers: { "x-internal-token": connection.token },
                signal: AbortSignal.any([signal, AbortSignal.timeout(env.rembg.timeoutMs)]),
            });
        } catch (error) {
            if (signal.aborted) throw new AppError("The request was cancelled.", 499, "REQUEST_CANCELLED");
            if (error instanceof Error && error.name === "TimeoutError") {
                throw new AppError("Background removal took too long. Please try a smaller image.", 504, "PROCESSING_TIMEOUT");
            }
            throw unavailable();
        }

        if (!response.ok) {
            // The service returns safe codes; map them without passing its text through.
            const body = (await response.json().catch(() => null)) as { code?: string } | null;
            if (body?.code === "INVALID_IMAGE") throw new AppError("This file couldn't be read as an image.", 422, "INVALID_IMAGE");
            if (body?.code === "FILE_TOO_LARGE") throw new AppError("The image is too large.", 413, "FILE_TOO_LARGE");
            if (response.status === 503) throw unavailable();
            throw new AppError("Background removal failed. Please try again.", 502, "PROCESSING_FAILED");
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const { width, height, format } = await sharp(buffer).metadata();
        if (format !== "png" || !width || !height) throw new AppError("Background removal failed. Please try again.", 502, "PROCESSING_FAILED");

        return { buffer, mimeType: "image/png", extension: "png", width, height };
    },
};
