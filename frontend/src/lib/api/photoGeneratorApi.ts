import { AI_API_BASE_URL, apiClient } from "./apiClient";
import { postNdjson } from "./ndjson";

/** A physical size in the unit the requirement uses (e.g. 1.1 × 1.322 in, 35 × 45 mm). */
export interface PhysicalSize {
    width: number;
    height: number;
    unit: "mm" | "in";
}

export interface PhotoPreset {
    id: string;
    name: string;
    size: PhysicalSize;
    widthMm: number;
    heightMm: number;
    dpi: number;
    width: number;
    height: number;
    background: string;
    sheet: { paper: string; maxCopies: number };
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export type StepId = "format" | "orientation" | "face" | "background" | "align" | "white" | "composition" | "resolution" | "finalize";
export type WarningCode = "LOW_RESOLUTION" | "BLURRY" | "TOO_DARK" | "TOO_BRIGHT" | "HEAD_TILTED" | "NOT_FACING" | "SMALL_FACE" | "HEAD_AT_EDGE";
export type CheckId = "aspectRatio" | "dimensions" | "dpi" | "whiteBackground" | "faceDetected" | "headVisible" | "headSize" | "centered" | "notStretched";

export interface QualityReport {
    ready: boolean;
    checks: { id: CheckId; ok: boolean }[];
}

export interface RenderedPhoto {
    imageUrl: string;
    pngUrl: string;
    photoId: string;
    width: number;
    height: number;
    widthMm: number;
    heightMm: number;
    size: PhysicalSize;
    dpi: number;
    format: "jpeg";
    quality: QualityReport;
}

export interface HeadMarks {
    crownY: number;
    chinY: number;
    eyeY: number;
    centerX: number;
}

export interface GeneratedPhoto extends RenderedPhoto {
    preset: Omit<PhotoPreset, "sheet">;
    /** The image the crop is taken from, kept by the server for a while so the crop can be adjusted. */
    work: { id: string; url: string; width: number; height: number; crop: Rect; autoCrop: Rect; head: HeadMarks };
    warnings: WarningCode[];
    source: { format: string; converted: boolean; orientationCorrected: boolean; width: number; height: number; upscaled: "ai" | "resample" | null };
    alignment: PhotoAlignment;
}

/** How the head was straightened (roll only — the whole photo turned, nothing warped). */
export interface PhotoAlignment {
    /** Kept by the server for a while: turning by hand starts again from it. */
    sourceId: string;
    /** Degrees the photo was turned (positive = clockwise). */
    angle: number;
    /** The automatic choice. */
    autoAngle: number;
    /** The eye line's angle afterwards (≈ 0). */
    residual: number;
    maxAngle: number;
}

export type ProgressEvent =
    | { type: "step"; step: StepId; status: "active" | "done" | "skipped"; detail?: { format?: string; converted?: boolean; corrected?: boolean; upscaling?: boolean; upscaled?: "ai" | "resample" | null; angle?: number } }
    | { type: "preview"; stage: "original" | "cutout" | "white"; url: string; width: number; height: number }
    | { type: "crop"; rect: Rect }
    | { type: "warning"; code: WarningCode };

/** Server paths → URLs the browser can load (the API may live on another origin). */
/** A photo-generator file (served by the AI server, which made it). */
export const apiUrl = (path: string) => `${AI_API_BASE_URL}${path}`;

export const getPhotoPresets = (signal?: AbortSignal) => apiClient.get<PhotoPreset[]>("/photo-generator/presets", { signal });

/** Longer than the server's own limits, so its (friendlier) timeout normally arrives first. */
const TIMEOUT_MS = 180_000;

/**
 * Sends the photo and reports each processing step as the server does it (newline-delimited JSON),
 * resolving with the finished photo. Failures reject with an ApiError carrying a code.
 */
export function processPhoto(image: File, preset: string, onEvent: (event: ProgressEvent) => void, signal?: AbortSignal): Promise<GeneratedPhoto> {
    const form = new FormData();
    form.append("preset", preset);
    form.append("file", image, image.name || "photo.jpg");
    return postNdjson<GeneratedPhoto, ProgressEvent>("/photo-generator/process", form, onEvent, { signal, timeoutMs: TIMEOUT_MS });
}

/** The photo made again with the head turned by `angle` degrees (fine-tuning the automatic straightening). */
export const rotatePhoto = (sourceId: string, angle: number) => apiClient.post<Omit<GeneratedPhoto, "source">>("/photo-generator/rotate", { sourceId, angle });

export const adjustPhotoCrop = (workId: string, crop: Rect) => apiClient.post<RenderedPhoto & { crop: Rect }>("/photo-generator/adjust", { workId, crop: { ...crop } });

export interface PrintSheet {
    url: string;
    width: number;
    height: number;
    copies: number;
    maxCopies: number;
    paper: string;
    dpi: number;
}

export const createPrintSheet = (photoId: string, copies: number, signal?: AbortSignal) => apiClient.post<PrintSheet>("/photo-generator/sheet", { photoId, copies }, { signal });
