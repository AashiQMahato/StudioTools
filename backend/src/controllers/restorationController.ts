import type { RequestHandler } from "express";
import { validateImage } from "../services/image-processing/imageValidation.service.js";
import { parseOperations, restoration } from "../services/restoration/restorationService.js";
import { processingContext, safeBaseName, sendImage } from "../utils/http.js";

/** Which steps this server can run, and with what. No paths or model locations. */
export const restoreCapabilitiesHandler: RequestHandler = (_req, res) => {
    res.json({ success: true, data: { operations: restoration.capabilities() } });
};

export const restoreHandler: RequestHandler = async (req, res) => {
    const operations = parseOperations((req.body as Record<string, unknown> | undefined)?.operations);
    const input = await validateImage(req.file);
    const { output, steps } = await restoration.restore(input, operations, processingContext(req, res));
    // What each step actually did (engine, or why it changed nothing), so the page never overclaims.
    res.set("X-Restore-Steps", JSON.stringify(steps));
    sendImage(res, output, `${safeBaseName(input.originalName)}-restored.${output.extension}`, input);
};
