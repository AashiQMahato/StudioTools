export interface TranslationResult {
    /** One per input text, in the same order. */
    translations: string[];
    /** The language the provider detected, when the source was "auto". */
    detectedSource?: string;
}

/** Contract every translation engine implements, so engines can be swapped without touching the API. */
export interface TranslationProvider {
    readonly name: "libretranslate" | "google";
    isConfigured(): boolean;
    translate(texts: string[], source: string | "auto", target: string, signal: AbortSignal): Promise<TranslationResult>;
}

/**
 * A provider's failure. `detail` is for our logs only (status, no text, no key, no response body) —
 * the user always gets a generic message.
 */
export class ProviderError extends Error {
    constructor(readonly detail: string) {
        super(detail);
        this.name = "ProviderError";
    }
}
