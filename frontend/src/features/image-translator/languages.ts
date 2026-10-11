import type { OcrLanguage } from "@/lib/api/ocrApi";

/** What the OCR can read: the translator's source choices are exactly these. */
export const SOURCE_LANGUAGES: readonly OcrLanguage[] = ["auto", "en", "ne", "mixed"];

export type Script = "latin" | "devanagari" | "other";

export interface TargetLanguage {
    /** Sent to the API: lowercase 2–3 letters, optionally a region/script (the backend's allow-list pattern). */
    code: string;
    /** English name, when the browser can't name it in the page's language. */
    name: string;
    /** The language's name in itself. */
    native: string;
    /** Picks a font with the right glyphs for the exported image. */
    script: Script;
    rtl?: boolean;
}

/** Curated: languages both LibreTranslate and Google Translate support. */
export const TARGET_LANGUAGES: readonly TargetLanguage[] = [
    { code: "en", name: "English", native: "English", script: "latin" },
    { code: "ne", name: "Nepali", native: "नेपाली", script: "devanagari" },
    { code: "hi", name: "Hindi", native: "हिन्दी", script: "devanagari" },
    { code: "bn", name: "Bengali", native: "বাংলা", script: "other" },
    { code: "zh", name: "Chinese (Simplified)", native: "中文", script: "other" },
    { code: "ja", name: "Japanese", native: "日本語", script: "other" },
    { code: "ko", name: "Korean", native: "한국어", script: "other" },
    { code: "ar", name: "Arabic", native: "العربية", script: "other", rtl: true },
    { code: "es", name: "Spanish", native: "Español", script: "latin" },
    { code: "fr", name: "French", native: "Français", script: "latin" },
    { code: "de", name: "German", native: "Deutsch", script: "latin" },
    { code: "pt", name: "Portuguese", native: "Português", script: "latin" },
    { code: "it", name: "Italian", native: "Italiano", script: "latin" },
    { code: "ru", name: "Russian", native: "Русский", script: "other" },
    { code: "tr", name: "Turkish", native: "Türkçe", script: "latin" },
    { code: "id", name: "Indonesian", native: "Bahasa Indonesia", script: "latin" },
    { code: "vi", name: "Vietnamese", native: "Tiếng Việt", script: "latin" },
];

/** Mirrors the backend's check, so a bad entry fails the tests rather than a request. */
export const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[A-Za-z]{2}|-[A-Za-z]{4})?$/;

export const targetLanguage = (code: string) => TARGET_LANGUAGES.find((language) => language.code === code) ?? TARGET_LANGUAGES[0]!;

/** The OCR's language as a translation source: Auto and Mixed let the provider detect it. */
export const translationSource = (language: OcrLanguage): "auto" | "en" | "ne" => (language === "en" || language === "ne" ? language : "auto");

/** Fonts the app already loads (index.html): Noto Sans Devanagari for Devanagari, Inter otherwise; the system fills other scripts. */
export const fontStackFor = (language: TargetLanguage) =>
    language.script === "devanagari" ? `"Noto Sans Devanagari", "Inter", sans-serif` : `"Inter", "Noto Sans Devanagari", system-ui, sans-serif`;

/** "Nepali (नेपाली)" in the page's language, falling back to the English name. */
export function languageLabel(language: TargetLanguage, locale: string): string {
    let name = language.name;
    try {
        name = new Intl.DisplayNames([locale], { type: "language" }).of(language.code) ?? name;
    } catch {
        // An old browser without DisplayNames: the English name will do.
    }
    return name === language.native ? name : `${name} (${language.native})`;
}
