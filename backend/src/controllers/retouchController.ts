import type { RequestHandler } from "express";
import { validateImage } from "../services/image-processing/imageValidation.service.js";
import { RETOUCH_MODES, retouching } from "../services/retouch/retouchService.js";
import type { RetouchMode } from "../types/image.js";
import { AppError } from "../utils/AppError.js";
import { processingContext, safeBaseName, sendImage } from "../utils/http.js";

/** "high" asks for the premium engine (it's used only where it's available); anything else is the fast default. */
const wantsHighQuality = (value: unknown) => value === "high";

/** Tells the page which engine really did the work, and when High quality was asked for but LaMa ran instead. */
const reportEngine = (res: Parameters<RequestHandler>[1]) => (engine: string, fellBack: boolean) => {
    res.set("X-Inpaint-Engine", engine);
    if (fellBack) res.set("X-Inpaint-Fallback", "1");
};

function parseMode(value: unknown): RetouchMode {
    if (!RETOUCH_MODES.includes(value as RetouchMode)) throw new AppError("Choose a retouch mode.", 400, "INVALID_MODE");
    return value as RetouchMode;
}

/** A 0–1 setting; anything missing or malformed falls back to the default rather than failing. */
function parseFraction(value: unknown, fallback: number): number {
    const number = Number(value);
    return value === undefined || value === "" || !Number.isFinite(number) ? fallback : Math.min(1, Math.max(0, number));
}

/** Object removal is AI inpainting only: without LaMa (local or IOPaint) it says so instead of degrading quietly. */
export const objectRemovalUnavailable = () =>
    new AppError("AI object removal isn't available on this server: it needs the LaMa inpainting model (run scripts/setup-ml.sh) or an IOPaint server (RETOUCH_SERVICE_URL).", 503, "OBJECT_REMOVAL_UNAVAILABLE");

export const removeObjectHandler: RequestHandler = async (req, res) => {
    const engine = retouching.aiInpainter();
    if (!engine) throw objectRemovalUnavailable();
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
    const input = await validateImage(files.file?.[0]);
    const mask = files.mask?.[0];
    if (!mask || mask.size === 0) throw new AppError("Brush over what you want removed first.", 400, "EMPTY_MASK");

    // Which model filled the area is reported back (never a classical fill: see aiInpainter).
    const high = wantsHighQuality((req.body as Record<string, unknown> | undefined)?.quality);
    const output = await retouching.retouch(input, mask.buffer, { mode: "remove", strength: 1, texture: 0 }, processingContext(req, res), high ? "powerpaint" : engine, reportEngine(res));
    sendImage(res, output, `${safeBaseName(input.originalName)}-object-removed.${output.extension}`, input);
};

export const retouchHandler: RequestHandler = async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const mode = parseMode(body.mode);
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
    const input = await validateImage(files.file?.[0]);
    const mask = files.mask?.[0];
    if (!mask || mask.size === 0) throw new AppError("Select an area to retouch first.", 400, "EMPTY_MASK");

    const options = { mode, strength: parseFraction(body.strength, 0.5), texture: parseFraction(body.texture, 0.6) };
    const output = await retouching.retouch(input, mask.buffer, options, processingContext(req, res), wantsHighQuality(body.quality) ? "powerpaint" : undefined, reportEngine(res));
    sendImage(res, output, `${safeBaseName(input.originalName)}-retouched.${output.extension}`, input);
};
