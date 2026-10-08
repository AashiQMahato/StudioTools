import sharp, { type OutputInfo } from "sharp";
import type { DetectedFace, Rect } from "./faceDetectionService.js";
import { aspectRatio, type PhotoPreset } from "./presets.js";

/** Where the head is, in image pixels. */
export interface HeadGeometry {
    /** Top of the head (hair included). */
    crownY: number;
    chinY: number;
    /** Line through the eyes, and the point midway between them. */
    eyeY: number;
    centerX: number;
    faceBox: Rect;
    /** The whole person, from the cut-out. */
    subject: Rect;
    /** Head tilt: the angle of the eye line, in degrees. */
    rollDeg: number;
    /** Nose offset from the eyes' midpoint, as a share of the eye distance (turned head). */
    yaw: number;
    /** Nose height between the eye line (0) and the mouth (1): ≈ 0.55 facing the camera (tipped head otherwise). */
    nod: number;
    /** The crown came from the cut-out (true) or had to be estimated from the face (false). */
    crownMeasured: boolean;
    /** The head already touches the top edge of the original photo. */
    crownAtEdge: boolean;
}

/** Alpha at or above this is part of the person. */
const SOLID = 128;

/**
 * Measures the head from the face's landmarks and the cut-out: the crown is the first row of the
 * person's silhouette above the face (so hair is included), the chin is the bottom of the face box.
 * If the silhouette can't be trusted there, the crown is estimated from the face's proportions.
 */
export function analyzeHead(face: DetectedFace, alpha: Buffer, width: number, height: number): HeadGeometry {
    const { rightEye, leftEye, nose } = face.landmarks;
    const eyeY = (rightEye.y + leftEye.y) / 2;
    const centerX = (rightEye.x + leftEye.x) / 2;
    const eyeDistance = Math.max(1, Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y));
    const chinY = Math.min(height - 1, face.box.y + face.box.height);
    const eyeToChin = Math.max(1, chinY - eyeY);

    // Scan down the columns over the face for the first solid row of the silhouette.
    const from = Math.max(0, Math.round(centerX - face.box.width * 0.45));
    const to = Math.min(width - 1, Math.round(centerX + face.box.width * 0.45));
    const needed = Math.max(2, Math.round((to - from + 1) * 0.03));
    let crownY = -1;
    for (let y = 0; y < eyeY && crownY < 0; y++) {
        let solid = 0;
        const row = y * width;
        for (let x = from; x <= to; x++) if (alpha[row + x]! >= SOLID) solid++;
        if (solid >= needed) crownY = y;
    }
    // Plausible heads put the crown between ~0.7× and ~2.2× the eye-to-chin distance above the eyes.
    const crownMeasured = crownY >= 0 && eyeY - crownY >= eyeToChin * 0.7 && eyeY - crownY <= eyeToChin * 2.2;
    if (!crownMeasured) crownY = Math.max(0, eyeY - eyeToChin * 1.15);

    return {
        crownY,
        chinY,
        eyeY,
        centerX,
        faceBox: face.box,
        subject: silhouetteBounds(alpha, width, height),
        rollDeg: (Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x) * 180) / Math.PI,
        yaw: (nose.x - centerX) / eyeDistance,
        nod: (nose.y - eyeY) / Math.max(1, (face.landmarks.mouthLeft.y + face.landmarks.mouthRight.y) / 2 - eyeY),
        crownMeasured,
        crownAtEdge: crownMeasured && crownY <= 1,
    };
}

function silhouetteBounds(alpha: Buffer, width: number, height: number): Rect {
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            if (alpha[row + x]! < SOLID) continue;
            if (x < left) left = x;
            if (x > right) right = x;
            if (y < top) top = y;
            bottom = y;
        }
    }
    return right < 0 ? { x: 0, y: 0, width, height } : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * The ID-photo composition, from the head rather than the image centre: the head fills the preset's
 * share of the height, with the preset's margin above the crown, centred on the eyes. The result has
 * exactly the preset's aspect ratio and may reach past the photo's edges (that area becomes background).
 */
export function calculateCrop(head: Pick<HeadGeometry, "crownY" | "chinY" | "centerX">, preset: PhotoPreset): Rect {
    const headHeight = Math.max(1, head.chinY - head.crownY);
    const height = headHeight / preset.composition.headHeight;
    const width = height * aspectRatio(preset);
    return { x: head.centerX - width / 2, y: head.crownY - preset.composition.crownMargin * height, width, height };
}

/** Moves a rectangle into another coordinate space (offset, then scale). */
export const transformRect = (rect: Rect, origin: { x: number; y: number }, scale: number): Rect => ({
    x: (rect.x - origin.x) * scale,
    y: (rect.y - origin.y) * scale,
    width: rect.width * scale,
    height: rect.height * scale,
});

/**
 * Cuts `rect` out of an image, filling any part beyond its edges with `background` (transparent for a
 * cut-out). Never resamples. Returns raw pixels, so nothing is re-encoded between steps.
 */
export async function cropImage(image: Buffer, size: { width: number; height: number }, rect: Rect, background: { r: number; g: number; b: number; alpha: number }) {
    const left = Math.round(rect.x);
    const top = Math.round(rect.y);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const inside = {
        left: Math.max(0, left),
        top: Math.max(0, top),
        right: Math.min(size.width, left + width),
        bottom: Math.min(size.height, top + height),
    };
    const channels = background.alpha < 1 ? 4 : 3;
    if (inside.right <= inside.left || inside.bottom <= inside.top) {
        return sharp({ create: { width, height, channels, background } }).raw().toBuffer({ resolveWithObject: true });
    }
    const extracted = sharp(image).extract({ left: inside.left, top: inside.top, width: inside.right - inside.left, height: inside.bottom - inside.top });
    const piece = await (channels === 4 ? extracted.ensureAlpha() : extracted.removeAlpha()).raw().toBuffer({ resolveWithObject: true });
    return sharp(piece.data, { raw: piece.info })
        .extend({ top: inside.top - top, left: inside.left - left, bottom: top + height - inside.bottom, right: left + width - inside.right, background })
        .raw()
        .toBuffer({ resolveWithObject: true });
}

/** A raw-pixel result from `cropImage`, as an image again. */
export const fromRaw = ({ data, info }: { data: Buffer; info: OutputInfo }) => sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
