import { type ChangeEvent, useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type AppRoute, ROUTES } from "@/lib/constants/routes";
import { ApiError } from "@/lib/api/apiClient";
import { convertToJpeg } from "@/lib/api/convertApi";
import { ACCEPTED_IMAGE_TYPES, CONVERTIBLE_EXTENSIONS, CONVERTIBLE_IMAGE_TYPES, MAX_UPLOAD_BYTES, UPLOAD_ACCEPT } from "@/lib/constants/upload";
import { useSectionImageStore } from "@/store/useImageStore";
import type { ImageDimensions } from "@/types/image";
import { type Dictionary, useT } from "@/i18n";

const acceptedTypes: readonly string[] = ACCEPTED_IMAGE_TYPES;
const convertibleTypes: readonly string[] = CONVERTIBLE_IMAGE_TYPES;

const extensionOf = (file: File) => file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
const FORMAT_NAMES: Record<string, string> = { ".heic": "HEIC", ".heif": "HEIF", ".avif": "AVIF", ".tif": "TIFF", ".tiff": "TIFF", ".bmp": "BMP", ".gif": "GIF" };

/** "HEIC", "AVIF"… when the file must be converted before the browser can use it; null when it can be used as is. */
function conversionFor(file: File): string | null {
    if (acceptedTypes.includes(file.type)) return null;
    const extension = extensionOf(file);
    if (!convertibleTypes.includes(file.type) && !(CONVERTIBLE_EXTENSIONS as readonly string[]).includes(extension)) return null;
    return FORMAT_NAMES[extension] ?? (file.type.split("/")[1]?.replace("-sequence", "").toUpperCase() || "image");
}

/**
 * The image's real type, from its first bytes. Browsers report a file's type from its name and the
 * system's settings — and sometimes report none (an upper-case ".JPG" from some apps, files copied off
 * a phone or a camera card). The content doesn't lie, so it decides.
 */
async function sniffType(file: File): Promise<(typeof ACCEPTED_IMAGE_TYPES)[number] | null> {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
    if (head[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
    return null;
}

/** The file with its true type when the browser got it wrong or left it out (it's the same bytes). */
async function withTrueType(file: File): Promise<File> {
    if (acceptedTypes.includes(file.type) || conversionFor(file)) return file;
    const type = await sniffType(file).catch(() => null);
    return type ? new File([file], file.name, { type, lastModified: file.lastModified }) : file;
}

function validate(file: File, t: Dictionary): string | null {
    if (!acceptedTypes.includes(file.type) && !conversionFor(file)) return t.upload.wrongType;
    if (file.size > MAX_UPLOAD_BYTES) return t.upload.tooLarge;
    return null;
}

/** Decode the image once to learn its size — this also proves the browser can actually read it. */
async function readDimensions(file: File): Promise<ImageDimensions> {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
}

export type PreparedImage = { ok: true; file: File; dimensions: ImageDimensions; convertedFrom: string | null } | { ok: false; error: string };

/**
 * One file, made ready to use: type and size checked (mirroring the API), converted to JPEG on the
 * server when the browser can't open it (HEIC…), and decoded once to prove it's readable.
 * `onStatus` hears what's happening (e.g. "HEIC detected — converting to JPEG…"), then null.
 */
export async function prepareImageFile(original: File, t: Dictionary, onStatus?: (status: string | null) => void): Promise<PreparedImage> {
    const picked = await withTrueType(original);
    const problem = validate(picked, t);
    if (problem) return { ok: false, error: problem };
    // Phones save HEIC; nobody should have to convert it themselves. The server turns it into an
    // upright, full-quality JPEG, and everything carries on as usual.
    const convertedFrom = conversionFor(picked);
    let file = picked;
    if (convertedFrom) {
        onStatus?.(t.upload.converting(convertedFrom));
        try {
            file = await convertToJpeg(picked);
        } catch (cause) {
            const code = cause instanceof ApiError ? (cause.code ?? (cause.status === 0 ? "NETWORK" : undefined)) : undefined;
            return { ok: false, error: code === "NETWORK" || code === "FILE_TOO_LARGE" || code === "RATE_LIMITED" ? t.errors[code]! : t.upload.conversionFailed(convertedFrom) };
        } finally {
            onStatus?.(null);
        }
    }
    try {
        return { ok: true, file, dimensions: await readDimensions(file), convertedFrom };
    } catch {
        return { ok: false, error: t.upload.unreadable };
    }
}

interface Options {
    /** Where to go after a successful pick. `null` stays on the current page. */
    navigateTo?: AppRoute | null;
    /** A tool that takes other files too (the OCR editor's PDFs) claims them here first: true = handled. */
    intercept?: (file: File) => boolean;
    /** The picker's file types, when the tool takes more than images. */
    accept?: string;
}

/**
 * The one way images enter the app (file picker, drag and drop, landing CTA):
 * validates type and size (mirroring the API), decodes it, stores it and optionally opens a tool.
 */
export function useImageUpload({ navigateTo = ROUTES.removeBackground, intercept, accept = UPLOAD_ACCEPT }: Options = {}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [error, setError] = useState<string | null>(null);
    /** What's happening to a file on its way in (e.g. "HEIC detected — converting to JPEG…"). */
    const [status, setStatus] = useState<string | null>(null);
    const setOriginal = useSectionImageStore()((state) => state.setOriginal);
    const navigate = useNavigate();
    const t = useT();

    const openPicker = useCallback(() => {
        setError(null);
        inputRef.current?.click();
    }, []);

    const acceptFile = useCallback(
        async (picked: File) => {
            setError(null);
            if (intercept?.(picked)) return true;
            const prepared = await prepareImageFile(picked, t, setStatus);
            if (!prepared.ok) {
                setError(prepared.error);
                return false;
            }
            const { file, dimensions, convertedFrom } = prepared;
            setOriginal({
                id: crypto.randomUUID(),
                file,
                name: file.name,
                size: file.size,
                mimeType: file.type,
                previewUrl: URL.createObjectURL(file),
                dimensions,
                ...(convertedFrom ? { convertedFrom } : {}),
            });
            if (navigateTo) navigate(navigateTo);
            return true;
        },
        [navigate, navigateTo, setOriginal, t, intercept],
    );

    const onChange = useCallback(
        (event: ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            event.target.value = ""; // allow picking the same file again
            if (file) void acceptFile(file);
        },
        [acceptFile],
    );

    const inputProps = {
        ref: inputRef,
        type: "file",
        accept,
        onChange,
        hidden: true,
        tabIndex: -1,
    } as const;

    return { openPicker, acceptFile, inputProps, error, setError, status, clearError: () => setError(null) };
}
