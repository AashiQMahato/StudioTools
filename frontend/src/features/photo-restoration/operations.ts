import { Droplets, Eraser, type LucideIcon, Palette, ScanFace, SunMedium, ZoomIn } from "lucide-react";
import type { RestoreOperation, RestoreStep } from "@/lib/api/restoreApi";

export interface OperationConfig {
    id: RestoreOperation;
    icon: LucideIcon;
    /** Chosen when a photo opens: the gentle, classical clean-up. AI steps that redraw detail are opt-in. */
    byDefault: boolean;
}

/** In the order the server runs them. */
export const OPERATIONS: readonly OperationConfig[] = [
    { id: "denoise", icon: Droplets, byDefault: true },
    { id: "scratches", icon: Eraser, byDefault: true },
    { id: "fade", icon: SunMedium, byDefault: true },
    { id: "colorize", icon: Palette, byDefault: false },
    { id: "faces", icon: ScanFace, byDefault: false },
    { id: "upscale", icon: ZoomIn, byDefault: false },
];

/** The default selection for a photo: colorize joins it when the photo is black-and-white (or sepia). */
export function defaultSelection(monochrome: boolean): RestoreOperation[] {
    return OPERATIONS.filter((operation) => operation.byDefault || (monochrome && operation.id === "colorize")).map((operation) => operation.id);
}

/**
 * Whether RGBA pixels are monochrome (grey or a single tint such as sepia): how much the colour varies
 * around its own average, not how colourful it is. Mirrors the server's check, so the page can suggest
 * colorizing up front; the server still decides (and says if it skipped).
 */
export function isMonochrome(rgba: Uint8ClampedArray): boolean {
    let count = 0;
    let sumU = 0;
    let sumV = 0;
    let sumUU = 0;
    let sumVV = 0;
    for (let index = 0; index < rgba.length; index += 4) {
        const r = rgba[index]!;
        const g = rgba[index + 1]!;
        const b = rgba[index + 2]!;
        // Opponent colour axes (a simple stand-in for Lab a/b).
        const u = r - g;
        const v = (r + g) / 2 - b;
        sumU += u;
        sumV += v;
        sumUU += u * u;
        sumVV += v * v;
        count++;
    }
    if (count === 0) return false;
    const spread = (sum: number, squares: number) => Math.sqrt(Math.max(0, squares / count - (sum / count) ** 2));
    return Math.max(spread(sumU, sumUU), spread(sumV, sumVV)) < 9;
}

/** Engine ids as people should read them. */
export const ENGINE_NAMES: Record<string, string> = {
    "lama-onnx": "LaMa",
    "opencv-telea": "OpenCV Telea",
    "opencv-nlmeans": "OpenCV NL-means",
    "opencv-clahe": "OpenCV CLAHE",
    "eccv16-onnx": "ECCV16 colorization",
    "gfpgan-1.4-onnx": "GFPGAN 1.4",
    "real-esrgan-upscayl": "Real-ESRGAN",
};

export const engineName = (engine: string | null) => (engine ? (ENGINE_NAMES[engine] ?? engine) : "");

/** The X-Restore-Steps header, read defensively: anything malformed is treated as "no report". */
export function parseSteps(header: string | null): RestoreStep[] {
    if (!header) return [];
    try {
        const steps = JSON.parse(header) as unknown;
        return Array.isArray(steps) ? steps.filter((step): step is RestoreStep => typeof step === "object" && step !== null && typeof (step as RestoreStep).id === "string") : [];
    } catch {
        return [];
    }
}
