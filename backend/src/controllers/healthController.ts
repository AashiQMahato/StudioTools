import { existsSync } from "node:fs";
import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { imageService } from "../services/image-service/imageServiceProcess.js";
import { BACKGROUND_REMOVAL_MODEL, backgroundRemoval, backgroundRemovalDisabled } from "../services/background-removal/backgroundRemovalService.js";
import { ocrProcess } from "../services/ocr/providers/paddleProvider.js";
import { getOcrProvider } from "../services/ocr/providers/index.js";
import { retouching } from "../services/retouch/retouchService.js";
import { upscaylProvider } from "../services/upscaling/upscaylProvider.js";
import { upscaling } from "../services/upscaling/upscaleService.js";

export const getHealth: RequestHandler = (_req, res) => {
    res.json({
        success: true,
        message: "Studio Tools API is running",
        services: {
            api: true,
            backgroundRemoval: backgroundRemoval.isAvailable(),
            upscaling: upscaling.isAvailable(),
            retouch: retouching.isAvailable(),
        },
    });
};

/** Processor details for operators and the frontend. No paths, tokens or raw errors. */
export const getProcessorHealth: RequestHandler = async (_req, res) => {
    const ocrProvider = await getOcrProvider().catch(() => null);
    const service = imageService.state;
    const upscayl = upscaylProvider.state;
    res.json({
        success: true,
        data: {
            backgroundRemoval: {
                available: backgroundRemoval.isAvailable(),
                // Switched off on this server (not just starting up): the site says so instead of offering it.
                disabled: backgroundRemovalDisabled(),
                message: backgroundRemovalDisabled() ? "Background removal isn't available on this server." : null,
                status: service.status,
                engine: "birefnet",
                model: BACKGROUND_REMOVAL_MODEL,
                queue: backgroundRemoval.stats(),
            },
            upscaling: {
                available: upscaling.isAvailable(),
                status: upscayl.status,
                reason: upscayl.reason,
                message: upscaling.isAvailable() ? null : upscaylProvider.unavailableMessage,
                engine: "upscayl-ncnn",
                model: upscayl.model,
                gpuAcceleration: upscayl.status === "ready",
                gpu: upscayl.gpu,
                scales: [2, 4],
                queue: upscaling.stats(),
            },
            photoGenerator: {
                // Needs the image service (background removal, face detection, conversion) and the face model.
                available: backgroundRemoval.isAvailable() && existsSync(env.photoGenerator.faceModelPath),
                faceModelInstalled: existsSync(env.photoGenerator.faceModelPath),
                disabled: backgroundRemovalDisabled(),
                message: backgroundRemovalDisabled() ? "Passport and MRP photos aren't available on this server." : null,
            },
            ocr: {
                // PaddleOCR starts on the first request, so "disabled" here just means "not started yet".
                available: ocrProvider !== null,
                provider: ocrProvider?.name ?? null,
                status: ocrProcess.state.status,
            },
            retouch: {
                available: retouching.isAvailable(),
                engines: retouching.engines(),
                queue: retouching.stats(),
            },
            limits: {
                maxFileSizeMb: env.maxImageSizeMb,
                formats: ["image/jpeg", "image/png", "image/webp"],
            },
        },
    });
};
