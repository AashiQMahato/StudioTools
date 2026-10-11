import type { BlockStyle, Box, OcrDocument } from "@/lib/api/ocrApi";

/** One OCR block: where it sits in the image, its (editable) text and, once translated, its translation. */
export interface TranslatorBlock {
    id: string;
    bbox: Box;
    style: BlockStyle;
    original: string;
    /** null until translated — never a copy of the original standing in for a translation. */
    translated: string | null;
    /** The original text the translation was made from (to tell when it's out of date). */
    translatedFrom: string | null;
}

export function blocksFrom(document: OcrDocument): TranslatorBlock[] {
    return document.blocks.map((block) => ({ id: block.id, bbox: block.bbox, style: block.style, original: block.text, translated: null, translatedFrom: null }));
}

/** The block was edited after it was translated. */
export const isStale = (block: TranslatorBlock) => block.translated !== null && block.translatedFrom !== block.original;

/** Puts the API's translations (one per block, in order) back on their blocks. */
export function applyTranslations(blocks: readonly TranslatorBlock[], sent: readonly string[], translations: readonly string[]): TranslatorBlock[] {
    if (sent.length !== blocks.length || translations.length !== blocks.length) throw new Error("Translation count doesn't match the blocks.");
    return blocks.map((block, index) => ({ ...block, translated: translations[index] ?? "", translatedFrom: sent[index] ?? "" }));
}

export const hasTranslation = (blocks: readonly TranslatorBlock[]) => blocks.some((block) => block.translated !== null && block.translated.trim() !== "");

/** The .txt download: blocks in reading order, a blank line between them. Untranslated blocks are left out of the translation. */
export function textFile(blocks: readonly TranslatorBlock[], which: "original" | "translated"): string {
    const texts = blocks.map((block) => (which === "original" ? block.original : (block.translated ?? ""))).map((text) => text.trim()).filter(Boolean);
    return texts.length ? `${texts.join("\n\n")}\n` : "";
}
