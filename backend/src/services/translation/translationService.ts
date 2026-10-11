import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
import { createGoogleProvider } from "./googleProvider.js";
import { createLibreTranslateProvider } from "./libreTranslateProvider.js";
import { ProviderError, type TranslationProvider, type TranslationResult } from "./types.js";

export const MAX_SEGMENTS = 200;
export const MAX_CHARACTERS = 20_000;

/** "en", "ne", "fil", "zh-CN", "zh-Hans", "pt-BR" — a language, optionally a region or script. */
const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[A-Za-z]{2}|-[A-Za-z]{4})?$/;

export interface TranslateRequest {
    texts: string[];
    source: string;
    target: string;
}

const invalidLanguage = () => new AppError("Choose a supported language.", 400, "INVALID_LANGUAGE");

/** Validates an untrusted body. Nothing about the texts is ever logged. */
export function parseTranslateRequest(body: unknown): TranslateRequest {
    const { texts, source = "auto", target } = (body ?? {}) as Record<string, unknown>;
    if (!Array.isArray(texts) || texts.length === 0 || !texts.every((text) => typeof text === "string")) {
        throw new AppError("Send the text to translate.", 400, "INVALID_REQUEST");
    }
    if (texts.length > MAX_SEGMENTS || texts.reduce((sum, text) => sum + text.length, 0) > MAX_CHARACTERS) {
        throw new AppError(`That's too much text to translate at once (up to ${MAX_SEGMENTS} blocks and ${MAX_CHARACTERS.toLocaleString("en")} characters).`, 413, "TEXT_TOO_LONG");
    }
    if (typeof source !== "string" || typeof target !== "string") throw invalidLanguage();
    if ((source !== "auto" && !LANGUAGE_CODE.test(source)) || !LANGUAGE_CODE.test(target)) throw invalidLanguage();
    if (source === target) throw new AppError("Choose a target language different from the source.", 400, "INVALID_LANGUAGE");
    return { texts, source, target };
}

export function createTranslationService(provider: TranslationProvider | null, timeoutMs: number) {
    const available = () => provider !== null && provider.isConfigured();
    return {
        status: () =>
            available()
                ? { available: true, provider: provider!.name, message: "Translation is available." }
                : { available: false, provider: null, message: "Translation isn't set up on this server." },

        async translate(body: unknown, signal: AbortSignal): Promise<TranslationResult & { provider: string }> {
            if (!available()) throw new AppError("Translation isn't set up on this server. You can still read and edit the text.", 503, "TRANSLATION_NOT_CONFIGURED");
            const { texts, source, target } = parseTranslateRequest(body);
            // Blank blocks stay blank: they cost a request and some engines reject them.
            const filled = texts.flatMap((text, index) => (text.trim() ? [index] : []));
            if (filled.length === 0) return { translations: texts.map(() => ""), provider: provider!.name };

            const timeout = AbortSignal.timeout(timeoutMs);
            try {
                const result = await provider!.translate(filled.map((index) => texts[index] as string), source, target, AbortSignal.any([signal, timeout]));
                if (result.translations.length !== filled.length) throw new ProviderError(`${provider!.name} returned the wrong number of texts`);
                const translations = texts.map(() => "");
                filled.forEach((index, i) => (translations[index] = result.translations[i] as string));
                return { translations, ...(result.detectedSource ? { detectedSource: result.detectedSource } : {}), provider: provider!.name };
            } catch (error) {
                if (signal.aborted) throw new AppError("The request was cancelled.", 499, "REQUEST_CANCELLED");
                if (timeout.aborted) throw new AppError("Translation took too long. Please try again, or translate fewer blocks.", 504, "TRANSLATION_TIMEOUT");
                // Status only: never the text, the key or the provider's reply.
                console.warn(`Translation failed: ${error instanceof ProviderError ? error.detail : `${provider!.name} unreachable`}`);
                throw new AppError("The translation service couldn't translate this right now. Please try again.", 502, "TRANSLATION_FAILED");
            }
        },
    };
}

function providerFromEnv(): TranslationProvider | null {
    const config = env.translation;
    if (config.provider === "libretranslate") return createLibreTranslateProvider({ url: config.libreTranslateUrl, apiKey: config.libreTranslateApiKey });
    if (config.provider === "google") return createGoogleProvider({ apiKey: config.googleApiKey });
    return null;
}

export const translation = createTranslationService(providerFromEnv(), env.translation.timeoutMs);
