import { existsSync } from "node:fs";
import sharp from "sharp";
import { env } from "../../../config/env.js";
import type { ProcessingContext, RawImage, RawMask, RetouchMode, RetouchOptions, RetouchProvider } from "../../../types/image.js";
import { AppError } from "../../../utils/AppError.js";
import { imageService } from "../../image-service/imageServiceProcess.js";
import { fetchBuffered } from "../../../utils/fetchBuffered.js";

const failed = () => new AppError("We couldn't process this image. Please try again.", 502, "PROCESSING_FAILED");
const unavailable = () => new AppError("Retouching is temporarily unavailable. Please try again in a moment.", 503, "RETOUCH_UNAVAILABLE");

/**
 * AI inpainting with LaMa (Apache-2.0), run by ONNX Runtime inside the internal Python service — no
 * GPU, PyTorch or extra server needed. It reconstructs what's under the mask from the scene around it,
 * far beyond what filters can do. Available once scripts/setup-ml.sh has downloaded the model.
 */
class LamaProvider implements RetouchProvider {
    readonly name = "lama-onnx";

    isAvailable() {
        return imageService.connection !== null && existsSync(env.retouch.lamaModelPath);
    }

    supports(mode: RetouchMode) {
        return mode === "remove" || mode === "heal";
    }

    async retouch(image: RawImage, mask: RawMask, _options: RetouchOptions, { signal }: ProcessingContext): Promise<RawImage> {
        const connection = imageService.connection;
        if (!connection) throw unavailable();
        const { width, height } = image;
        const [imagePng, maskPng] = await Promise.all([
            sharp(image.data, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 1 }).toBuffer(),
            sharp(mask.data, { raw: { width, height, channels: 1 } }).png({ compressionLevel: 1 }).toBuffer(),
        ]);
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(imagePng)]), "region.png");
        form.append("mask", new Blob([new Uint8Array(maskPng)]), "mask.png");

        let response: Response;
        try {
            response = await fetchBuffered(`${connection.url}/inpaint`, {
                method: "POST",
                body: form,
                headers: { "x-internal-token": connection.token },
                signal: AbortSignal.any([signal, AbortSignal.timeout(env.retouch.timeoutMs)]),
            });
        } catch (error) {
            if (signal.aborted) throw new AppError("The request was cancelled.", 499, "REQUEST_CANCELLED");
            if (error instanceof Error && error.name === "TimeoutError") throw new AppError("Retouching took too long. Please try a smaller area.", 504, "PROCESSING_TIMEOUT");
            throw unavailable();
        }
        if (!response.ok) {
            if (response.status === 503) throw unavailable();
            throw failed();
        }
        try {
            const data = await sharp(Buffer.from(await response.arrayBuffer())).removeAlpha().resize(width, height, { fit: "fill" }).raw().toBuffer();
            return { data, width, height };
        } catch {
            throw failed();
        }
    }
}

export const lamaProvider = new LamaProvider();
