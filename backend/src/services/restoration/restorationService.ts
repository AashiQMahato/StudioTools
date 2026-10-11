import { existsSync } from "node:fs";
import sharp from "sharp";
import { env } from "../../config/env.js";
import type { ImageInput, ImageOutput, ProcessingContext } from "../../types/image.js";
import { AppError } from "../../utils/AppError.js";
import { ConcurrencyLimiter } from "../../utils/concurrency.js";
import { encodeLike } from "../image-processing/encode.js";
import { postToImageService } from "../image-processing/internalImageService.js";
import { imageService } from "../image-service/imageServiceProcess.js";
import { upscaling } from "../upscaling/upscaleService.js";

/**
 * Photo restoration: independent steps, each run by its own provider and available on its own. They
 * always run in this order — grain first (it hides scratches from the detector), then damage, levels
 * before colour, faces on the finished colours, enlargement last — whatever order they were asked in.
 */
export const RESTORE_OPERATIONS = ["denoise", "scratches", "fade", "colorize", "faces", "upscale"] as const;
export type RestoreOperation = (typeof RESTORE_OPERATIONS)[number];

/** Why a step can't run here: the image service is still starting, a model isn't installed, or the engine is off on this server. */
export type UnavailableReason = "starting" | "model-missing" | "disabled";

export interface RestoreCapability {
    id: RestoreOperation;
    available: boolean;
    /** The engine that runs it here (what the page tells people). */
    engine: string;
    /** AI model, or classical image processing. */
    kind: "ai" | "classical";
    reason: UnavailableReason | null;
}

/** What one step did: its engine, or why it changed nothing (e.g. the photo already had colour). */
export interface RestoreStep {
    id: RestoreOperation;
    engine: string | null;
    skipped: string | null;
    /** Faces restored, and faces left alone (too small or turned away) — the faces step only. */
    faces?: { restored: number; skipped: number };
}

export function capabilities(): RestoreCapability[] {
    const service: UnavailableReason | null = imageService.connection ? null : "starting";
    const model = (path: string): UnavailableReason | null => (existsSync(path) ? service : "model-missing");
    const lama = existsSync(env.retouch.lamaModelPath);
    const all: RestoreCapability[] = [
        { id: "denoise", available: !service, engine: "opencv-nlmeans", kind: "classical", reason: service },
        { id: "scratches", available: !service, engine: lama ? "lama-onnx" : "opencv-telea", kind: lama ? "ai" : "classical", reason: service },
        { id: "fade", available: !service, engine: "opencv-clahe", kind: "classical", reason: service },
        { id: "colorize", available: !model(env.restoration.colorizationModelPath), engine: "eccv16-onnx", kind: "ai", reason: model(env.restoration.colorizationModelPath) },
        {
            id: "faces",
            available: !model(env.restoration.faceRestoreModelPath) && !model(env.photoGenerator.faceModelPath),
            engine: "gfpgan-1.4-onnx",
            kind: "ai",
            reason: model(env.restoration.faceRestoreModelPath) ?? model(env.photoGenerator.faceModelPath),
        },
        { id: "upscale", available: upscaling.isAvailable(), engine: "real-esrgan-upscayl", kind: "ai", reason: upscaling.isAvailable() ? null : "disabled" },
    ];
    return all;
}

/** "fade,scratches" → ["scratches", "fade"]: known steps only, each once, in pipeline order. */
export function parseOperations(value: unknown): RestoreOperation[] {
    const asked = String(value ?? "")
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);
    if (asked.length === 0 || asked.some((part) => !RESTORE_OPERATIONS.includes(part as RestoreOperation))) {
        throw new AppError("Choose at least one restoration step.", 400, "INVALID_OPERATIONS");
    }
    return RESTORE_OPERATIONS.filter((operation) => asked.includes(operation));
}

const unavailable = (operation: RestoreOperation) =>
    new AppError(`The "${operation}" restoration step isn't available on this server right now.`, 503, "RESTORATION_UNAVAILABLE");

/** One step in the image service: PNG in, PNG out, with what it did in the headers. */
async function serviceStep(operation: Exclude<RestoreOperation, "upscale">, png: Buffer, signal: AbortSignal): Promise<{ png: Buffer; step: RestoreStep }> {
    const response = await postToImageService(`/restore/${operation}`, png, "step.png", signal, env.restoration.stepTimeoutMs, {
        code: "RESTORATION_UNAVAILABLE",
        message: unavailable(operation).message,
    });
    const step: RestoreStep = { id: operation, engine: response.headers.get("x-engine"), skipped: response.headers.get("x-skipped") };
    if (operation === "faces") step.faces = { restored: Number(response.headers.get("x-faces") ?? 0), skipped: Number(response.headers.get("x-faces-skipped") ?? 0) };
    return { png: Buffer.from(await response.arrayBuffer()), step };
}

async function upscaleStep(png: Buffer, originalName: string, context: ProcessingContext): Promise<{ png: Buffer; step: RestoreStep }> {
    const { width = 0, height = 0 } = await sharp(png).metadata();
    const output = await upscaling.upscale({ buffer: png, originalName, format: "png", width, height, hasAlpha: false }, { scale: 2 }, context);
    return { png: output.buffer, step: { id: "upscale", engine: "real-esrgan-upscayl", skipped: null } };
}

const limiter = new ConcurrencyLimiter(env.restoration.concurrency, env.maxQueuedJobs);

/**
 * Runs the chosen steps one after another on a lossless copy of the upright photo, then encodes the
 * result like the upload (JPEG stays JPEG). The original upload is never modified. Every requested step
 * must be available before anything runs, so no one waits through half a restoration to hear "no".
 */
async function restore(input: ImageInput, operations: readonly RestoreOperation[], context: ProcessingContext): Promise<{ output: ImageOutput; steps: RestoreStep[] }> {
    const ready = new Map(capabilities().map((capability) => [capability.id, capability.available]));
    const missing = operations.find((operation) => !ready.get(operation));
    if (missing) throw unavailable(missing);

    // Restoration works on photos: transparency (rare in old prints) is flattened onto white.
    let png: Buffer = await sharp(input.buffer, { limitInputPixels: env.maxImagePixels }).rotate().flatten({ background: "#ffffff" }).png({ compressionLevel: 1 }).toBuffer();
    const steps: RestoreStep[] = [];
    for (const operation of operations) {
        if (context.signal.aborted) throw new AppError("The request was cancelled.", 499, "REQUEST_CANCELLED");
        const result = operation === "upscale" ? await upscaleStep(png, input.originalName, context) : await serviceStep(operation, png, context.signal);
        png = result.png;
        steps.push(result.step);
    }
    return { output: await encodeLike(sharp(png, { limitInputPixels: false }), input), steps };
}

export const restoration = {
    capabilities,
    stats: () => limiter.stats,
    restore: (input: ImageInput, operations: readonly RestoreOperation[], context: ProcessingContext) => limiter.run(() => restore(input, operations, context), context.signal),
};
