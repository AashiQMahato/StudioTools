import { env } from "../../config/env.js";
import { postToImageService } from "../image-processing/internalImageService.js";

export interface Point {
    x: number;
    y: number;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** One face, in the pixel coordinates of the image it was found in. "Left"/"right" are the person's own. */
export interface DetectedFace {
    box: Rect;
    score: number;
    landmarks: { rightEye: Point; leftEye: Point; nose: Point; mouthRight: Point; mouthLeft: Point };
    /** Variance of the Laplacian over the face at a fixed size: low means blurry. */
    sharpness: number;
    /** Mean brightness of the face, 0–255. */
    brightness: number;
    /** Head turn (yaw) and tip (pitch) in degrees, from the face mesh — when it's available. */
    pose?: { yaw: number; pitch: number } | null;
    /** Where the landmarks came from: the face mesh (precise) or the detector (coarse). */
    landmarkSource?: "mediapipe";
}

/** Contract every face detector implements, so the model can be swapped without touching the pipeline. */
export interface FaceDetector {
    readonly name: string;
    /** Largest face first. */
    detect(image: Buffer, signal: AbortSignal): Promise<DetectedFace[]>;
}

/** OpenCV's YuNet, running in the internal Python service. */
const yunetDetector: FaceDetector = {
    name: "opencv-yunet",
    async detect(image, signal) {
        const response = await postToImageService("/detect-faces", image, "photo.jpg", signal, env.photoGenerator.timeoutMs, {
            code: "FACE_DETECTION_UNAVAILABLE",
            message: "Face detection is temporarily unavailable. Please try again in a moment.",
        });
        const body = (await response.json()) as { faces?: DetectedFace[] };
        return body.faces ?? [];
    },
};

const detector: FaceDetector = yunetDetector;

/** Faces much smaller than the main one are in the background, not a second subject. */
const BACKGROUND_FACE = 0.12;

export async function detectFaces(image: Buffer, signal: AbortSignal) {
    const all = await detector.detect(image, signal);
    const largest = all[0];
    const main = largest ? all.filter((face) => face.box.width * face.box.height >= largest.box.width * largest.box.height * BACKGROUND_FACE) : [];
    return { faces: main, detector: detector.name };
}
