import "dotenv/config";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** backend/ — config paths are resolved from here, not from the process working directory. */
export const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parsePort(value: string | undefined, fallback: number): number {
    const port = Number(value);
    return Number.isInteger(port) && port > 0 ? port : fallback;
}

function parsePositive(value: string | undefined, fallback: number): number {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined || value.trim() === "") return fallback;
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseChoice<T extends string>(value: string | undefined, choices: readonly T[], fallback: T): T {
    const chosen = value?.trim().toLowerCase();
    return choices.find((choice) => choice === chosen) ?? fallback;
}

function parseOrigins(value: string | undefined): string[] {
    return (value ?? "http://localhost:5173")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
}

/** Resolve an optional path setting relative to backend/. */
function resolvePath(value: string | undefined, fallback: string): string {
    const chosen = value?.trim() ? value.trim() : fallback;
    return path.isAbsolute(chosen) ? chosen : path.resolve(BACKEND_ROOT, chosen);
}

const env_ = process.env;

export const env = {
    nodeEnv: env_.NODE_ENV ?? "development",
    port: parsePort(env_.PORT, 5000),
    /** Proxies in front of the API (a tunnel, a host's load balancer): set so each visitor is counted on their own address, not the proxy's. */
    trustProxy: Math.floor(parsePositive(env_.TRUST_PROXY, 0)),
    /** Allowed CORS origins. FRONTEND_URL may be a comma-separated list. */
    frontendOrigins: parseOrigins(env_.FRONTEND_URL),
    /** A small server (e.g. 512 MB): no decoded-image cache, one image-processing thread. */
    lowMemory: parseBoolean(env_.LOW_MEMORY, false),

    maxImageSizeMb: parsePositive(env_.MAX_IMAGE_SIZE_MB, 10),
    /** Largest decoded image accepted (pixels). Guards against decompression bombs. */
    maxImagePixels: parsePositive(env_.MAX_IMAGE_PIXELS, 40_000_000),

    /** The internal Python image service (background removal, conversion, detection, inpainting, PDFs). */
    imageService: {
        /** Launch it as a managed child process. Disable to run it separately (set IMAGE_SERVICE_URL). */
        autostart: parseBoolean(env_.IMAGE_SERVICE_AUTOSTART ?? env_.REMBG_AUTOSTART, true),
        serviceUrl: (env_.IMAGE_SERVICE_URL ?? env_.REMBG_SERVICE_URL)?.trim() || "",
        serviceToken: (env_.IMAGE_SERVICE_TOKEN ?? env_.REMBG_SERVICE_TOKEN)?.trim() || "",
        pythonPath: resolvePath(env_.IMAGE_SERVICE_PYTHON_PATH ?? env_.REMBG_PYTHON_PATH, "python/.venv/bin/python"),
        serviceDir: resolvePath(undefined, "python/image_service"),
        /** ONNX models (faces, text, LaMa). */
        modelsDir: resolvePath(env_.MODELS_DIR ?? env_.REMBG_MODELS_DIR, "python/.models"),
        /** BiRefNet-Massive's folder (put there once by scripts/setup-ml.sh, then only read). */
        birefnetPath: resolvePath(env_.BIREFNET_MODEL_PATH, "python/.models/birefnet-massive"),
    },

    backgroundRemoval: {
        /** Off on a small server (the models need a few GB). REMBG_MODEL=none is the old way to say it. */
        enabled: parseBoolean(env_.BACKGROUND_REMOVAL, env_.REMBG_MODEL?.trim() !== "none"),
        /** auto (CUDA, then Apple MPS, then CPU) | cuda | mps | cpu */
        device: parseChoice(env_.BIREFNET_DEVICE, ["auto", "cuda", "mps", "cpu"] as const, "auto"),
        timeoutMs: parsePositive(env_.BACKGROUND_REMOVAL_TIMEOUT_MS ?? env_.REMBG_TIMEOUT_MS, 120_000),
        /** Cut-outs made at once (the models run one at a time in the service; this bounds the queue). */
        concurrency: Math.floor(parsePositive(env_.BACKGROUND_REMOVAL_CONCURRENCY, 1)),
    },

    upscayl: {
        enabled: parseBoolean(env_.UPSCAYL_ENABLED, true),
        binaryPath: resolvePath(env_.UPSCAYL_BINARY_PATH, "vendor/upscayl/upscayl-bin"),
        modelsDir: resolvePath(env_.UPSCAYL_MODELS_PATH, "vendor/upscayl/models"),
        model: env_.UPSCAYL_MODEL?.trim() || "upscayl-standard-4x",
        timeoutMs: parsePositive(env_.UPSCALE_TIMEOUT_MS, 300_000),
        concurrency: Math.floor(parsePositive(env_.UPSCALE_CONCURRENCY, 1)),
        /** Largest result allowed (pixels). 4× multiplies pixel count by 16, so 4× accepts smaller inputs than 2×. */
        maxOutputPixels: parsePositive(env_.UPSCALE_MAX_OUTPUT_PIXELS, 40_000_000),
    },

    retouch: {
        /** "auto" uses the AI inpainting service when RETOUCH_SERVICE_URL is set, else the built-in engine. */
        provider: parseChoice(env_.RETOUCH_PROVIDER, ["auto", "local", "lama", "iopaint"] as const, "auto"),
        /** LaMa inpainting model (ONNX), downloaded by scripts/setup-ml.sh. */
        lamaModelPath: resolvePath(env_.INPAINT_MODEL, "python/.models/lama_fp32.onnx"),
        /** Base URL of an IOPaint server (LaMa inpainting), e.g. http://127.0.0.1:8080. */
        serviceUrl: (env_.RETOUCH_SERVICE_URL?.trim() || "").replace(/\/$/, ""),
        timeoutMs: parsePositive(env_.RETOUCH_TIMEOUT_MS, 120_000),
        concurrency: Math.floor(parsePositive(env_.RETOUCH_CONCURRENCY, 2)),
        /** Longest side of the region handed to a provider. Larger selections are processed scaled down, then blended back at full size. */
        maxWorkingSize: Math.floor(parsePositive(env_.RETOUCH_MAX_WORKING_SIZE, 2048)),
    },

    documents: {
        /** Where uploads and results live while a job runs: outside anything served, wiped on start and after each job. */
        tempDir: resolvePath(env_.DOCUMENTS_TEMP_DIR, path.join(os.tmpdir(), "studio-tools-documents")),
        maxPdfMb: parsePositive(env_.DOCUMENTS_MAX_PDF_MB, 100),
        maxImageMb: parsePositive(env_.DOCUMENTS_MAX_IMAGE_MB, 25),
        /** All files in one request together. */
        maxTotalMb: parsePositive(env_.DOCUMENTS_MAX_TOTAL_MB, 250),
        /** Files in one request (PDFs to merge, images to combine). */
        maxFiles: Math.floor(parsePositive(env_.DOCUMENTS_MAX_FILES, 50)),
        /** Pages any one document may have, and pages one job may produce. */
        maxPages: Math.floor(parsePositive(env_.DOCUMENTS_MAX_PAGES, 2000)),
        /** Finished results are downloadable for this long, then deleted. */
        resultTtlMinutes: parsePositive(env_.DOCUMENTS_RESULT_TTL_MINUTES, 30),
        concurrency: Math.floor(parsePositive(env_.DOCUMENTS_CONCURRENCY, 2)),
        /** Largest page image rendered (pixels), whatever the resolution asked for. */
        maxRenderPixels: parsePositive(env_.DOCUMENTS_MAX_RENDER_PIXELS, 60_000_000),
    },

    ocr: {
        /** "auto": PaddleOCR when its environment is installed, else Tesseract if it's on this machine. */
        provider: parseChoice(env_.OCR_PROVIDER, ["auto", "paddle", "tesseract"] as const, "auto"),
        /** PaddleOCR runs in its own Python environment (it pins its own OpenCV/NumPy). */
        pythonPath: resolvePath(env_.OCR_PYTHON_PATH, "python/.venv-ocr/bin/python"),
        serviceDir: resolvePath(undefined, "python/ocr_service"),
        modelsDir: resolvePath(env_.OCR_MODELS_DIR, "python/.models/paddlex"),
        tesseractPath: env_.TESSERACT_PATH?.trim() || "tesseract",
        timeoutMs: parsePositive(env_.OCR_TIMEOUT_MS, 180_000),
        concurrency: Math.floor(parsePositive(env_.OCR_CONCURRENCY, 1)),
    },

    compression: {
        concurrency: Math.floor(parsePositive(env_.COMPRESSION_CONCURRENCY, 2)),
    },

    watermark: {
        /** PP-OCRv3 text detector (downloaded by scripts/setup-ml.sh), for finding text watermarks. */
        textModelPath: resolvePath(env_.TEXT_DETECTOR_MODEL, "python/.models/text_detection_en_ppocrv3_2023may.onnx"),
        /** Which detector finds watermarks. "opencv" is the built-in one (text model + overlay analysis). */
        detectionProvider: parseChoice(env_.WATERMARK_DETECTION_PROVIDER, ["opencv"] as const, "opencv"),
        /** Which inpainting engine rebuilds the removed area; "auto" follows RETOUCH_PROVIDER. */
        removalProvider: parseChoice(env_.WATERMARK_REMOVAL_PROVIDER, ["auto", "local", "lama", "iopaint"] as const, "auto"),
        timeoutMs: parsePositive(env_.WATERMARK_TIMEOUT_MS, 60_000),
    },

    photoGenerator: {
        /** OpenCV YuNet face model, downloaded by scripts/setup-ml.sh. */
        faceModelPath: resolvePath(env_.FACE_DETECTOR_MODEL, "python/.models/face_detection_yunet_2023mar.onnx"),
        /** Output resolution per preset. Physical size is fixed by the preset; DPI is the operator's choice. */
        passportDpi: Math.floor(parsePositive(env_.PHOTO_PASSPORT_DPI, 300)),
        mrpDpi: Math.floor(parsePositive(env_.PHOTO_MRP_DPI, 600)),
        concurrency: Math.floor(parsePositive(env_.PHOTO_GENERATOR_CONCURRENCY, 2)),
        /** Head tilt (eye-line roll) straightened automatically, in degrees; beyond it the photo is refused. */
        maxAutoRotationDeg: parsePositive(env_.MAX_AUTO_ROTATION, 15),
        /** How long generated photos stay downloadable (in memory only), in minutes. */
        fileTtlMinutes: parsePositive(env_.PHOTO_FILE_TTL_MINUTES, 30),
        timeoutMs: parsePositive(env_.PHOTO_GENERATOR_TIMEOUT_MS, 60_000),
    },

    /** Requests waiting for a processing slot beyond this are turned away with "busy". */
    maxQueuedJobs: Math.floor(parsePositive(env_.PROCESSING_MAX_QUEUE, 8)),
    /** Processing requests per client per 15 minutes. */
    processingRateLimit: Math.floor(parsePositive(env_.PROCESSING_RATE_LIMIT, 60)),
} as const;

export const isProduction = env.nodeEnv === "production";
