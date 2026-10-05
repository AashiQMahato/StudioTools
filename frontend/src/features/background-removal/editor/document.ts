import { useCallback, useEffect, useRef, useState } from "react";

/** Erase takes pixels away from the subject; restore paints them back from the original photo. */
export type BrushMode = "erase" | "restore";

export type TemplateId =
    | "studio-light"
    | "studio-dark"
    | "business-bokeh"
    | "business-slate"
    | "product-podium"
    | "product-mint"
    | "social-sunny"
    | "social-pop"
    | "minimal-horizon"
    | "minimal-arch"
    | "abstract-waves"
    | "abstract-blobs";

/** What sits behind the subject. Everything here is drawn on this device, never sent anywhere. */
export type BackgroundSpec =
    | { kind: "transparent" }
    | { kind: "colour"; value: string }
    | { kind: "gradient"; id: string; from: string; to: string; angle: number; radial: boolean }
    | { kind: "template"; id: TemplateId }
    /** A photo, filling the frame. `zoom` ≥ 1 crops in; `x`/`y` (0–1) choose which part stays in view. */
    | { kind: "image"; id: string; url: string; zoom: number; x: number; y: number };

/** Where the subject sits: an offset of its centre from the frame's centre, in image pixels, and a scale. */
export interface Placement {
    x: number;
    y: number;
    scale: number;
}

/** One brush stroke, in image pixels, so it means the same thing at any zoom. */
export interface Stroke {
    mode: BrushMode;
    /** Diameter. */
    size: number;
    /** 0 = hard edge, 1 = fully feathered. */
    softness: number;
    /** 0–1, for the whole stroke — overlapping dabs within it don't build up past it. */
    opacity: number;
    /** Flat [x0, y0, x1, y1, …]. */
    points: number[];
}

/**
 * Everything the user has changed, as plain data. The original photo and the model's mask are never
 * touched: the mask is rebuilt from the model's output plus `strokes`, so every edit is recoverable.
 */
export interface EditorDoc {
    background: BackgroundSpec;
    placement: Placement;
    strokes: readonly Stroke[];
}

const TRANSPARENT: BackgroundSpec = { kind: "transparent" };
const CENTRED: Placement = { x: 0, y: 0, scale: 1 };
export const INITIAL_DOC: EditorDoc = { background: TRANSPARENT, placement: CENTRED, strokes: [] };

/** A continuous change (dragging, a colour wheel, a slider) becomes one undo step once it settles. */
const SETTLE_MS = 450;

interface HistoryState<T> {
    past: T[];
    present: T;
    future: T[];
}

/**
 * Undo/redo over a whole document (the background editor's, or any other plain-data state). `commit` records a step at once; `preview` changes what's shown
 * without recording, and the change becomes a single step when it settles (or when `settle` is
 * called, e.g. on pointer-up) — so a drag is one undo, not a hundred.
 */
export function useDocHistory<T = EditorDoc>(initial: T) {
    const [state, setState] = useState<HistoryState<T>>({ past: [], present: initial, future: [] });
    /** The document as it was when the current continuous change began. */
    const anchor = useRef<T | null>(null);
    const timer = useRef<number | undefined>(undefined);

    const settle = useCallback(() => {
        window.clearTimeout(timer.current);
        const from = anchor.current;
        anchor.current = null;
        if (!from) return;
        setState((current) => (current.present === from ? current : { past: [...current.past, from], present: current.present, future: [] }));
    }, []);

    const preview = useCallback(
        (update: (doc: T) => T) => {
            setState((current) => {
                if (!anchor.current) anchor.current = current.present;
                return { ...current, present: update(current.present) };
            });
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(settle, SETTLE_MS);
        },
        [settle],
    );

    const commit = useCallback(
        (update: (doc: T) => T) => {
            window.clearTimeout(timer.current);
            const from = anchor.current;
            anchor.current = null;
            setState((current) => {
                const next = update(current.present);
                const base = from ?? current.present;
                if (next === base) return { ...current, present: next };
                return { past: [...current.past, base], present: next, future: [] };
            });
        },
        [],
    );

    const undo = useCallback(() => {
        settle();
        setState((current) => {
            const previous = current.past.at(-1);
            if (!previous) return current;
            return { past: current.past.slice(0, -1), present: previous, future: [current.present, ...current.future] };
        });
    }, [settle]);

    const redo = useCallback(() => {
        settle();
        setState((current) => {
            const [next, ...rest] = current.future;
            if (!next) return current;
            return { past: [...current.past, current.present], present: next, future: rest };
        });
    }, [settle]);

    useEffect(() => () => window.clearTimeout(timer.current), []);

    return {
        doc: state.present,
        canUndo: state.past.length > 0,
        canRedo: state.future.length > 0,
        preview,
        commit,
        settle,
        undo,
        redo,
    };
}

export type DocHistory<T = EditorDoc> = ReturnType<typeof useDocHistory<T>>;
