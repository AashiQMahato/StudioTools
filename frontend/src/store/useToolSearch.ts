import { create } from "zustand";

const RECENT_KEY = "recent-tools";
const RECENT_MAX = 4;

function readRecent(): string[] {
    try {
        const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
        return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string").slice(0, RECENT_MAX) : [];
    } catch {
        return [];
    }
}

interface ToolSearchState {
    /** Whether the tool search palette is open (the navbar, the Tools menu and ⌘K all open it). */
    open: boolean;
    setOpen: (open: boolean) => void;
    /** Tools opened from search, most recent first (kept on this device only). */
    recent: string[];
    remember: (id: string) => void;
    /**
     * A page with its own search field (the Image Tools and Documents pages) claims ⌘K / Ctrl+K while
     * it's open: the shortcut focuses that field instead of opening the palette over it.
     */
    localSearch: (() => void) | null;
    setLocalSearch: (focus: (() => void) | null) => void;
}

export const useToolSearch = create<ToolSearchState>()((set, get) => ({
    open: false,
    setOpen: (open) => set({ open }),
    recent: readRecent(),
    remember: (id) => {
        const recent = [id, ...get().recent.filter((item) => item !== id)].slice(0, RECENT_MAX);
        try {
            localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
        } catch {
            // Not remembered across visits; still shown this session.
        }
        set({ recent });
    },
    localSearch: null,
    setLocalSearch: (localSearch) => set({ localSearch }),
}));
