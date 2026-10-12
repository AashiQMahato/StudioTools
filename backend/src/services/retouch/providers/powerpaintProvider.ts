import sharp from "sharp";
import { env } from "../../../config/env.js";
import type { ProcessingContext, RawImage, RawMask, RetouchMode, RetouchOptions, RetouchProvider } from "../../../types/image.js";
import { AppError } from "../../../utils/AppError.js";
import { fetchBuffered } from "../../../utils/fetchBuffered.js";
import { inpaintService, premiumInpaintBlocker } from "../../inpaint-service/inpaintServiceProcess.js";

/**
 * High-quality filling with PowerPaint v2-1 (Stable Diffusion 1.5 + BrushNet, trained for object removal):
 * it continues textures and structure where LaMa smears them, at a cost of seconds per denoising step.
 * Runs in its own process, started on first use. Anything that goes wrong here is the caller's cue to fall
 * back to LaMa — see retouchService.
 */
class PowerPaintProvider implements RetouchProvider {
    readonly name = "powerpaint-v2-1";

    isAvailable() {
        return premiumInpaintBlocker() === null;
    }

    supports(mode: RetouchMode) {
        return mode === "remove" || mode === "heal";
    }

    async retouch(image: RawImage, mask: RawMask, _options: RetouchOptions, { signal }: ProcessingContext): Promise<RawImage> {
        const connection = await inpaintService.ensureReady();
        if (!connection) throw new AppError("High quality retouching isn't running.", 503, "RETOUCH_UNAVAILABLE");
        const { width, height } = image;
        const [imagePng, maskPng] = await Promise.all([
            sharp(image.data, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 1 }).toBuffer(),
            sharp(mask.data, { raw: { width, height, channels: 1 } }).png({ compressionLevel: 1 }).toBuffer(),
        ]);
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(imagePng)]), "region.png");
        form.append("mask", new Blob([new Uint8Array(maskPng)]), "mask.png");
        form.append("steps", String(env.premiumInpaint.steps));
        form.append("side", String(env.premiumInpaint.side));

        let response: Response;
        try {
            response = await fetchBuffered(`${connection.url}/inpaint`, {
                method: "POST",
                body: form,
                headers: { "x-internal-token": connection.token },
                signal: AbortSignal.any([signal, AbortSignal.timeout(env.premiumInpaint.timeoutMs)]),
            });
        } catch (error) {
            if (signal.aborted) throw new AppError("The request was cancelled.", 499, "REQUEST_CANCELLED");
            if (error instanceof Error && error.name === "TimeoutError") throw new AppError("High quality retouching took too long.", 504, "PROCESSING_TIMEOUT");
            throw new AppError("High quality retouching isn't running.", 503, "RETOUCH_UNAVAILABLE");
        }
        if (!response.ok) throw new AppError("High quality retouching failed.", 502, "PROCESSING_FAILED");
        const data = await sharp(Buffer.from(await response.arrayBuffer())).removeAlpha().resize(width, height, { fit: "fill" }).raw().toBuffer();
        return { data, width, height };
    }
}

export const powerpaintProvider = new PowerPaintProvider();
