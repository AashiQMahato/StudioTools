import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";
import { env } from "../config/env.js";
import type { ApiFailure } from "../types/api.js";
import { AppError } from "../utils/AppError.js";

export const notFoundHandler: RequestHandler = (req, res) => {
    const body: ApiFailure = { success: false, message: `Route not found: ${req.method} ${req.path}`, code: "NOT_FOUND" };
    res.status(404).json(body);
};

function fromMulter(error: multer.MulterError): AppError {
    switch (error.code) {
        case "LIMIT_FILE_SIZE":
            return new AppError(`The image is too large. Please upload an image under ${env.maxImageSizeMb} MB.`, 413, "FILE_TOO_LARGE");
        case "LIMIT_UNEXPECTED_FILE":
            return new AppError('Send the image as a single "file" field.', 400, "FILE_REQUIRED");
        default:
            return new AppError("The upload couldn't be processed.", 400, "FILE_REQUIRED");
    }
}

/** A JSON body that doesn't parse (express.json's own error). */
const isBadJson = (err: unknown) => err instanceof SyntaxError && (err as { type?: string }).type === "entity.parse.failed";

/** Every error leaves as a safe, user-facing message. Anything unexpected is logged and reported generically. */
export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    const error = err instanceof AppError ? err : err instanceof multer.MulterError ? fromMulter(err) : isBadJson(err) ? new AppError("The request couldn't be read.", 400, "INVALID_REQUEST") : null;

    if (!error) console.error(err);
    // The client has gone; there is no one to answer.
    if (res.headersSent || res.destroyed || error?.code === "REQUEST_CANCELLED") {
        if (!res.headersSent && !res.destroyed) res.status(499).end();
        return;
    }

    const body: ApiFailure = error
        ? { success: false, message: error.message, code: error.code }
        : { success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" };
    res.status(error?.statusCode ?? 500).json(body);
};
