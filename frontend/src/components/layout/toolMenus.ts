import { ArrowLeftRight, Files, type LucideIcon, Replace, ScanText, ShieldCheck, SlidersHorizontal, Sparkles, Gauge, FileImage, FileOutput } from "lucide-react";
import type { Dictionary } from "@/i18n";
import { ORGANIZE_MODES, type ToolKey } from "@/lib/constants/navigation";
import { type AppRoute, ROUTES } from "@/lib/constants/routes";
import { TOOL_ICONS } from "./toolIcons";

/*
 * The navbar's tool menus, as data. Each menu (Image Tools, Documents) renders its desktop mega-menu,
 * its mobile accordion and its overview page from one list, so a new tool is one entry here (plus its
 * copy). Every item opens a page that exists. Entries that are a mode of another page (Resize, Rotate &
 * Flip, Extract pages, PDF to JPG/PNG, Find & Replace) open that page, with a preset where it has one.
 */

/** Menu entries that aren't tools of their own, so their copy lives in `nav.documentMenu.items`. */
type MenuExtraKey = keyof Dictionary["nav"]["documentMenu"]["items"];
export type MenuItemKey = ToolKey | MenuExtraKey;
export type DocumentMenuSectionKey = keyof Dictionary["nav"]["documentMenu"]["sections"];
export type ImageMenuSectionKey = keyof Dictionary["nav"]["imageMenu"]["sections"];
export type MenuSectionKey = DocumentMenuSectionKey | ImageMenuSectionKey;

export interface MenuItem {
    key: MenuItemKey;
    icon: LucideIcon;
    href: AppRoute;
    /** A preset the page reads from its query, e.g. `?format=png`. */
    search?: string;
    /** Opens another tool's page, so it never reads as the current page itself. */
    alias?: true;
    /**
     * A mode or panel of another tool (Word Counter of the Text Editor, Merge of Organize PDF): listed in
     * the menus, but not in the studio sidebar, where that tool stands for it.
     */
    mode?: true;
    /** Other pages of this tool: it reads as the current tool on any of them. */
    members?: readonly AppRoute[];
    /** Marked "New" on the overview page. */
    isNew?: true;
}

export interface MenuSection<K extends MenuSectionKey = MenuSectionKey> {
    key: K;
    icon: LucideIcon;
    items: readonly MenuItem[];
}

/** One menu: its sections, where their copy lives, and its overview page. */
export interface ToolMenu<K extends MenuSectionKey = MenuSectionKey> {
    sections: readonly MenuSection<K>[];
    /** The navbar's shorter list — the most used tools; the overview page and the studio list them all. */
    featured?: readonly MenuSection<K>[];
    // Method syntax, so a menu with its own section keys still counts as a menu in general.
    sectionCopy(t: Dictionary, key: K): { title: string; description: string };
    viewAll(t: Dictionary): string;
    href: AppRoute;
}

const tool = (key: ToolKey, href: AppRoute): MenuItem => ({ key, icon: TOOL_ICONS[key], href });

/** Tools from a menu's full list, by key (for its featured columns). */
const pick = (sections: readonly MenuSection[], ...keys: MenuItemKey[]) => keys.map((key) => sections.flatMap((section) => section.items).find((item) => item.key === key)!);

const IMAGE_SECTIONS: readonly MenuSection<ImageMenuSectionKey>[] = [
    {
        key: "aiTools",
        icon: Sparkles,
        items: [
            tool("removeBackground", ROUTES.removeBackground),
            tool("upscaler", ROUTES.upscale),
            tool("retouch", ROUTES.retouch),
            tool("watermarkRemover", ROUTES.watermarkRemover),
            tool("photoGenerator", ROUTES.photoGenerator),
        ],
    },
    {
        key: "editAdjust",
        icon: SlidersHorizontal,
        items: [
            tool("editor", ROUTES.editor),
            tool("crop", ROUTES.crop),
            // The crop tool rotates, flips and straightens.
            { ...tool("rotateFlip", ROUTES.crop), alias: true },
        ],
    },
    {
        key: "optimize",
        icon: Gauge,
        items: [
            tool("compressor", ROUTES.compress),
            // Resizing is a panel of the editor.
            { ...tool("resize", ROUTES.editor), alias: true },
        ],
    },
];

export const imageMenu: ToolMenu<ImageMenuSectionKey> = {
    href: ROUTES.imageTools,
    sectionCopy: (t, key) => t.nav.imageMenu.sections[key],
    viewAll: (t) => t.nav.imageMenu.viewAll,
    sections: IMAGE_SECTIONS,
    // Two columns: the AI tools, and everything for editing and optimizing.
    featured: [
        { key: "aiTools", icon: Sparkles, items: pick(IMAGE_SECTIONS, "removeBackground", "upscaler", "retouch", "watermarkRemover", "photoGenerator") },
        { key: "editOptimize", icon: SlidersHorizontal, items: pick(IMAGE_SECTIONS, "editor", "crop", "rotateFlip", "compressor", "resize") },
    ],
};

const DOCUMENT_SECTIONS: readonly MenuSection<DocumentMenuSectionKey>[] = [
    {
        key: "textOcr",
        icon: ScanText,
        items: [
            { ...tool("ocr", ROUTES.ocr), isNew: true },
            // Cleaning, find & replace, word counts and case conversion are the Text Editor's own panels.
            { ...tool("textEditor", ROUTES.textEditor), members: [ROUTES.textCleaner, ROUTES.wordCounter, ROUTES.caseConverter] },
            { ...tool("textCleaner", ROUTES.textCleaner), mode: true },
            { key: "findReplace", icon: Replace, href: ROUTES.textEditor, search: "?find=replace", alias: true, mode: true },
            { ...tool("wordCounter", ROUTES.wordCounter), mode: true },
            { ...tool("caseConverter", ROUTES.caseConverter), mode: true },
        ],
    },
    {
        key: "pdfTools",
        icon: Files,
        items: [
            // One feature in several modes (its mode bar moves between them).
            { key: "organizePdf", icon: TOOL_ICONS.pdfOrganize, href: ROUTES.pdfOrganize, members: ORGANIZE_MODES.map((mode) => mode.href) },
            { ...tool("pdfMerge", ROUTES.pdfMerge), mode: true },
            { ...tool("pdfSplit", ROUTES.pdfSplit), mode: true },
            { ...tool("pdfCompress", ROUTES.pdfCompress), mode: true },
            { ...tool("pdfRotate", ROUTES.pdfRotate), mode: true },
            // Organize pages selects pages and extracts them into a new PDF.
            { key: "extractPages", icon: FileOutput, href: ROUTES.pdfOrganize, alias: true, mode: true },
        ],
    },
    {
        key: "convert",
        icon: ArrowLeftRight,
        items: [
            tool("pdfToWord", ROUTES.pdfToWord),
            tool("pdfToText", ROUTES.pdfToText),
            tool("pdfToImages", ROUTES.pdfToImages),
            tool("imagesToPdf", ROUTES.imagesToPdf),
            { key: "pdfToJpg", icon: FileImage, href: ROUTES.pdfToImages, search: "?format=jpg", alias: true, mode: true },
            { key: "pdfToPng", icon: FileImage, href: ROUTES.pdfToImages, search: "?format=png", alias: true, mode: true },
        ],
    },
    {
        key: "editSecure",
        icon: ShieldCheck,
        items: [
            tool("pdfEditor", ROUTES.pdfEditor),
            tool("pdfSign", ROUTES.pdfSign),
            tool("pdfWatermark", ROUTES.pdfWatermark),
            tool("pdfPageNumbers", ROUTES.pdfPageNumbers),
            tool("pdfProtect", ROUTES.pdfProtect),
            tool("pdfUnlock", ROUTES.pdfUnlock),
        ],
    },
];


export const documentMenu: ToolMenu<DocumentMenuSectionKey> = {
    href: ROUTES.documents,
    sectionCopy: (t, key) => t.nav.documentMenu.sections[key],
    viewAll: (t) => t.nav.documentMenu.viewAll,
    sections: DOCUMENT_SECTIONS,
    // Three columns of five: text, PDFs (organizing and converting together), editing and securing.
    featured: [
        { key: "textOcr", icon: ScanText, items: pick(DOCUMENT_SECTIONS, "ocr", "textEditor", "textCleaner", "findReplace", "wordCounter") },
        { key: "pdfConvert", icon: Files, items: pick(DOCUMENT_SECTIONS, "pdfMerge", "pdfSplit", "pdfCompress", "pdfToWord", "pdfToImages") },
        { key: "editSecure", icon: ShieldCheck, items: pick(DOCUMENT_SECTIONS, "pdfEditor", "pdfSign", "pdfWatermark", "pdfProtect", "pdfUnlock") },
    ],
};

/** Title and one-line description of a menu entry. */
export function menuItemCopy(t: Dictionary, key: MenuItemKey) {
    const extras = t.nav.documentMenu.items;
    return key in extras ? extras[key as MenuExtraKey] : t.nav.toolItems[key as ToolKey];
}

/** The entry for the page you're on. An alias never is: it opens another entry's page. */
export const isCurrentItem = (item: MenuItem, pathname: string) => !item.alias && (pathname === item.href || Boolean(item.members?.includes(pathname as AppRoute)));

/** The studio sidebar's list: each tool once — modes and presets of another tool are left to it. */
export const sidebarSections = <K extends MenuSectionKey>(menu: ToolMenu<K>) =>
    menu.sections.map((section) => ({ ...section, items: section.items.filter((item) => !item.mode) })).filter((section) => section.items.length > 0);


/** What the navbar shows of a menu: its featured tools, or all of them. */
export const navSections = <K extends MenuSectionKey>(menu: ToolMenu<K>) => menu.featured ?? menu.sections;
