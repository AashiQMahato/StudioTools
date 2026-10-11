import { useCallback, useEffect, useRef, useState } from "react";
import type { Look } from "./filters";
import { insetQuad, type Quad } from "./geometry";
import { detectPage, disconnectScanner, forgetPage, renderPage, type RenderResult } from "./scanClient";

export interface ScanPage {
    id: string;
    file: File;
    name: string;
    /** Object URL of the photo, for the corner editor. */
    source: string;
    /** The photo's upright size; 0 until it has been read. */
    width: number;
    height: number;
    /** The page's corners in the photo (null until detected). */
    quad: Quad | null;
    /** What detection found, for "Auto-detect again". */
    detected: Quad | null;
    confident: boolean;
    /** Clockwise quarter turns of the output. */
    quarterTurns: number;
    look: Look;
    status: "detecting" | "rendering" | "ready" | "failed";
    /** The flattened, cleaned-up page (JPEG). Kept while a newer one renders. */
    result: (RenderResult & { url: string }) | null;
}

/** How long keyboard nudges wait before the page is rendered again. */
const SETTLE_MS = 280;

/**
 * The scanned pages and everything done to them. Pixel work happens in the scanner's worker; a page
 * re-renders whenever its corners, rotation or look change, and only the latest render is kept.
 */
export function useScanPages(defaultLook: Look) {
    const [pages, setPages] = useState<ScanPage[]>([]);
    // The truth for async work, updated with every change (state alone would be a render behind).
    const latest = useRef<ScanPage[]>([]);
    const versions = useRef(new Map<string, number>());
    const timers = useRef(new Map<string, number>());

    const commit = useCallback((next: ScanPage[]) => {
        latest.current = next;
        setPages(next);
    }, []);
    const find = (id: string) => latest.current.find((page) => page.id === id);
    const patch = useCallback(
        (id: string, change: Partial<ScanPage>) => commit(latest.current.map((page) => (page.id === id ? { ...page, ...change } : page))),
        [commit],
    );

    const render = useCallback(
        async (id: string) => {
            const page = latest.current.find((item) => item.id === id);
            if (!page?.quad) return;
            const version = (versions.current.get(id) ?? 0) + 1;
            versions.current.set(id, version);
            patch(id, { status: "rendering" });
            try {
                const result = await renderPage(id, page.file, page.quad, page.quarterTurns, page.look);
                const current = latest.current.find((item) => item.id === id);
                if (!current || versions.current.get(id) !== version) return;
                if (current.result) URL.revokeObjectURL(current.result.url);
                patch(id, { status: "ready", result: { ...result, url: URL.createObjectURL(result.blob) } });
            } catch {
                if (versions.current.get(id) === version && latest.current.some((item) => item.id === id)) patch(id, { status: "failed" });
            }
        },
        [patch],
    );

    /** Renders now, or once the changes settle (keyboard nudges). */
    const schedule = useCallback(
        (id: string, delay = 0) => {
            window.clearTimeout(timers.current.get(id));
            timers.current.set(id, window.setTimeout(() => void render(id), delay));
        },
        [render],
    );

    const detect = useCallback(
        async (id: string) => {
            const page = latest.current.find((item) => item.id === id);
            if (!page) return;
            patch(id, { status: "detecting" });
            try {
                const found = await detectPage(id, page.file);
                if (!latest.current.some((item) => item.id === id)) return;
                patch(id, { width: found.width, height: found.height, quad: found.quad, detected: found.quad, confident: found.confident });
                await render(id);
            } catch {
                if (latest.current.some((item) => item.id === id)) patch(id, { status: "failed" });
            }
        },
        [patch, render],
    );

    /** Adds a photo as a page and starts finding its edges. Returns the new page's id. */
    const add = (file: File, name = file.name) => {
        const page: ScanPage = { id: crypto.randomUUID(), file, name, source: URL.createObjectURL(file), width: 0, height: 0, quad: null, detected: null, confident: false, quarterTurns: 0, look: defaultLook, status: "detecting", result: null };
        commit([...latest.current, page]);
        void detect(page.id);
        return page.id;
    };

    const release = (page: ScanPage) => {
        URL.revokeObjectURL(page.source);
        if (page.result) URL.revokeObjectURL(page.result.url);
        window.clearTimeout(timers.current.get(page.id));
        versions.current.delete(page.id);
        forgetPage(page.id);
    };

    const remove = (id: string) => {
        const page = find(id);
        if (!page) return;
        release(page);
        commit(latest.current.filter((item) => item.id !== id));
    };

    const clear = () => {
        latest.current.forEach(release);
        commit([]);
    };

    /** New corners. `settle`: wait for more (keyboard) before rendering; drags render when they end. */
    const setQuad = (id: string, quad: Quad, when: "now" | "settle" | "never" = "now") => {
        patch(id, { quad });
        if (when !== "never") schedule(id, when === "settle" ? SETTLE_MS : 0);
    };

    const change = (id: string, update: Partial<Pick<ScanPage, "quad" | "quarterTurns" | "look">>) => {
        patch(id, update);
        schedule(id);
    };

    // Free every URL and stop the worker when the tool closes.
    useEffect(
        () => () => {
            latest.current.forEach((page) => {
                URL.revokeObjectURL(page.source);
                if (page.result) URL.revokeObjectURL(page.result.url);
            });
            timers.current.forEach((timer) => window.clearTimeout(timer));
            disconnectScanner();
        },
        [],
    );

    return {
        pages,
        add,
        remove,
        clear,
        reorder: commit,
        setQuad,
        rotate: (id: string, step: 1 | -1) => {
            const page = find(id);
            if (page) change(id, { quarterTurns: (page.quarterTurns + step + 4) % 4 });
        },
        setLook: (id: string, look: Look) => change(id, { look }),
        lookForAll: (look: Look) => latest.current.forEach((page) => page.look !== look && change(page.id, { look })),
        autoDetect: (id: string) => {
            const page = find(id);
            if (page?.detected) change(id, { quad: page.detected });
        },
        fullImage: (id: string) => {
            const page = find(id);
            if (page?.width) change(id, { quad: insetQuad(page.width, page.height) });
        },
        /** After a failure: detect again if the photo was never read, otherwise render again. */
        retry: (id: string) => (find(id)?.quad ? render(id) : detect(id)),
    };
}
