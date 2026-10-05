import { create } from "zustand";
import { loadDraftEdits, saveDraftEdits } from "@/lib/draft";
import { NEUTRAL_ADJUSTMENTS } from "./color";
import { fullRect } from "./geometry";
import type { EditState } from "./render";

export type AspectId = "free" | "original" | "1:1" | "16:9" | "4:3" | "3:2" | "5:4";

interface Session {
    imageId: string;
    source: { width: number; height: number };
    present: EditState;
    past: EditState[];
    future: EditState[];
    aspect: AspectId;
    /** Flip preset ratios to portrait (e.g. 16:9 → 9:16). */
    portrait: boolean;
}

interface EditStore {
    session: Session | null;
    /** Start (or keep) the session for this image. */
    open: (imageId: string, width: number, height: number) => void;
    /** Replace the live state without recording history (continuous gestures, slider drags). */
    preview: (next: EditState) => void;
    /** Record the current state as one undoable step (call when a gesture or change completes). */
    commit: (next?: EditState) => void;
    undo: () => void;
    redo: () => void;
    reset: () => void;
    setAspect: (aspect: AspectId, portrait?: boolean) => void;
}

function initialEdit(width: number, height: number): EditState {
    return {
        orientation: { quarter: 0, flipX: false, flipY: false, angle: 0 },
        crop: fullRect(width, height, 0),
        adjustments: { ...NEUTRAL_ADJUSTMENTS },
        filter: "original",
        resize: null,
    };
}

const HISTORY_LIMIT = 60;
/** The last committed state, to decide whether a commit changed anything. */
let committed: EditState | null = null;

export const useEditStore = create<EditStore>()((set, get) => ({
    session: null,

    open: (imageId, width, height) => {
        if (get().session?.imageId === imageId) return;
        // Pick up where the user left off before a reload, if the draft belongs to this image.
        const saved = loadDraftEdits<Pick<Session, "present" | "past" | "future" | "aspect" | "portrait">>(imageId);
        const present = saved?.present ?? initialEdit(width, height);
        committed = present;
        set({
            session: {
                imageId,
                source: { width, height },
                present,
                past: saved?.past ?? [],
                future: saved?.future ?? [],
                aspect: saved?.aspect ?? "free",
                portrait: saved?.portrait ?? false,
            },
        });
    },

    preview: (next) => {
        const session = get().session;
        if (session) set({ session: { ...session, present: next } });
    },

    commit: (next) => {
        const session = get().session;
        if (!session) return;
        const present = next ?? session.present;
        if (committed && JSON.stringify(committed) === JSON.stringify(present)) {
            if (next) set({ session: { ...session, present } });
            return;
        }
        const past = committed ? [...session.past, committed].slice(-HISTORY_LIMIT) : session.past;
        committed = present;
        set({ session: { ...session, present, past, future: [] } });
    },

    undo: () => {
        const session = get().session;
        const previous = session?.past.at(-1);
        if (!session || !previous) return;
        committed = previous;
        set({ session: { ...session, present: previous, past: session.past.slice(0, -1), future: [session.present, ...session.future] } });
    },

    redo: () => {
        const session = get().session;
        const next = session?.future[0];
        if (!session || !next) return;
        committed = next;
        set({ session: { ...session, present: next, past: [...session.past, session.present], future: session.future.slice(1) } });
    },

    reset: () => {
        const session = get().session;
        if (!session) return;
        get().commit(initialEdit(session.source.width, session.source.height));
        set((state) => (state.session ? { session: { ...state.session, aspect: "free", portrait: false } } : state));
    },

    setAspect: (aspect, portrait) => {
        const session = get().session;
        if (session) set({ session: { ...session, aspect, portrait: portrait ?? session.portrait } });
    },
}));

export function isUnedited(state: EditState, width: number, height: number) {
    return JSON.stringify(state) === JSON.stringify(initialEdit(width, height));
}

// Save the committed edit history (not every in-progress drag) so a reload restores it.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useEditStore.subscribe((state, previous) => {
    const session = state.session;
    if (!session || (previous.session && session.past === previous.session.past && session.future === previous.session.future && session.aspect === previous.session.aspect && session.portrait === previous.session.portrait)) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        const { imageId, present, past, future, aspect, portrait } = session;
        saveDraftEdits(imageId, { present: committed ?? present, past: past.slice(-30), future: future.slice(0, 30), aspect, portrait });
    }, 250);
});
