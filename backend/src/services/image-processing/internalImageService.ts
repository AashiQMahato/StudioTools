import { AppError, type ErrorCode } from "../../utils/AppError.js";
import { imageService } from "../image-service/imageServiceProcess.js";
import { fetchBuffered } from "../../utils/fetchBuffered.js";

/**
 * Calls the internal Python image service (the one that runs background removal) with an image, using
 * its localhost address and per-launch token. Errors come back as safe AppErrors; the service's own
 * text is never passed through.
 */
export async function postToImageService(path: string, image: Buffer, fileName: string, signal: AbortSignal, timeoutMs: number, unavailable: { code: ErrorCode; message: string }): Promise<Response> {
    const connection = imageService.connection;
    if (!connection) throw new AppError(unavailable.message, 503, unavailable.code);

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(image)]), fileName);
    let response: Response;
    try {
        response = await fetchBuffered(`${connection.url}${path}`, {
            method: "POST",
            body: form,
            headers: { "x-internal-token": connection.token },
            signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        });
    } catch (error) {
        if (signal.aborted) throw new AppError("The request was cancelled.", 499, "REQUEST_CANCELLED");
        if (error instanceof Error && error.name === "TimeoutError") throw new AppError("Processing took too long. Please try a smaller image.", 504, "PROCESSING_TIMEOUT");
        throw new AppError(unavailable.message, 503, unavailable.code);
    }
    if (response.ok) return response;

    const body = (await response.json().catch(() => null)) as { code?: string } | null;
    switch (body?.code) {
        case "INVALID_IMAGE":
            throw new AppError("This file couldn't be read as an image. It may be damaged.", 422, "INVALID_IMAGE");
        case "UNSUPPORTED_MEDIA_TYPE":
            throw new AppError("This image format isn't supported. Please use a JPG, PNG, WebP or HEIC photo.", 415, "UNSUPPORTED_MEDIA_TYPE");
        case "FILE_TOO_LARGE":
            throw new AppError("The image is too large.", 413, "FILE_TOO_LARGE");
        default:
            if (response.status === 503) throw new AppError(unavailable.message, 503, unavailable.code);
            throw new AppError("Processing failed. Please try again.", 502, "PROCESSING_FAILED");
    }
}
