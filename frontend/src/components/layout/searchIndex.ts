import { type LucideIcon, Presentation } from "lucide-react";
import type { Dictionary } from "@/i18n";
import { type AppRoute, ROUTES } from "@/lib/constants/routes";
import { TOOL_CATALOG } from "@/lib/constants/toolCatalog";
import { documentMenu, imageMenu, type MenuItemKey, menuItemCopy } from "./toolMenus";
import { popularTools } from "./toolRegistry";

/** One thing tool search can open: a tool (or a mode of one) from the menus, or the Whiteboard. */
export interface SearchEntry {
    id: MenuItemKey | "whiteboard";
    route: AppRoute;
    /** A preset the page reads from its query. */
    search?: string;
    icon: LucideIcon;
    title: string;
    description: string;
    /** The menu section it sits in ("AI tools", "Convert"…), shown beside each result. */
    category: string;
    keywords: readonly string[];
}

const WHITEBOARD_KEYWORDS = ["draw", "drawing", "sketch", "diagram", "flowchart", "wireframe", "board", "canvas", "brainstorm", "mind map", "shapes", "arrows", "excalidraw"];

/**
 * Everything search covers, in the page's language: every entry of the Image Tools and Documents menus
 * (once each — the first section wins), with its section as the category and the catalog's search
 * words, plus the Whiteboard. Built from the same lists as the navbar, so search can't drift from it.
 */
export function buildSearchIndex(t: Dictionary): SearchEntry[] {
    const seen = new Set<string>();
    const entries: SearchEntry[] = [];
    for (const menu of [imageMenu, documentMenu] as const) {
        for (const section of menu.sections) {
            const category = (menu.sectionCopy as (t: Dictionary, key: string) => { title: string })(t, section.key).title;
            for (const item of section.items) {
                if (seen.has(item.key)) continue;
                seen.add(item.key);
                const { title, description } = menuItemCopy(t, item.key);
                const keywords = TOOL_CATALOG.find((tool) => tool.key === item.key)?.keywords ?? [];
                entries.push({ id: item.key, route: item.href, search: item.search, icon: item.icon, title, description, category, keywords: [...keywords, category] });
            }
        }
    }
    const whiteboard = t.nav.mega.search.whiteboard;
    entries.push({ id: "whiteboard", route: ROUTES.whiteboard, icon: Presentation, title: whiteboard.title, description: whiteboard.description, category: whiteboard.category, keywords: [...WHITEBOARD_KEYWORDS, whiteboard.category] });
    return entries;
}

/** What the palette suggests before you type: the popular tools, then the Whiteboard. */
export function suggestedEntries(index: readonly SearchEntry[]): SearchEntry[] {
    const ids = [...popularTools().map((tool) => tool.id), "whiteboard"];
    return ids.map((id) => index.find((entry) => entry.id === id)).filter((entry): entry is SearchEntry => Boolean(entry));
}
