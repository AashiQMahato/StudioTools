import { fetchBuffered } from "../../utils/fetchBuffered.js";
import { ProviderError, type TranslationProvider } from "./types.js";

interface LibreResponse {
    translatedText?: string | string[];
    /** One object for a single text, one per text for an array (newer servers), or absent. */
    detectedLanguage?: { language?: string } | { language?: string }[];
}

/** Any LibreTranslate-compatible server (self-hosted or libretranslate.com): POST {url}/translate. */
export function createLibreTranslateProvider(config: { url: string; apiKey: string }): TranslationProvider {
    const base = config.url.replace(/\/+$/, "");
    return {
        name: "libretranslate",
        isConfigured: () => base !== "",
        async translate(texts, source, target, signal) {
            const response = await fetchBuffered(`${base}/translate`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ q: texts, source, target, format: "text", ...(config.apiKey ? { api_key: config.apiKey } : {}) }),
                signal,
            });
            if (!response.ok) throw new ProviderError(`libretranslate responded ${response.status}`);
            const body = (await response.json().catch(() => null)) as LibreResponse | null;
            const translated = body?.translatedText;
            const translations = Array.isArray(translated) ? translated : typeof translated === "string" && texts.length === 1 ? [translated] : null;
            if (!translations || translations.length !== texts.length || !translations.every((text) => typeof text === "string")) {
                throw new ProviderError("libretranslate returned an unexpected response");
            }
            const detected = Array.isArray(body?.detectedLanguage) ? body.detectedLanguage[0]?.language : body?.detectedLanguage?.language;
            return { translations, ...(typeof detected === "string" && detected ? { detectedSource: detected } : {}) };
        },
    };
}
