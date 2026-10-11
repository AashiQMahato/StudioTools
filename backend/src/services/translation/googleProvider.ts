import { fetchBuffered } from "../../utils/fetchBuffered.js";
import { ProviderError, type TranslationProvider } from "./types.js";

export const GOOGLE_TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2";
/** Google v2 takes at most 128 segments per request. */
const GOOGLE_MAX_SEGMENTS = 128;

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** v2 can return HTML entities even with format=text (&#39;, &quot;…). */
export function decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
        if (entity[0] === "#") {
            const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
        }
        return NAMED[entity.toLowerCase()] ?? match;
    });
}

interface GoogleResponse {
    data?: { translations?: { translatedText?: string; detectedSourceLanguage?: string }[] };
}

/** Google Cloud Translation v2 (Basic) with an API key. The key goes in a header, never in the URL. */
export function createGoogleProvider(config: { apiKey: string; url?: string }): TranslationProvider {
    const url = config.url ?? GOOGLE_TRANSLATE_URL;
    return {
        name: "google",
        isConfigured: () => config.apiKey !== "",
        async translate(texts, source, target, signal) {
            const translations: string[] = [];
            let detectedSource: string | undefined;
            for (let start = 0; start < texts.length; start += GOOGLE_MAX_SEGMENTS) {
                const q = texts.slice(start, start + GOOGLE_MAX_SEGMENTS);
                const response = await fetchBuffered(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Goog-Api-Key": config.apiKey },
                    // No `source` = Google detects it per segment.
                    body: JSON.stringify({ q, target, format: "text", ...(source === "auto" ? {} : { source }) }),
                    signal,
                });
                if (!response.ok) throw new ProviderError(`google responded ${response.status}`);
                const body = (await response.json().catch(() => null)) as GoogleResponse | null;
                const items = body?.data?.translations;
                if (!Array.isArray(items) || items.length !== q.length || !items.every((item) => typeof item?.translatedText === "string")) {
                    throw new ProviderError("google returned an unexpected response");
                }
                for (const item of items) translations.push(decodeEntities(item.translatedText as string));
                detectedSource ??= items.find((item) => item.detectedSourceLanguage)?.detectedSourceLanguage;
            }
            return { translations, ...(detectedSource ? { detectedSource } : {}) };
        },
    };
}
