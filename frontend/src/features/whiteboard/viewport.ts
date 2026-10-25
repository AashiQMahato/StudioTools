/** The editor's zoom range and step (the same as its own zoom buttons and Ctrl +/−). */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;
export const ZOOM_STEP = 0.1;

export interface View {
    scrollX: number;
    scrollY: number;
    zoom: number;
    /** The canvas size on screen, in CSS pixels. */
    width: number;
    height: number;
}

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));

/**
 * A new zoom that keeps the point at the middle of the canvas where it is. The editor draws a scene
 * point at `(x + scrollX) × zoom`, so the middle's scene point is `width / 2 / zoom − scrollX`.
 */
export function zoomAroundCenter(view: View, nextZoom: number) {
    const zoom = clampZoom(nextZoom);
    const centerX = view.width / 2 / view.zoom - view.scrollX;
    const centerY = view.height / 2 / view.zoom - view.scrollY;
    return { zoom, scrollX: view.width / 2 / zoom - centerX, scrollY: view.height / 2 / zoom - centerY };
}

/** The zoom as the top bar shows it, e.g. "100%". */
export const zoomLabel = (zoom: number) => `${Math.round(zoom * 100)}%`;
