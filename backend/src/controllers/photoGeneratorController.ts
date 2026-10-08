import type { RequestHandler } from "express";
import sharp from "sharp";
import { photoGenerator } from "../services/photo-generator/photoGeneratorService.js";
import { prepareImage } from "../services/photo-generator/formatConversionService.js";
import { AppError } from "../utils/AppError.js";
import { processingContext, safeBaseName } from "../utils/http.js";

const requireFile = (file: Express.Multer.File | undefined) => {
    if (!file || file.size === 0) throw new AppError("Please choose an image to upload.", 400, "FILE_REQUIRED");
    return file;
};

export const presetsHandler: RequestHandler = (_req, res) => {
    res.json({ success: true, data: photoGenerator.presets() });
};

/**
 * Streams progress as newline-delimited JSON — one event per line, the result (or an error) last — so
 * the page shows each step as it really happens. Once streaming, errors travel as events too.
 */
export const processHandler: RequestHandler = async (req, res) => {
    const file = requireFile(req.file);
    const preset = (req.body as Record<string, unknown> | undefined)?.preset;
    const context = processingContext(req, res);

    res.status(200).set({ "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const send = (event: object) => {
        if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };
    try {
        const result = await photoGenerator.generate(file.buffer, file.originalname, preset, send, context);
        send({ type: "result", data: result });
    } catch (error) {
        if (context.signal.aborted) return void res.end();
        if (!(error instanceof AppError)) console.error(error);
        const safe = error instanceof AppError ? error : new AppError("We couldn't create the photo from this image. Please try a clear, front-facing photo with one person.", 500, "PROCESSING_FAILED");
        send({ type: "error", code: safe.code, message: safe.message });
    }
    res.end();
};

export const adjustCropHandler: RequestHandler = async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({ success: true, data: await photoGenerator.adjustCrop(body.workId, body.crop) });
};

/** Fine-tunes the head's straightening by hand: the photo made again at that angle (no new background removal). */
export const rotateHandler: RequestHandler = async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({ success: true, data: await photoGenerator.rotate(body.sourceId, body.angle, processingContext(req, res)) });
};

export const sheetHandler: RequestHandler = async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({ success: true, data: await photoGenerator.createSheet(body.photoId, body.copies) });
};

/** A generated file, by its unguessable id. `?download=1` asks the browser to save it. */
export const fileHandler: RequestHandler = (req, res) => {
    const entry = photoGenerator.file(String(req.params.id ?? ""));
    if (!entry) throw new AppError("This file has expired. Please create the photo again.", 404, "FILE_EXPIRED");
    res.status(200)
        .set({
            "Content-Type": entry.mimeType,
            "Content-Length": String(entry.buffer.length),
            "Content-Disposition": `${req.query.download ? "attachment" : "inline"}; filename="${entry.fileName}"`,
            "Cache-Control": "private, no-store",
            // Images may be shown by the frontend on another origin in production.
            "Cross-Origin-Resource-Policy": "cross-origin",
        })
        .end(entry.buffer);
};

/**
 * Any supported photo → an upright JPEG (or the original, if it already was one of JPG/PNG/WebP and
 * upright), so every tool can open HEIC and friends.
 */
export const convertHandler: RequestHandler = async (req, res) => {
    const file = requireFile(req.file);
    const image = await prepareImage(file.buffer, processingContext(req, res).signal);
    const { width, height } = await sharp(image.buffer).metadata();
    res.status(200)
        .set({
            "Content-Type": "image/jpeg",
            "Content-Length": String(image.buffer.length),
            "Content-Disposition": `inline; filename="${safeBaseName(file.originalname)}.jpg"`,
            "Cache-Control": "no-store",
            "X-Image-Width": String(width ?? image.width),
            "X-Image-Height": String(height ?? image.height),
            "X-Source-Format": image.sourceFormat,
        })
        .end(image.buffer);
};
