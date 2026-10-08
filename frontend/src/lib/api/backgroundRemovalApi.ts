import { apiClient, type BinaryResult, postFormForBlob, type UploadOptions } from "./apiClient";

export type RemovalMode = "fast" | "quality" | "ultra";

/** Sends the image to our API and resolves with the transparent PNG (BiRefNet-Massive, original resolution). */
export function removeBackground(image: File, options?: UploadOptions, mode: RemovalMode = "quality"): Promise<BinaryResult> {
    const form = new FormData();
    // Before the file, so the server has it when the upload arrives.
    form.append("mode", mode);
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
    typicalSecondsByMode?: Partial<Record<RemovalMode, number>>;
    /** The modes this server offers — ultra only where it's stable. */
    modes?: Partial<Record<RemovalMode, number>>;
}

export function getBackgroundRemovalStatus(signal?: AbortSignal): Promise<BackgroundRemovalStatus> {
    return apiClient.get<BackgroundRemovalStatus>("/remove-bg/status", { signal });
}
