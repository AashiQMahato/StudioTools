/** Mirrors backend/src/config/upload.ts so files are validated before they leave the browser. */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/**
 * Formats the browser can't be relied on to open (phones save HEIC). They're converted to JPEG by the
 * server first. Browsers often report no type for HEIC, so the extension counts too.
 */
export const CONVERTIBLE_IMAGE_TYPES = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence", "image/avif", "image/tiff", "image/bmp", "image/gif"] as const;
export const CONVERTIBLE_EXTENSIONS = [".heic", ".heif", ".avif", ".tif", ".tiff", ".bmp", ".gif"] as const;
/** For file pickers. */
export const UPLOAD_ACCEPT = [...ACCEPTED_IMAGE_TYPES, ...CONVERTIBLE_IMAGE_TYPES, ...CONVERTIBLE_EXTENSIONS].join(",");
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
