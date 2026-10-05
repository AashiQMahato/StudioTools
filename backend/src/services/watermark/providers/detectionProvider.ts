import { env } from "../../../config/env.js";
import { postToImageService } from "../../image-processing/internalImageService.js";

export interface Region {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** One likely watermark, in the pixel coordinates of the (upright) image. Nothing is changed by finding it. */
export interface WatermarkDetection {
    id: string;
    /** "pattern": the same text repeated across the image. */
    type: "text" | "logo" | "pattern";
    confidence: number;
    box: Region;
    /** The region's outline (four corners; rotated for slanted text). */
    polygon: [number, number][];
    /** Slant of the text, in degrees. */
    angle: number;
}

/** Contract every watermark detector implements, so the model/service can be swapped. */
export interface WatermarkDetector {
    readonly name: string;
    detect(image: Buffer, signal: AbortSignal): Promise<Omit<WatermarkDetection, "id">[]>;
}

/**
 * The built-in detector, in the internal Python service: OpenCV's PP-OCRv3 text model for text marks,
 * plus overlay analysis for semi-transparent marks, weighted by where watermarks are usually placed.
 */
const opencvDetector: WatermarkDetector = {
    name: "opencv-ppocr",
    async detect(image, signal) {
        const response = await postToImageService("/detect-watermarks", image, "image.jpg", signal, env.watermark.timeoutMs, {
            code: "DETECTION_UNAVAILABLE",
            message: "Watermark detection is temporarily unavailable. You can still select the area by hand.",
        });
        const body = (await response.json()) as { detections?: Omit<WatermarkDetection, "id">[] };
        return body.detections ?? [];
    },
};

const DETECTORS: Record<typeof env.watermark.detectionProvider, WatermarkDetector> = { opencv: opencvDetector };
export const detector = DETECTORS[env.watermark.detectionProvider];
