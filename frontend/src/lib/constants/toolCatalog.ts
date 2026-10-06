import { type AppRoute, ROUTES } from "./routes";
import type { ToolKey } from "./navigation";

export type ToolCategory = "pdf" | "text" | "convert" | "organize" | "edit" | "image" | "ai";

export interface CatalogTool {
    key: ToolKey;
    href: AppRoute;
    /** Where the tool belongs; the first is its home. */
    categories: readonly ToolCategory[];
    /** Extra words people search with (English; each language's names and descriptions match too). */
    keywords: readonly string[];
}

/**
 * Every tool, once — for the Documents page and tool search. Only tools that exist are listed; a new
 * tool is one entry here (plus its route, icon and copy).
 */
export const TOOL_CATALOG: readonly CatalogTool[] = [
    {
        key: "pdfOrganizer",
        href: ROUTES.pdfMerge,
        categories: ["pdf", "organize"],
        keywords: ["merge", "combine", "join", "split", "separate", "extract", "reorder", "sort", "delete pages", "remove pages", "duplicate", "arrange", "rotate", "turn", "orientation", "compress", "reduce", "smaller", "size", "shrink", "optimize", "view", "read", "open", "preview", "reader", "search", "print", "zoom", "pdf"],
    },
    { key: "pdfToImages", href: ROUTES.pdfToImages, categories: ["pdf", "convert"], keywords: ["convert", "export", "jpg", "jpeg", "png", "webp", "pdf to jpg", "pdf to png", "pdf to image"] },
    { key: "imagesToPdf", href: ROUTES.imagesToPdf, categories: ["pdf", "convert"], keywords: ["convert", "create pdf", "jpg to pdf", "png to pdf", "photo to pdf", "scan", "heic"] },
    { key: "pdfWatermark", href: ROUTES.pdfWatermark, categories: ["pdf", "edit"], keywords: ["watermark", "stamp", "confidential", "draft", "logo", "brand"] },
    { key: "pdfPageNumbers", href: ROUTES.pdfPageNumbers, categories: ["pdf", "edit"], keywords: ["page numbers", "numbering", "number pages", "footer", "header"] },
    { key: "pdfToText", href: ROUTES.pdfToText, categories: ["text", "convert"], keywords: ["convert", "extract text", "pdf to text", "txt", "word", "docx", "ocr", "copy text", "nepali"] },
    { key: "pdfToWord", href: ROUTES.pdfToWord, categories: ["pdf", "convert"], keywords: ["convert", "word", "docx", "doc", "pdf to word", "editable", "ocr", "nepali"] },
    { key: "pdfEditor", href: ROUTES.pdfEditor, categories: ["pdf", "edit"], keywords: ["edit", "annotate", "add text", "draw", "highlight", "underline", "strikethrough", "shapes", "arrow", "image", "delete pages", "fill"] },
    { key: "pdfSign", href: ROUTES.pdfSign, categories: ["pdf", "edit"], keywords: ["sign", "signature", "e-sign", "initials", "date", "fill and sign"] },
    { key: "pdfProtect", href: ROUTES.pdfProtect, categories: ["pdf", "edit"], keywords: ["protect", "password", "encrypt", "lock", "secure", "permissions", "aes"] },
    { key: "pdfUnlock", href: ROUTES.pdfUnlock, categories: ["pdf", "edit"], keywords: ["unlock", "remove password", "decrypt", "open", "restrictions"] },
    { key: "ocr", href: ROUTES.ocr, categories: ["text", "convert"], keywords: ["ocr", "extract text", "convert", "image to text", "pdf to text", "scan", "nepali", "devanagari", "editable"] },
    { key: "textEditor", href: ROUTES.textEditor, categories: ["text", "edit"], keywords: ["write", "rich text", "document", "format", "notes", "editor", "word processor", "links", "tables", "clean", "tidy", "spaces", "duplicate lines", "line breaks", "fix ocr", "uppercase", "lowercase", "title case", "sentence case", "capitalize", "convert case", "word count", "character count", "count", "reading time", "statistics"] },
    { key: "compressor", href: ROUTES.compress, categories: ["image"], keywords: ["compress", "reduce", "smaller", "size", "optimize", "shrink"] },
    { key: "removeBackground", href: ROUTES.removeBackground, categories: ["ai", "image"], keywords: ["background", "transparent", "cutout", "remove bg"] },
    { key: "upscaler", href: ROUTES.upscale, categories: ["ai", "image"], keywords: ["enlarge", "upscale", "resolution", "sharpen", "bigger"] },
    { key: "retouch", href: ROUTES.retouch, categories: ["ai", "image"], keywords: ["remove object", "repair", "fix", "clean up", "blemish"] },
    { key: "photoGenerator", href: ROUTES.photoGenerator, categories: ["ai", "image"], keywords: ["passport", "mrp", "id photo", "visa"] },
    { key: "watermarkRemover", href: ROUTES.watermarkRemover, categories: ["ai", "image"], keywords: ["watermark", "logo", "remove text"] },
    { key: "crop", href: ROUTES.crop, categories: ["image"], keywords: ["crop", "rotate", "flip", "straighten", "aspect ratio"] },
    { key: "editor", href: ROUTES.editor, categories: ["image"], keywords: ["adjust", "resize", "filters", "brightness", "colour", "color", "convert", "export"] },
];
