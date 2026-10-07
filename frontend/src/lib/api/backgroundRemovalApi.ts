import { apiClient, type BinaryResult, postFormForBlob, type UploadOptions } from "./apiClient";

/** Sends the image to our API and resolves with the transparent PNG (BiRefNet-Massive, original resolution). */
export function removeBackground(image: File, options?: UploadOptions): Promise<BinaryResult> {
    const form = new FormData();
    form.append("file", image);
    return postFormForBlob("/remove-background", form, options);
}

export interface BackgroundRemovalStatus {
    available: boolean;
    model: string;
    device?: string;
    loaded: boolean;
    /** How long a cut-out has been taking on this server (seconds), when it has made any. */
    typicalSeconds?: number | null;
}

export function getBackgroundRemovalStatus(signal?: AbortSignal): Promise<BackgroundRemovalStatus> {
    return apiClient.get<BackgroundRemovalStatus>("/remove-bg/status", { signal });
}
