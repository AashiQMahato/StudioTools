import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type BinaryResult, type UploadOptions } from "@/lib/api/apiClient";
import type { ImageFile, ProcessedImage, ProcessingStatus } from "@/types/image";
import type { AppErrorInfo } from "@/i18n";

export type Runner = (file: File, options: UploadOptions) => Promise<BinaryResult>;

interface JobState {
    status: Exclude<ProcessingStatus, "idle" | "selected"> | "ready";
    uploadProgress: number;
    result: ProcessedImage | null;
    error: AppErrorInfo | null;
    startedAt: number | null;
}

const initial: JobState = { status: "ready", uploadProgress: 0, result: null, error: null, startedAt: null };

/**
 * Runs one processing request for the current image and tracks its lifecycle honestly:
 * real upload progress, then an indeterminate "processing" phase (the server can't report model progress).
 * Owns the result's object URL and revokes it when the result is discarded.
 */
export function useProcessingJob(original: ImageFile | null, fallbackName: (image: ImageFile) => string) {
    const [job, setJob] = useState<JobState>(initial);
    const controller = useRef<AbortController | null>(null);

    const discard = useCallback(() => {
        controller.current?.abort();
        controller.current = null;
        setJob((current) => {
            if (current.result) URL.revokeObjectURL(current.result.url);
            return initial;
        });
    }, []);

    // A new image (or none) starts a fresh job.
    useEffect(() => discard, [original?.id, discard]);

    const run = useCallback(
        async (runner: Runner) => {
            if (!original) return;
            controller.current?.abort();
            const abort = new AbortController();
            controller.current = abort;
            setJob((current) => {
                if (current.result) URL.revokeObjectURL(current.result.url);
                return { status: "uploading", uploadProgress: 0, result: null, error: null, startedAt: Date.now() };
            });

            try {
                const response = await runner(original.file, {
                    signal: abort.signal,
                    onUploadProgress: (fraction) => setJob((current) => ({ ...current, uploadProgress: fraction })),
                    onUploaded: () => setJob((current) => ({ ...current, status: "processing", uploadProgress: 1 })),
                });
                if (abort.signal.aborted) return;
                const url = URL.createObjectURL(response.blob);
                const image = await loadDimensions(url, response);
                setJob({
                    status: "success",
                    uploadProgress: 1,
                    error: null,
                    startedAt: null,
                    result: { blob: response.blob, url, fileName: response.fileName ?? fallbackName(original), dimensions: image },
                });
            } catch (error) {
                if (abort.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
                const unsupported = error instanceof ApiError && (error.code === "UPSCALING_UNAVAILABLE" || error.code === "BACKGROUND_REMOVAL_DISABLED");
                setJob({
                    ...initial,
                    status: unsupported ? "unsupported" : "error",
                    error: error instanceof ApiError ? { code: error.code ?? (error.status === 0 ? "NETWORK" : undefined), message: error.message } : { code: "GENERIC" },
                });
            } finally {
                if (controller.current === abort) controller.current = null;
            }
        },
        [original, fallbackName],
    );

    const cancel = useCallback(() => {
        controller.current?.abort();
        controller.current = null;
        setJob(initial);
    }, []);

    const status: ProcessingStatus = !original ? "idle" : job.status === "ready" ? "selected" : job.status;
    return { ...job, status, run, cancel, reset: discard };
}

async function loadDimensions(url: string, response: BinaryResult) {
    if (response.width && response.height) return { width: response.width, height: response.height };
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
}
