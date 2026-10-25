import { getSceneVersion, serializeAsJSON } from "@excalidraw/excalidraw";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { SAVED_SCENE_VERSION, saveScene } from "./storage";

/** Saves wait for a pause in editing, but never longer than this while you keep drawing. */
const SAVE_DELAY = 400;
const SAVE_MAX_WAIT = 3000;

/** For the top bar: up to date, about to save, or this browser won't keep it. */
export type SaveStatus = "saved" | "pending" | "failed";

/**
 * A cheap fingerprint of what a save would contain: the elements' versions, the images, the view and
 * the board settings. The editor reports a change for every pointer move and render; only a different
 * fingerprint is a change worth saving.
 */
function fingerprint({ elements, appState, files }: PendingSave) {
    return [getSceneVersion(elements), Object.keys(files).join(","), appState.scrollX, appState.scrollY, appState.zoom.value, appState.name, appState.viewBackgroundColor, appState.gridModeEnabled, appState.gridSize].join("|");
}

interface PendingSave {
    elements: readonly OrderedExcalidrawElement[];
    appState: AppState;
    files: BinaryFiles;
}

/**
 * Debounced local autosave (with a maximum wait), flushed when the page is hidden or the editor closes.
 * Saves the native format plus the view and the board's name; identical states aren't written twice.
 */
export function useAutosave() {
    const pending = useRef<PendingSave | null>(null);
    const timer = useRef<number | undefined>(undefined);
    const firstChange = useRef<number | null>(null);
    const lastSaved = useRef<string | null>(null);
    const lastSeen = useRef<string | null>(null);
    const [status, setStatus] = useState<SaveStatus>("saved");
    const [savedAt, setSavedAt] = useState<number | null>(null);

    const flush = useCallback(() => {
        window.clearTimeout(timer.current);
        timer.current = undefined;
        firstChange.current = null;
        const next = pending.current;
        pending.current = null;
        if (!next) return;
        const scene = serializeAsJSON(next.elements, next.appState, next.files, "local");
        const view = { scrollX: next.appState.scrollX, scrollY: next.appState.scrollY, zoom: next.appState.zoom.value };
        const name = next.appState.name ?? undefined;
        const key = `${scene}\n${view.scrollX},${view.scrollY},${view.zoom}\n${name}`;
        if (key === lastSaved.current) {
            setStatus("saved");
            return;
        }
        lastSaved.current = key;
        void saveScene({ version: SAVED_SCENE_VERSION, savedAt: Date.now(), scene, view, name }).then((ok) => {
            if (lastSaved.current !== key) return;
            if (ok) {
                setSavedAt(Date.now());
                // A newer change may already be waiting; it reports its own state.
                if (!pending.current) setStatus("saved");
            } else {
                lastSaved.current = null;
                lastSeen.current = null;
                setStatus("failed");
            }
        });
    }, []);

    const schedule = useCallback(
        (change: PendingSave) => {
            const seen = fingerprint(change);
            if (seen === lastSeen.current) return;
            lastSeen.current = seen;
            pending.current = change;
            const now = Date.now();
            firstChange.current ??= now;
            window.clearTimeout(timer.current);
            const wait = Math.max(0, Math.min(SAVE_DELAY, firstChange.current + SAVE_MAX_WAIT - now));
            timer.current = window.setTimeout(flush, wait);
            setStatus((current) => (current === "failed" ? current : "pending"));
        },
        [flush],
    );

    useEffect(() => {
        const onHide = () => document.visibilityState === "hidden" && flush();
        window.addEventListener("pagehide", flush);
        document.addEventListener("visibilitychange", onHide);
        return () => {
            window.removeEventListener("pagehide", flush);
            document.removeEventListener("visibilitychange", onHide);
            flush();
        };
    }, [flush]);

    return { schedule, flush, status, savedAt };
}
