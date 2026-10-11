import type { RequestHandler } from "express";
import { translation } from "../services/translation/translationService.js";
import { processingContext } from "../utils/http.js";

/** `{ success, data: { available, provider, message } }` — never a URL or key. */
export const translateStatusHandler: RequestHandler = (_req, res) => {
    res.set("Cache-Control", "no-store").json({ success: true, data: translation.status() });
};

/** JSON `{ texts, source, target }` → `{ success, data: { translations, detectedSource?, provider } }`. */
export const translateHandler: RequestHandler = async (req, res) => {
    const data = await translation.translate(req.body, processingContext(req, res).signal);
    res.set("Cache-Control", "no-store").json({ success: true, data });
};
