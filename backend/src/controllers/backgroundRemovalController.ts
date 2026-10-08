import type { RequestHandler } from "express";
import { BACKGROUND_REMOVAL_MODEL, type BackgroundRemovalMode, backgroundRemoval } from "../services/background-removal/backgroundRemovalService.js";
import { validateImage } from "../services/image-processing/imageValidation.service.js";
import { processingContext, safeBaseName, sendImage } from "../utils/http.js";

/** The subject on transparency, by BiRefNet-Massive: an RGBA PNG at the original resolution. */
export const removeBackgroundHandler: RequestHandler = async (req, res) => {
    const input = await validateImage(req.file);
    const requested = String(req.body?.mode ?? "quality");
    const mode: BackgroundRemovalMode = requested === "fast" || requested === "ultra" ? requested : "quality";
    const output = await backgroundRemoval.remove(input, processingContext(req, res), mode);
    res.setHeader("X-Model", BACKGROUND_REMOVAL_MODEL);
    if (output.timing) res.setHeader("Server-Timing", output.timing);
    if (output.mode) res.setHeader("X-Mode", output.mode);
    sendImage(res, output, `${safeBaseName(input.originalName)}-no-background.png`, input);
};

/** Is background removal ready, with which model and where (no paths). */
export const removeBackgroundStatusHandler: RequestHandler = async (_req, res) => {
    res.json({ success: true, data: await backgroundRemoval.status() });
};
