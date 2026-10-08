import type { PhotoPreset, PhysicalSize } from "@/lib/api/photoGeneratorApi";
import type { AppErrorInfo, Dictionary } from "@/i18n";

/** "1.1 × 1.322 in", "35 × 45 mm" — in the unit the requirement itself uses. */
export const formatSize = ({ width, height, unit }: PhysicalSize) => `${width} × ${height} ${unit}`;

/** "1.1x1.322in", "35x45mm" — for file names. */
export const sizeSlug = ({ width, height, unit }: PhysicalSize) => `${width}x${height}${unit}`;

export const presetName = (t: Dictionary, preset: Pick<PhotoPreset, "id" | "name">) => t.photo.presetFullNames[preset.id] ?? preset.name;

/** Codes whose own sentence says it best; everything else gets the one calm, general message. */
const EXPLAINED = new Set(["NO_FACE", "MULTIPLE_FACES", "UNSUPPORTED_MEDIA_TYPE", "INVALID_IMAGE", "FILE_TOO_LARGE", "IMAGE_TOO_LARGE", "CONVERSION_FAILED", "RATE_LIMITED", "SERVER_BUSY", "NETWORK", "PROCESSING_TIMEOUT", "BACKGROUND_REMOVAL_UNAVAILABLE", "FACE_DETECTION_UNAVAILABLE", "FILE_EXPIRED", "INVALID_CROP", "FACE_ANGLE_TOO_STEEP"]);

/** Never the server's raw wording: a known situation in the user's language, or the general message. */
export function photoError(t: Dictionary, error: AppErrorInfo | null | undefined): string {
    const code = error?.code;
    return (code && EXPLAINED.has(code) && t.errors[code]) || t.photo.failed;
}
