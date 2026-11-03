import type { LucideIcon } from "lucide-react";
import type { Dictionary } from "@/i18n";
import { DOCUMENT_ROUTES } from "@/lib/constants/navigation";
import type { AppRoute } from "@/lib/constants/routes";
import { TOOL_CATALOG } from "@/lib/constants/toolCatalog";
import { documentMenu, imageMenu, type MenuItem, type MenuItemKey, menuItemCopy } from "./toolMenus";

/*
 * The one list of tools for navigation and search. Routes, icons and flags come from the tool menus
 * (which the studio sidebar and overview pages also use) and search words from the tool catalog, so a
 * new tool is added there once; this file only decides where it sits in the navbar.
 */

export type NavGroup = "ai" | "image" | "pdf";
export const NAV_GROUPS: readonly NavGroup[] = ["ai", "image", "pdf"];

/** The navbar's columns, in display order. Every tool appears in one column only. */
const GROUP_TOOLS: Record<NavGroup, readonly MenuItemKey[]> = {
    ai: ["removeBackground", "upscaler", "objectRemover", "retouch", "photoRestoration", "watermarkRemover", "photoGenerator"],
    image: ["editor", "compressor", "socialResizer", "ocr", "pdfToText", "textEditor", "textCleaner"],
    pdf: ["pdfMerge", "pdfSplit", "pdfCompress", "pdfToWord", "pdfEditor", "pdfSign", "organizePdf", "documentScanner"],
};

/** Shortcuts at the top of the Tools menu and the search box's suggestions. */
const POPULAR: readonly MenuItemKey[] = ["removeBackground", "upscaler", "editor", "compressor"];

/** The AI Studio menu: the AI tools worth opening first. */
const AI_STUDIO: readonly MenuItemKey[] = ["removeBackground", "upscaler", "objectRemover", "photoRestoration", "retouch"];

export interface ToolEntry {
    id: MenuItemKey;
    route: AppRoute;
    /** A preset the page reads from its query. */
    search?: string;
    icon: LucideIcon;
    /** `soon` tools are listed but not linked. Every tool today is available. */
    status: "available" | "soon";
    featured: boolean;
    isNew: boolean;
    keywords: readonly string[];
}

const allItems: readonly MenuItem[] = [...imageMenu.sections, ...documentMenu.sections].flatMap((section) => section.items);

function entry(item: MenuItem): ToolEntry {
    return {
        id: item.key,
        route: item.href,
        search: item.search,
        icon: item.icon,
        status: "available",
        featured: POPULAR.includes(item.key),
        isNew: Boolean(item.isNew),
        keywords: TOOL_CATALOG.find((tool) => tool.key === item.key)?.keywords ?? [],
    };
}

/** Every tool once (the first menu entry for a key wins), for search and directories. */
export const TOOL_REGISTRY: readonly ToolEntry[] = [...new Map(allItems.map((item) => [item.key, item])).values()].map(entry);

const byId = new Map(TOOL_REGISTRY.map((tool) => [tool.id, tool]));
const pickAll = (ids: readonly MenuItemKey[]) =>
    ids.map((id) => {
        const tool = byId.get(id);
        if (!tool) throw new Error(`The navbar lists "${id}", which isn't a tool in the menus.`);
        return tool;
    });

export const groupTools = (group: NavGroup) => pickAll(GROUP_TOOLS[group]);
// Resolved once at load: a typo in a column fails the tests (and the app) instead of silently dropping a tool.
export const popularTools = () => pickAll(POPULAR);
export const aiStudioTools = () => pickAll(AI_STUDIO);

/** Routes of the AI group, so the AI Studio trigger reads as current on them (and Tools doesn't). */
export const AI_ROUTES: readonly string[] = groupTools("ai").map((tool) => tool.route);
export { DOCUMENT_ROUTES };

/** Each tool's own colour (icon tile, card tint, arrow). Tools without one take their section's. */
/**
 * The suite's six accent hues (deepened just enough to read as icons on white and on graphite). Each
 * tool takes one, chosen by what it does, so neighbouring tools differ and families stay recognisable.
 */
export const HUES = {
    indigo: "#5367E8",
    violet: "#7E5BE0",
    sky: "#2A93C4",
    green: "#1E9A70",
    amber: "#BF8019",
    coral: "#D9606B",
} as const;
const { indigo, violet, sky, green, amber, coral } = HUES;

export const TOOL_ACCENT: Partial<Record<MenuItemKey, string>> = {
    removeBackground: indigo,
    upscaler: violet,
    objectRemover: coral,
    retouch: violet,
    photoRestoration: amber,
    watermarkRemover: sky,
    photoGenerator: green,
    editor: indigo,
    crop: amber,
    rotateFlip: amber,
    compressor: green,
    resize: sky,
    socialResizer: coral,
    documentScanner: sky,
    ocr: violet,
    textEditor: indigo,
    textCleaner: green,
    findReplace: amber,
    wordCounter: sky,
    caseConverter: violet,
    organizePdf: coral,
    pdfMerge: coral,
    pdfSplit: coral,
    pdfCompress: green,
    pdfRotate: amber,
    extractPages: coral,
    pdfToWord: indigo,
    pdfToText: violet,
    pdfToImages: sky,
    imagesToPdf: sky,
    pdfToJpg: sky,
    pdfToPng: sky,
    pdfEditor: indigo,
    pdfSign: violet,
    pdfWatermark: amber,
    pdfPageNumbers: sky,
    pdfProtect: green,
    pdfUnlock: green,
};
/** A tool's name and description in the current language. */
export const toolCopy = (t: Dictionary, tool: ToolEntry) => menuItemCopy(t, tool.id);
