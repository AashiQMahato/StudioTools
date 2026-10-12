import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { env } from "../../config/env.js";
import { PythonService } from "../../utils/pythonService.js";

/**
 * The premium inpainting service (PowerPaint). Started the first time it's needed, not with the API: it's
 * only for the High quality setting, and its model is large.
 */
const service = new PythonService({
    name: "Inpaint service",
    tag: "[inpaint-service]",
    pythonPath: () => env.premiumInpaint.pythonPath,
    cwd: () => env.premiumInpaint.serviceDir,
    setupHint: "Run scripts/setup-ml.sh with PREMIUM_INPAINT=on.",
    env: () => ({
        MODELS_DIR: env.premiumInpaint.modelsDir,
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        MAX_IMAGE_SIZE_MB: String(env.maxImageSizeMb),
        ...(process.env.INPAINT_DEVICE ? { INPAINT_DEVICE: process.env.INPAINT_DEVICE } : {}),
        ...(process.env.INPAINT_IDLE_SECONDS ? { INPAINT_IDLE_SECONDS: process.env.INPAINT_IDLE_SECONDS } : {}),
    }),
});

/** Why High quality can't run here, or null when it can: not installed, switched off, or too little memory. */
export function premiumInpaintBlocker(): "not-installed" | "off" | "low-memory" | null {
    const { mode, modelsDir, pythonPath, minMemoryGb } = env.premiumInpaint;
    if (mode === "off") return "off";
    if (!existsSync(pythonPath) || !existsSync(path.join(modelsDir, "powerpaint-fp16", "unet"))) return "not-installed";
    if (mode === "auto" && os.totalmem() / 1024 ** 3 < minMemoryGb) return "low-memory";
    return null;
}

export const inpaintService = {
    ensureReady: () => service.ensureReady(),
    stop: () => service.stop(),
};
