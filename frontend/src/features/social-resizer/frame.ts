/**
 * Placing an image in a fixed target frame (all in target pixels unless noted).
 *
 * The view is stored as a focal point in *image* pixels plus a zoom relative to the mode's base scale
 * (cover for Fill, contain for Fit). The focal point sits at the frame's centre, so switching to a
 * preset with another ratio keeps the same part of the photo centred.
 */

export type FitMode = "fill" | "fit";

export interface Size {
    width: number;
    height: number;
}

export interface View {
    /** Image pixel at the frame's centre. */
    fx: number;
    fy: number;
    /** 1 = cover (Fill) or contain (Fit). */
    zoom: number;
}

export const ZOOM_MAX = 6;

export const coverScale = (image: Size, target: Size) => Math.max(target.width / image.width, target.height / image.height);
export const containScale = (image: Size, target: Size) => Math.min(target.width / image.width, target.height / image.height);
export const baseScale = (image: Size, target: Size, mode: FitMode) => (mode === "fill" ? coverScale(image, target) : containScale(image, target));

export const centreView = (image: Size): View => ({ fx: image.width / 2, fy: image.height / 2, zoom: 1 });

/** Output pixels per image pixel. */
export const scaleOf = (view: View, image: Size, target: Size, mode: FitMode) => baseScale(image, target, mode) * view.zoom;

/** Where the image's top-left corner lands in the frame, and how big it is there. */
export function placement(view: View, image: Size, target: Size, mode: FitMode) {
    const scale = scaleOf(view, image, target, mode);
    return { x: target.width / 2 - view.fx * scale, y: target.height / 2 - view.fy * scale, width: image.width * scale, height: image.height * scale, scale };
}

/**
 * Allowed focal range on one axis. A side larger than the frame must cover it (no gaps); a smaller
 * side (Fit's padding) must stay inside it. Both ends are where the image meets a frame edge.
 */
export function focalRange(imageLength: number, targetLength: number, scale: number): [number, number] {
    const half = targetLength / (2 * scale);
    return [Math.min(half, imageLength - half), Math.max(half, imageLength - half)];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const clampZoom = (zoom: number) => clamp(zoom, 1, ZOOM_MAX);

export function clampView(view: View, image: Size, target: Size, mode: FitMode): View {
    const zoom = clampZoom(view.zoom);
    const scale = baseScale(image, target, mode) * zoom;
    const [minX, maxX] = focalRange(image.width, target.width, scale);
    const [minY, maxY] = focalRange(image.height, target.height, scale);
    return { fx: clamp(view.fx, minX, maxX), fy: clamp(view.fy, minY, maxY), zoom };
}

/** Zoom to `zoom` keeping the image point under `point` (frame px, from the frame's centre) where it is. */
export function zoomAbout(view: View, zoom: number, point: { x: number; y: number }, image: Size, target: Size, mode: FitMode): View {
    const base = baseScale(image, target, mode);
    const before = base * view.zoom;
    const after = base * clampZoom(zoom);
    return { zoom: clampZoom(zoom), fx: view.fx + point.x / before - point.x / after, fy: view.fy + point.y / before - point.y / after };
}

export type Align = "center" | "top" | "bottom" | "left" | "right";

/** Push the image against a frame edge (or centre it) on the matching axis. */
export function alignView(view: View, align: Align, image: Size, target: Size, mode: FitMode): View {
    const scale = scaleOf(view, image, target, mode);
    const halfX = target.width / (2 * scale);
    const halfY = target.height / (2 * scale);
    switch (align) {
        case "center":
            return { ...view, fx: image.width / 2, fy: image.height / 2 };
        case "top":
            return { ...view, fy: halfY };
        case "bottom":
            return { ...view, fy: image.height - halfY };
        case "left":
            return { ...view, fx: halfX };
        case "right":
            return { ...view, fx: image.width - halfX };
    }
}

/** Share of the image's width and height (0…1) that falls outside the frame. */
export function cropShare(view: View, image: Size, target: Size, mode: FitMode) {
    const scale = scaleOf(view, image, target, mode);
    return {
        x: Math.max(0, 1 - target.width / scale / image.width),
        y: Math.max(0, 1 - target.height / scale / image.height),
    };
}

/** Above this share cropped on either axis, warn before exporting. */
export const CROP_WARNING = 0.25;

export function cropWarning(view: View, image: Size, target: Size, mode: FitMode): number | null {
    const share = cropShare(view, image, target, mode);
    const worst = Math.max(share.x, share.y);
    return worst > CROP_WARNING ? Math.round(worst * 100) : null;
}

/** The output asks for more pixels than the photo has (soft result): the upscale factor, else null. */
export function upscaleWarning(view: View, image: Size, target: Size, mode: FitMode): number | null {
    const scale = scaleOf(view, image, target, mode);
    return scale > 1.05 ? Math.round(scale * 10) / 10 : null;
}
