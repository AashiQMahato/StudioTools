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
export const TOOL_ACCENT: Partial<Record<MenuItemKey, string>> = {
    removeBackground: "#8B5CF6",
    objectRemover: "#EC4899",
    photoRestoration: "#10B981",
    socialResizer: "#F97316",
    documentScanner: "#0EA5E9",
    upscaler: "#6366F1",
    retouch: "#EC4899",
    watermarkRemover: "#F59E0B",
    photoGenerator: "#0EA5E9",
    editor: "#3B82F6",
    crop: "#10B981",
    rotateFlip: "#14B8A6",
    compressor: "#F43F5E",
    resize: "#F97316",
    ocr: "#6366F1",
    textEditor: "#3B82F6",
    textCleaner: "#10B981",
    findReplace: "#F59E0B",
    wordCounter: "#D946EF",
    caseConverter: "#14B8A6",
    organizePdf: "#F43F5E",
    pdfMerge: "#EF4444",
    pdfSplit: "#F43F5E",
    pdfCompress: "#EF4444",
    pdfRotate: "#F43F5E",
    extractPages: "#EF4444",
    pdfToWord: "#2563EB",
    pdfToText: "#0D9488",
    pdfToImages: "#0EA5E9",
    imagesToPdf: "#06B6D4",
    pdfToJpg: "#0EA5E9",
    pdfToPng: "#3B82F6",
    pdfEditor: "#8B5CF6",
    pdfSign: "#7C3AED",
    pdfWatermark: "#A855F7",
    pdfPageNumbers: "#6366F1",
    pdfProtect: "#7C3AED",
    pdfUnlock: "#8B5CF6",
};
/** A tool's name and description in the current language. */
export const toolCopy = (t: Dictionary, tool: ToolEntry) => menuItemCopy(t, tool.id);
