export type ErrorCode =
    | "INTERNAL_ERROR"
    | "NOT_FOUND"
    | "RATE_LIMITED"
    | "FILE_REQUIRED"
    | "FILE_TOO_LARGE"
    | "UNSUPPORTED_MEDIA_TYPE"
    | "INVALID_IMAGE"
    | "IMAGE_TOO_LARGE"
    | "INVALID_SCALE"
    | "SERVER_BUSY"
    | "PROCESSING_TIMEOUT"
    | "PROCESSING_FAILED"
    | "REQUEST_CANCELLED"
    | "BACKGROUND_REMOVAL_UNAVAILABLE"
    | "BACKGROUND_REMOVAL_DISABLED"
    | "UPSCALING_UNAVAILABLE"
    | "INVALID_MODE"
    | "INVALID_MASK"
    | "EMPTY_MASK"
    | "RETOUCH_UNAVAILABLE"
    | "INVALID_REQUEST"
    | "INVALID_PRESET"
    | "INVALID_CROP"
    | "CONVERSION_FAILED"
    | "NO_FACE"
    | "MULTIPLE_FACES"
    | "FACE_DETECTION_UNAVAILABLE"
    | "FILE_EXPIRED"
    | "DETECTION_UNAVAILABLE"
    | "OCR_UNAVAILABLE"
    | "NO_TEXT"
    | "INVALID_REGION"
    | "INVALID_PDF"
    | "PDF_ENCRYPTED"
    | "INVALID_PAGES"
    | "TOO_MANY_FILES"
    | "TOO_MANY_PAGES"
    | "RENDERING_UNAVAILABLE"
    | "JOB_EXPIRED"
    | "WRONG_PASSWORD"
    | "INSUFFICIENT_MEMORY";

/** An error whose message is safe to show to users. Internal details belong in logs, never here. */
export class AppError extends Error {
    readonly statusCode: number;
    readonly code: ErrorCode;

    constructor(message: string, statusCode = 500, code: ErrorCode = "INTERNAL_ERROR") {
        super(message);
        this.name = "AppError";
        this.statusCode = statusCode;
        this.code = code;
    }
}
