import sharp from "sharp";
import { AppError } from "../../utils/AppError.js";
import type { HeadGeometry } from "./cropService.js";
import type { DetectedFace, Rect } from "./faceDetectionService.js";
import { outputSize, type PhotoPreset } from "./presets.js";

/** Something worth telling the user that doesn't stop the photo being made. */
export type WarningCode = "LOW_RESOLUTION" | "BLURRY" | "TOO_DARK" | "TOO_BRIGHT" | "HEAD_TILTED" | "NOT_FACING" | "SMALL_FACE" | "HEAD_AT_EDGE";

// Thresholds, measured on the face at a fixed size (see the Python service).
const BLURRY_BELOW = 40;
const DARK_BELOW = 70;
const BRIGHT_ABOVE = 215;
/** Eye line still off level after straightening (it's corrected to within ±2° normally). */
const TILT_DEGREES = 2;
const TURNED = 0.22;
/** Where the nose sits between the eyes and the mouth (≈ 0.55 facing the camera); outside this, the head is tipped up or down. */
const NOD_RANGE = [0.3, 0.85] as const;
/** A second face smaller than this share of the main one leaves no doubt who the photo is of. */
const DOMINANT_SHARE = 0.4;
/** Turned (yaw) or tipped (pitch) further than this, from the face mesh: not front-facing. */
const POSE_LIMIT_DEG = 20;
const SMALL_FACE_PX = 90;

/**
 * Before anything is made: exactly one person, facing the camera, sharp and well lit. Missing or
 * extra faces stop here; everything else is a warning — an imperfect photo is still worth trying.
 */
export function inspectFaces(faces: DetectedFace[]): { face: DetectedFace; warnings: WarningCode[] } {
    const face = faces[0];
    if (!face) throw new AppError("Face could not be detected. Please upload a clear, front-facing photo.", 422, "NO_FACE");
    // Several faces: fine if one clearly dominates (it's the person the photo is of); otherwise ask.
    const second = faces[1];
    const area = (f: DetectedFace) => f.box.width * f.box.height;
    if (second && area(second) >= area(face) * DOMINANT_SHARE) throw new AppError("Multiple faces detected. Please upload a photo containing one person.", 422, "MULTIPLE_FACES");

    const warnings: WarningCode[] = [];
    if (face.sharpness < BLURRY_BELOW) warnings.push("BLURRY");
    if (face.brightness < DARK_BELOW) warnings.push("TOO_DARK");
    else if (face.brightness > BRIGHT_ABOVE) warnings.push("TOO_BRIGHT");
    if (face.box.height < SMALL_FACE_PX) warnings.push("SMALL_FACE");
    // Turned or tipped heads aren't corrected (only roll is) — they're flagged.
    if (face.pose && (Math.abs(face.pose.yaw) > POSE_LIMIT_DEG || Math.abs(face.pose.pitch) > POSE_LIMIT_DEG)) warnings.push("NOT_FACING");
    return { face, warnings };
}

export function inspectPose(head: HeadGeometry): WarningCode[] {
    const warnings: WarningCode[] = [];
    if (Math.abs(head.rollDeg) > TILT_DEGREES) warnings.push("HEAD_TILTED");
    // Turned or tipped heads aren't corrected (that would mean warping the face) — only flagged.
    if (Math.abs(head.yaw) > TURNED || head.nod < NOD_RANGE[0] || head.nod > NOD_RANGE[1]) warnings.push("NOT_FACING");
    if (head.crownAtEdge) warnings.push("HEAD_AT_EDGE");
    return warnings;
}

export type CheckId = "aspectRatio" | "dimensions" | "dpi" | "whiteBackground" | "faceDetected" | "headVisible" | "headSize" | "centered" | "notStretched";

export interface QualityReport {
    ready: boolean;
    checks: { id: CheckId; ok: boolean }[];
}

/** Share of near-white pixels along the top and the upper sides of the photo (where only background should be). */
async function backgroundWhiteness(jpeg: Buffer): Promise<number> {
    const { data, info } = await sharp(jpeg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    const band = Math.max(2, Math.round(height * 0.05));
    const side = Math.max(2, Math.round(width * 0.06));
    let white = 0;
    let total = 0;
    for (let y = 0; y < height * 0.45; y++) {
        for (let x = 0; x < width; x++) {
            if (y >= band && x >= side && x < width - side) continue;
            const i = (y * width + x) * channels;
            total++;
            if (data[i]! >= 240 && data[i + 1]! >= 240 && data[i + 2]! >= 240) white++;
        }
    }
    return total ? white / total : 0;
}

/**
 * The finished photo against the preset: exact size and shape, the DPI written into the file, a white
 * background, and a composition that works — the whole head in frame, a sensible size, centred.
 * `head` and `crop` are in the same coordinates (those of the image the crop was taken from).
 */
export async function validateOutput(jpeg: Buffer, preset: PhotoPreset, head: Pick<HeadGeometry, "crownY" | "chinY" | "centerX">, crop: Rect): Promise<QualityReport> {
    const target = outputSize(preset);
    const metadata = await sharp(jpeg).metadata();
    const headShare = (head.chinY - head.crownY) / crop.height;
    const [low, high] = preset.composition.headHeightRange;
    const checks: QualityReport["checks"] = [
        { id: "aspectRatio", ok: Math.abs((metadata.width ?? 0) / (metadata.height ?? 1) - target.width / target.height) < 0.005 },
        { id: "dimensions", ok: metadata.width === target.width && metadata.height === target.height },
        { id: "dpi", ok: Math.round(metadata.density ?? 0) === preset.dpi },
        { id: "whiteBackground", ok: (await backgroundWhiteness(jpeg)) >= 0.9 },
        { id: "faceDetected", ok: true },
        { id: "headVisible", ok: head.crownY - crop.y >= crop.height * 0.01 && head.chinY <= crop.y + crop.height },
        { id: "headSize", ok: headShare >= low && headShare <= high },
        { id: "centered", ok: Math.abs(head.centerX - (crop.x + crop.width / 2)) <= crop.width * 0.05 },
        { id: "notStretched", ok: Math.abs(crop.width / crop.height / (target.width / target.height) - 1) < 0.01 },
    ];
    return { ready: checks.every((check) => check.ok), checks };
}
