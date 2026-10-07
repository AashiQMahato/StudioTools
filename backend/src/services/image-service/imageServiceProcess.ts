import { env } from "../../config/env.js";
import { PythonService, type ServiceStatus } from "../../utils/pythonService.js";

export type ImageServiceStatus = ServiceStatus;

/**
 * The internal Python image service: background removal (BiRefNet-Massive), format
 * conversion, face and watermark detection, inpainting and PDF work. Launched with the API (or reached at
 * IMAGE_SERVICE_URL when run separately).
 */
const service = new PythonService({
    name: "Image service",
    tag: "[image-service]",
    pythonPath: () => env.imageService.pythonPath,
    cwd: () => env.imageService.serviceDir,
    setupHint: "Run scripts/setup-ml.sh.",
    external: () => {
        if (env.imageService.autostart) return null;
        if (!env.imageService.serviceUrl) return { error: "IMAGE_SERVICE_AUTOSTART is off and IMAGE_SERVICE_URL is not set." };
        return { url: env.imageService.serviceUrl.replace(/\/$/, ""), token: env.imageService.serviceToken };
    },
    env: () => ({
        BACKGROUND_REMOVAL: env.backgroundRemoval.enabled ? "on" : "off",
        BIREFNET_DEVICE: env.backgroundRemoval.device,
        BIREFNET_MODEL_PATH: env.imageService.birefnetPath,
        MODELS_DIR: env.imageService.modelsDir,
        // The model is read from its local folder only: nothing is downloaded while serving.
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        FACE_DETECTOR_MODEL: env.photoGenerator.faceModelPath,
        TEXT_DETECTOR_MODEL: env.watermark.textModelPath,
        INPAINT_MODEL: env.retouch.lamaModelPath,
        MAX_IMAGE_SIZE_MB: String(env.maxImageSizeMb),
        MAX_IMAGE_PIXELS: String(env.maxImagePixels),
        DOCUMENTS_TEMP_DIR: env.documents.tempDir,
        // Optional tuning, passed through as set.
        ...pick("BIREFNET_INPUT_SIZE", "BIREFNET_PRECISION", "BIREFNET_BATCH_SIZE", "BIREFNET_WARMUP", "MASK_REMOVE_SPECKS", "MASK_FILL_HOLES", "MASK_DECONTAMINATE", "ONNX_PROVIDERS"),
    }),
});

function pick(...names: string[]): Record<string, string> {
    return Object.fromEntries(names.flatMap((name) => (process.env[name] ? [[name, process.env[name] as string]] : [])));
}

export const imageService = {
    get state() {
        return service.state;
    },
    get connection() {
        return service.connection;
    },
    start: () => service.start(),
    stop: () => service.stop(),
};
