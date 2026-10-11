import { apiClient, type BinaryResult, postFormForBlob, type UploadOptions } from "./apiClient";

export type RestoreOperation = "denoise" | "scratches" | "fade" | "colorize" | "faces" | "upscale";

export interface RestoreCapability {
    id: RestoreOperation;
    available: boolean;
    /** The engine that runs it on this server, e.g. "lama-onnx" or "opencv-nlmeans". */
    engine: string;
    kind: "ai" | "classical";
    /** Why it can't run: the service is starting, a model isn't installed, or the engine is off here. */
    reason: "starting" | "model-missing" | "disabled" | null;
}

/** What one step actually did: the engine that ran, or why it changed nothing. */
export interface RestoreStep {
    id: RestoreOperation;
    engine: string | null;
    skipped: string | null;
    faces?: { restored: number; skipped: number };
}

export function getRestoreCapabilities(signal?: AbortSignal): Promise<RestoreCapability[]> {
    return apiClient.get<{ operations: RestoreCapability[] }>("/restore/capabilities", { signal }).then((data) => data.operations);
}

/** Runs the chosen steps on the server (it orders them). The upload itself is never changed. */
export function restorePhoto(image: File, operations: readonly RestoreOperation[], options?: UploadOptions): Promise<BinaryResult> {
    const form = new FormData();
    form.append("operations", operations.join(","));
    form.append("file", image);
    return postFormForBlob("/restore", form, options);
}

