import { useCallback, useLayoutEffect, useState } from "react";

export type ZoomMode = "width" | "page" | "custom";

/** 100% is the page at its real size: 96 CSS pixels to the inch, 72 points to the inch. */
const PX_PER_POINT = 96 / 72;
export const ZOOM_STEPS = [25, 50, 75, 100, 125, 150, 200, 300, 400] as const;
const MIN = 10;
const MAX = 500;
/** Room around the pages (the scroll area's padding), so a fitted page never touches the edges. */
const GUTTER = 32;

/**
 * Zoom for a column of pages: fit to width, fit a whole page, or a percentage. Fitting follows the
 * view as it's resized (a window, a rotated phone, the panel opening).
 */
export function useZoom(element: HTMLElement | null, sizes: readonly { width: number; height: number }[], rotation: number, current: number) {
    const [mode, setMode] = useState<ZoomMode>("width");
    const [percent, setPercent] = useState(100);
    const [box, setBox] = useState({ width: 0, height: 0 });

    useLayoutEffect(() => {
        if (!element) return;
        const measure = () => setBox({ width: element.clientWidth, height: element.clientHeight });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [element]);

    const sideways = rotation % 180 !== 0;
    const widest = Math.max(1, ...sizes.map((size) => (sideways ? size.height : size.width)));
    const page = sizes[current - 1] ?? sizes[0] ?? { width: 612, height: 792 };
    const fitWidth = box.width ? Math.max(0.05, (box.width - GUTTER) / widest) : PX_PER_POINT;
    const fitPage = box.height ? Math.min(fitWidth, Math.max(0.05, (box.height - GUTTER) / (sideways ? page.width : page.height))) : fitWidth;
    const scale = mode === "width" ? fitWidth : mode === "page" ? fitPage : (percent / 100) * PX_PER_POINT;
    const shown = Math.round((scale / PX_PER_POINT) * 100);

    const choose = useCallback((value: number) => {
        setPercent(Math.min(MAX, Math.max(MIN, Math.round(value))));
        setMode("custom");
    }, []);
    const zoomIn = () => choose(ZOOM_STEPS.find((step) => step > shown + 1) ?? Math.min(MAX, shown * 1.25));
    const zoomOut = () => choose([...ZOOM_STEPS].reverse().find((step) => step < shown - 1) ?? Math.max(MIN, shown / 1.25));
    return { scale, mode, percent: shown, fit: setMode, choose, zoomIn, zoomOut, canZoomIn: shown < MAX, canZoomOut: shown > MIN };
}
