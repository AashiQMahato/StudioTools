import type { ApiResponse } from "@/types/api";

/** Empty in development (Vite proxies `/api`); set VITE_API_BASE_URL when the backend is deployed elsewhere. */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

/**
 * Where the heavy AI tools (background removal, passport photos, upscaling) go: a separate, stronger
 * server when VITE_AI_API_BASE_URL is set (e.g. a Mac reached through a tunnel), else the main API.
 */
export const AI_API_BASE_URL = (import.meta.env.VITE_AI_API_BASE_URL ?? "").replace(/\/$/, "") || API_BASE_URL;
/** The AI tools run on their own server (which may be offline while the main API is up). */
export const SEPARATE_AI_SERVER = AI_API_BASE_URL !== API_BASE_URL;
// Processor health is asked by the AI tools only, about the server that runs them.
const AI_PATHS = ["/remove-background", "/remove-bg/", "/upscale", "/photo-generator", "/health/processors"];
/** The server an API path belongs to. */
export const apiBase = (path: string) => (AI_PATHS.some((prefix) => path.startsWith(prefix)) ? AI_API_BASE_URL : API_BASE_URL);

export class ApiError extends Error {
    readonly status: number;
    readonly code?: string;

    constructor(message: string, status: number, code?: string) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = code;
    }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
    body?: BodyInit | Record<string, unknown>;
}

async function request<T>(path: string, { body, headers, ...init }: RequestOptions = {}): Promise<T> {
    const isJsonBody = body !== undefined && !(body instanceof FormData) && !(body instanceof Blob) && typeof body === "object";

    const response = await fetch(`${apiBase(path)}/api${path}`, {
        ...init,
        headers: {
            Accept: "application/json",
            ...(isJsonBody ? { "Content-Type": "application/json" } : {}),
            ...headers,
        },
        body: isJsonBody ? JSON.stringify(body) : (body as BodyInit | undefined),
    });

    let payload: ApiResponse<T> | undefined;
    try {
        payload = (await response.json()) as ApiResponse<T>;
    } catch {
        // Non-JSON response; handled below.
    }

    if (!payload) {
        throw new ApiError(`Unexpected response from server (${response.status})`, response.status);
    }
    if (!response.ok || !payload.success) {
        const failure = payload.success ? undefined : payload;
        throw new ApiError(failure?.message ?? `Request failed (${response.status})`, response.status, failure?.code);
    }

    return payload.data;
}

export const apiClient = {
    get: <T>(path: string, init?: RequestOptions) => request<T>(path, { ...init, method: "GET" }),
    post: <T>(path: string, body?: RequestOptions["body"], init?: RequestOptions) => request<T>(path, { ...init, method: "POST", body }),
};

export interface BinaryResult {
    blob: Blob;
    /** Suggested file name from the server's Content-Disposition header. */
    fileName: string | null;
    width: number;
    height: number;
    /** Any other response header (e.g. X-Compressed-Size). */
    header: (name: string) => string | null;
}

export interface UploadOptions {
    signal?: AbortSignal;
    /** Real upload progress, 0–1. */
    onUploadProgress?: (fraction: number) => void;
    /** Fired once the request body has been fully sent (the server is now processing). */
    onUploaded?: () => void;
}

const FALLBACK_MESSAGE = "Something went wrong. Please try again.";

async function errorFrom(xhr: XMLHttpRequest): Promise<ApiError> {
    const blob = xhr.response instanceof Blob ? xhr.response : null;
    try {
        const body = JSON.parse(blob ? await blob.text() : String(xhr.responseText)) as { message?: string; code?: string };
        return new ApiError(body.message ?? FALLBACK_MESSAGE, xhr.status, body.code);
    } catch {
        return new ApiError(xhr.status === 0 ? "Couldn't reach the server. Check your connection and try again." : FALLBACK_MESSAGE, xhr.status);
    }
}

/**
 * POSTs multipart form data and resolves with a binary (image) response.
 * Uses XMLHttpRequest because it is the only browser API that reports upload progress.
 */
export function postFormForBlob(path: string, form: FormData, { signal, onUploadProgress, onUploaded }: UploadOptions = {}): Promise<BinaryResult> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${apiBase(path)}/api${path}`);
        xhr.responseType = "blob";

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) onUploadProgress?.(event.loaded / event.total);
        };
        xhr.upload.onload = () => onUploaded?.();

        xhr.onload = async () => {
            if (xhr.status >= 200 && xhr.status < 300 && xhr.response instanceof Blob) {
                const disposition = xhr.getResponseHeader("Content-Disposition") ?? "";
                resolve({
                    blob: xhr.response,
                    fileName: /filename="([^"]+)"/.exec(disposition)?.[1] ?? null,
                    width: Number(xhr.getResponseHeader("X-Image-Width")) || 0,
                    height: Number(xhr.getResponseHeader("X-Image-Height")) || 0,
                    header: (name) => xhr.getResponseHeader(name),
                });
            } else {
                reject(await errorFrom(xhr));
            }
        };
        xhr.onerror = async () => reject(await errorFrom(xhr));
        xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
        signal?.addEventListener("abort", () => xhr.abort(), { once: true });

        xhr.send(form);
    });
}

