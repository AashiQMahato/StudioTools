import { ApiError, apiClient } from "./apiClient";

export interface TranslationStatus {
    available: boolean;
    provider: "libretranslate" | "google" | null;
    message: string;
}

export interface TranslationResponse {
    /** One per text sent, in order. */
    translations: string[];
    detectedSource?: string;
    provider: string;
}

/** A little over the server's own limit, so its clearer timeout error usually arrives first. */
const TIMEOUT_MS = 30_000;

export const getTranslationStatus = (signal?: AbortSignal) => apiClient.get<TranslationStatus>("/translate/status", { signal });

/** Translation lives on the main API (not the AI server): keys and provider stay on the backend. */
export async function translateTexts(request: { texts: string[]; source: string; target: string }, signal?: AbortSignal): Promise<TranslationResponse> {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    try {
        return await apiClient.post<TranslationResponse>("/translate", { ...request }, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (error) {
        if (error instanceof ApiError || signal?.aborted) throw error;
        if (timeout.aborted) throw new ApiError("Translation took too long. Please try again.", 504, "TRANSLATION_TIMEOUT");
        throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0, "NETWORK");
    }
}
