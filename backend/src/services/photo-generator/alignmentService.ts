import sharp from "sharp";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
import type { DetectedFace, Point, Rect } from "./faceDetectionService.js";

/**
 * Head alignment for ID photos: the eye line is measured on the face's landmarks and the WHOLE photo
 * (subject and its transparency together) is turned once, about the point between the eyes, so the
 * eyes are level — head, shoulders and clothes stay in one piece. Roll only: nothing is warped, a turned
 * or tilted-back head (yaw, pitch) is left as it is and only warned about.
 */

/** Below this the photo is already upright: not worth a resample. */
const MIN_ROTATION_DEG = 0.3;
/** After turning, the eye line should be within this of level (real faces aren't perfectly symmetric). */
export const RESIDUAL_TOLERANCE_DEG = 2;

/**
 * The eye line's angle, in degrees: positive when it slopes down towards the person's left (the
 * image's right). The image's y axis points down.
 */
export function measureRoll(face: Pick<DetectedFace, "landmarks">): number {
    const { rightEye, leftEye } = face.landmarks;
    return (Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x) * 180) / Math.PI;
}

/** Stops here (rather than turning a photo a long way) when the head is tilted beyond what we straighten. */
export function checkRoll(rollDeg: number): void {
    if (Math.abs(rollDeg) > env.photoGenerator.maxAutoRotationDeg) {
        throw new AppError("Your face angle is too extreme. Please upload a more front-facing photo.", 422, "FACE_ANGLE_TOO_STEEP");
    }
}

export interface Rotation {
    /** Degrees applied to the photo (positive turns it clockwise on screen). */
    angleDeg: number;
    width: number;
    height: number;
    /** Where a point of the source photo lands in the turned one. */
    map: (point: Point) => Point;
    /** And back: where a point of the turned photo came from. */
    unmap: (point: Point) => Point;
}

/** The geometry of turning a `width` × `height` image by `angleDeg` (the canvas grows to fit it all). */
export function rotationFor(width: number, height: number, angleDeg: number): Rotation {
    const t = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    const corners = [
        [0, 0],
        [width, 0],
        [0, height],
        [width, height],
    ].map(([x, y]) => [cos * x! - sin * y!, sin * x! + cos * y!] as const);
    const minX = Math.min(...corners.map((c) => c[0]));
    const minY = Math.min(...corners.map((c) => c[1]));
    const maxX = Math.max(...corners.map((c) => c[0]));
    const maxY = Math.max(...corners.map((c) => c[1]));
    return {
        angleDeg,
        width: Math.round(maxX - minX),
        height: Math.round(maxY - minY),
        map: ({ x, y }) => ({ x: cos * x - sin * y - minX, y: sin * x + cos * y - minY }),
        unmap: ({ x, y }) => ({ x: cos * (x + minX) + sin * (y + minY), y: -sin * (x + minX) + cos * (y + minY) }),
    };
}

/** The face's landmarks and box carried through a rotation (the box as the bounds of its turned corners). */
export function rotateFace(face: DetectedFace, rotation: Rotation, direction: "map" | "unmap" = "map"): DetectedFace {
    const marks = face.landmarks;
    const { x, y, width, height } = face.box;
    const corners = [rotation[direction]({ x, y }), rotation[direction]({ x: x + width, y }), rotation[direction]({ x, y: y + height }), rotation[direction]({ x: x + width, y: y + height })];
    const left = Math.min(...corners.map((c) => c.x));
    const top = Math.min(...corners.map((c) => c.y));
    const box: Rect = { x: left, y: top, width: Math.max(...corners.map((c) => c.x)) - left, height: Math.max(...corners.map((c) => c.y)) - top };
    return {
        ...face,
        box,
        landmarks: {
            rightEye: rotation[direction](marks.rightEye),
            leftEye: rotation[direction](marks.leftEye),
            nose: rotation[direction](marks.nose),
            mouthRight: rotation[direction](marks.mouthRight),
            mouthLeft: rotation[direction](marks.mouthLeft),
        },
    };
}

export interface AlignedCutout {
    /** RGBA PNG, turned; empty corners are transparent (they become background). */
    png: Buffer;
    /** Its alpha, one byte per pixel — turned with the colour, in the same single pass. */
    alpha: Buffer;
    width: number;
    height: number;
    rotation: Rotation | null;
}

/**
 * Turns the cut-out (colour and alpha together, in one resample, locally-bounded bicubic — sharp, without
 * the ringing halos plain bicubic leaves on hard edges). A tiny angle leaves the photo untouched.
 */
export async function rotateCutout(cutout: { png: Buffer; alpha: Buffer; width: number; height: number }, angleDeg: number): Promise<AlignedCutout> {
    if (Math.abs(angleDeg) < MIN_ROTATION_DEG) return { ...cutout, rotation: null };
    const rotation = rotationFor(cutout.width, cutout.height, angleDeg);
    const t = (angleDeg * Math.PI) / 180;
    const turned = sharp(cutout.png)
        .ensureAlpha()
        .affine([Math.cos(t), -Math.sin(t), Math.sin(t), Math.cos(t)], { background: { r: 0, g: 0, b: 0, alpha: 0 }, interpolator: sharp.interpolators.locallyBoundedBicubic });
    const { data, info } = await turned.raw().toBuffer({ resolveWithObject: true });
    const image = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
    const [png, alpha] = await Promise.all([image.clone().png().toBuffer(), image.clone().extractChannel(3).raw().toBuffer()]);
    return { png, alpha, width: info.width, height: info.height, rotation };
}

/**
 * The face detector (like most) misses faces tilted beyond ~15–20°. If it finds none in the photo as it
 * is, it looks again in copies turned ±15° and ±30° and maps what it finds back — so a tilted head is
 * found and straightened instead of turned away with "no face".
 */
export async function detectFacesTolerant(photo: Buffer, width: number, height: number, detect: (image: Buffer) => Promise<DetectedFace[]>): Promise<DetectedFace[]> {
    const direct = await detect(photo);
    if (direct.length) return direct;
    for (const angle of [15, -15, 30, -30]) {
        const rotation = rotationFor(width, height, angle);
        const t = (angle * Math.PI) / 180;
        const turned = await sharp(photo)
            .affine([Math.cos(t), -Math.sin(t), Math.sin(t), Math.cos(t)], { background: "#ffffff", interpolator: sharp.interpolators.bilinear })
            .jpeg({ quality: 90 })
            .toBuffer();
        const faces = await detect(turned);
        if (faces.length) return faces.map((face) => rotateFace(face, rotation, "unmap"));
    }
    return [];
}
