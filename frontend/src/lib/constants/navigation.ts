import { type AppRoute, ROUTES } from "./routes";

/* ------------------------------------------------------------------ Navbar
 * One source for the desktop mega menu and the mobile accordion. Every entry points at a route that
 * exists: Resize has no page of its own, so it opens the editor (where the resize panel lives), and
 * Rotate & Flip opens the crop tool, whose controls rotate, flip and straighten.
 */
export type ToolKey = "removeBackground" | "upscaler" | "retouch" | "photoGenerator" | "watermarkRemover" | "compressor" | "crop" | "resize" | "rotateFlip" | "editor" | "ocr" | DocumentToolKey;
export type DocumentToolKey = "pdfOrganizer" | "pdfMerge" | "pdfSplit" | "pdfOrganize" | "pdfRotate" | "pdfToImages" | "imagesToPdf" | "pdfCompress" | "pdfWatermark" | "pdfPageNumbers" | "pdfToText" | "pdfToWord" | "pdfViewer" | "pdfEditor" | "pdfSign" | "pdfProtect" | "pdfUnlock" | "textEditor" | "textCleaner" | "caseConverter" | "wordCounter";
export type ToolGroupKey = "ai" | "image" | "editor" | "text" | "pdf" | "pdfConvert" | "pdfEdit";

export interface NavTool {
    key: ToolKey;
    href: AppRoute;
    /** Opens another tool's page, so it never reads as the current page itself. */
    alias?: true;
    /** One feature with several modes (each its own page): it reads as current on any of them. */
    members?: readonly NavTool[];
}

export interface NavToolGroup {
    key: ToolGroupKey;
    items: readonly NavTool[];
}

const TOOL_GROUPS: readonly NavToolGroup[] = [
    {
        key: "ai",
        items: [
            { key: "removeBackground", href: ROUTES.removeBackground },
            { key: "upscaler", href: ROUTES.upscale },
            { key: "retouch", href: ROUTES.retouch },
            { key: "photoGenerator", href: ROUTES.photoGenerator },
            { key: "watermarkRemover", href: ROUTES.watermarkRemover },
        ],
    },
    {
        key: "image",
        items: [
            { key: "crop", href: ROUTES.crop },
            { key: "compressor", href: ROUTES.compress },
            { key: "resize", href: ROUTES.editor, alias: true },
            { key: "rotateFlip", href: ROUTES.crop, alias: true },
        ],
    },
    { key: "editor", items: [{ key: "editor", href: ROUTES.editor }] },
];

/**
 * Organize PDF: one feature, six modes — merge, split, reorder pages, rotate, compress and view. Each
 * mode is its own page; the feature's mode bar moves between them, carrying the open file along.
 */
export const ORGANIZE_MODES: readonly NavTool[] = [
    { key: "pdfMerge", href: ROUTES.pdfMerge },
    { key: "pdfSplit", href: ROUTES.pdfSplit },
    { key: "pdfOrganize", href: ROUTES.pdfOrganize },
    { key: "pdfRotate", href: ROUTES.pdfRotate },
    { key: "pdfCompress", href: ROUTES.pdfCompress },
    { key: "pdfViewer", href: ROUTES.pdfViewer },
];
export const isOrganizeMode = (tool: ToolKey) => ORGANIZE_MODES.some((mode) => mode.key === tool);

/** The Text Editor's panels that have their own addresses (old links, search): they open the editor on that panel. */
const TEXT_EDITOR_PANELS: readonly NavTool[] = [
    { key: "textCleaner", href: ROUTES.textCleaner },
    { key: "caseConverter", href: ROUTES.caseConverter },
    { key: "wordCounter", href: ROUTES.wordCounter },
];

/** The Documents menu: text tools; PDF (organizing and converting); editing, signing and securing. */
const DOCUMENT_GROUPS: readonly NavToolGroup[] = [
    {
        key: "text",
        items: [
            { key: "ocr", href: ROUTES.ocr },
            // Cleaning, case conversion and word counts are the Text Editor's own panels, not separate tools.
            { key: "textEditor", href: ROUTES.textEditor, members: TEXT_EDITOR_PANELS },
            { key: "pdfToText", href: ROUTES.pdfToText },
        ],
    },
    {
        key: "pdf",
        items: [
            { key: "pdfOrganizer", href: ROUTES.pdfMerge, members: ORGANIZE_MODES },
            { key: "pdfToWord", href: ROUTES.pdfToWord },
            { key: "pdfToImages", href: ROUTES.pdfToImages },
            { key: "imagesToPdf", href: ROUTES.imagesToPdf },
        ],
    },
    {
        key: "pdfEdit",
        items: [
            { key: "pdfEditor", href: ROUTES.pdfEditor },
            { key: "pdfSign", href: ROUTES.pdfSign },
            { key: "pdfWatermark", href: ROUTES.pdfWatermark },
            { key: "pdfPageNumbers", href: ROUTES.pdfPageNumbers },
            { key: "pdfProtect", href: ROUTES.pdfProtect },
            { key: "pdfUnlock", href: ROUTES.pdfUnlock },
        ],
    },
];
export const DOCUMENT_ROUTES: readonly AppRoute[] = [ROUTES.documents, ...DOCUMENT_GROUPS.flatMap((group) => group.items.flatMap((item) => [item.href, ...(item.members ?? []).map((member) => member.href)]))];

/** Every route the Tools menu covers — the trigger reads as current on any of them. */
export const TOOL_ROUTES: readonly AppRoute[] = [ROUTES.imageTools, ROUTES.removeBackground, ROUTES.upscale, ROUTES.retouch, ROUTES.photoGenerator, ROUTES.watermarkRemover, ROUTES.crop, ROUTES.compress, ROUTES.editor];

/** In-page sections of the home page. There is no About section or page, so there is no About link. */
export const SECTION_LINKS = [
    { key: "howItWorks", id: "how-it-works" },
    { key: "features", id: "features" },
] as const;

export type SectionKey = (typeof SECTION_LINKS)[number]["key"];

/**
 * The studio's own list: one entry per page. Resize and Rotate & Flip are shortcuts into the editor
 * and the crop tool (useful as landing-page entry points), so inside the studio they'd only repeat.
 */
const IMAGE_STUDIO_GROUPS: readonly NavToolGroup[] = TOOL_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => !item.alias) })).filter((group) => group.items.length > 0);

/** A tool of the document suite (any PDF or text tool, Organize PDF's modes included). */
export const isDocumentTool = (tool: ToolKey) => DOCUMENT_GROUPS.some((group) => group.items.some((item) => item.key === tool || item.members?.some((member) => member.key === tool)));

/** Image tools and text tools are separate sections: inside one, the studio lists only that section's tools. */
export const studioToolGroups = (tool: ToolKey): readonly NavToolGroup[] => (isDocumentTool(tool) ? DOCUMENT_GROUPS : IMAGE_STUDIO_GROUPS);
