import { useCallback, useEffect, useState } from "react";

/*
 * Undo and redo for the top bar. The package has no public undo API, so this drives the editor's own
 * undo/redo buttons (kept in the page, out of sight — see whiteboard.css), found by the test ids the
 * editor gives them, and mirrors their enabled state. Undo history itself stays entirely the editor's.
 */
const UNDO = '[data-testid="button-undo"]';
const REDO = '[data-testid="button-redo"]';

const enabled = (button: HTMLButtonElement | null) => Boolean(button && !button.disabled && button.getAttribute("aria-disabled") !== "true");

export function useEditorHistory(container: HTMLElement | null) {
    const [state, setState] = useState({ canUndo: false, canRedo: false });

    useEffect(() => {
        if (!container) return;
        const read = () => {
            const canUndo = enabled(container.querySelector<HTMLButtonElement>(UNDO));
            const canRedo = enabled(container.querySelector<HTMLButtonElement>(REDO));
            setState((previous) => (previous.canUndo === canUndo && previous.canRedo === canRedo ? previous : { canUndo, canRedo }));
        };
        read();
        const observer = new MutationObserver(read);
        observer.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled", "aria-disabled"] });
        return () => observer.disconnect();
    }, [container]);

    const press = useCallback((selector: string) => container?.querySelector<HTMLButtonElement>(selector)?.click(), [container]);
    const undo = useCallback(() => press(UNDO), [press]);
    const redo = useCallback(() => press(REDO), [press]);

    return { ...state, undo, redo };
}
