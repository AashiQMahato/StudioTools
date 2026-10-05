/**
 * Crop geometry.
 *
 * The source image (W × H) is transformed on screen by  R(angle) · F(flipX, flipY) · R(-90° × quarter),
 * i.e. quarter turns counter-clockwise, then mirroring, then fine straightening. The crop is an axis-aligned
 * rectangle in that on-screen space, measured in source pixels from the image centre. It is valid when all
 * four corners, un-rotated by the straighten angle, fall inside the (quarter-turned) image.
 */

export interface CropRect {
    cx: number;
    cy: number;
    w: number;
    h: number;
}

export interface Orientation {
    /** Counter-clockwise quarter turns (any integer; only parity and value mod 4 matter). */
    quarter: number;
    flipX: boolean;
    flipY: boolean;
    /** Fine straighten, degrees, −45…45. */
    angle: number;
}

export const MIN_CROP = 16;
const RAD = Math.PI / 180;

export function orientedSize(width: number, height: number, quarter: number) {
    return Math.abs(quarter) % 2 === 1 ? { width: height, height: width } : { width, height };
}

export function fullRect(width: number, height: number, quarter: number): CropRect {
    const size = orientedSize(width, height, quarter);
    return { cx: 0, cy: 0, w: size.width, h: size.height };
}

/** Does the rect sit entirely inside the image once straightened by `angle`? */
export function fits(rect: CropRect, angle: number, width: number, height: number, epsilon = 0.01) {
    const cos = Math.cos(-angle * RAD);
    const sin = Math.sin(-angle * RAD);
    const halfW = width / 2 + epsilon;
    const halfH = height / 2 + epsilon;
    for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
    ] as const) {
        const x = rect.cx + (dx * rect.w) / 2;
        const y = rect.cy + (dy * rect.h) / 2;
        const u = x * cos - y * sin;
        const v = x * sin + y * cos;
        if (Math.abs(u) > halfW || Math.abs(v) > halfH) return false;
    }
    return true;
}

const lerpRect = (a: CropRect, b: CropRect, t: number): CropRect => ({
    cx: a.cx + (b.cx - a.cx) * t,
    cy: a.cy + (b.cy - a.cy) * t,
    w: a.w + (b.w - a.w) * t,
    h: a.h + (b.h - a.h) * t,
});

/** The furthest point along from → to that is still valid (from must be valid). */
export function constrainTowards(from: CropRect, to: CropRect, angle: number, width: number, height: number): CropRect {
    if (fits(to, angle, width, height)) return to;
    let low = 0;
    let high = 1;
    for (let i = 0; i < 18; i++) {
        const mid = (low + high) / 2;
        if (fits(lerpRect(from, to, mid), angle, width, height)) low = mid;
        else high = mid;
    }
    return lerpRect(from, to, low);
}

/** Shrink a rect about its centre (and nudge it inward if needed) until it fits — used when straightening. */
export function shrinkToFit(rect: CropRect, angle: number, width: number, height: number): CropRect {
    if (fits(rect, angle, width, height)) return rect;
    // First pull the centre toward the image centre, then scale down; whichever keeps more area.
    const scaled = scaleToFit(rect, angle, width, height);
    const centred = constrainTowards({ ...rect, cx: 0, cy: 0 }, rect, angle, width, height);
    const centredFits = fits(centred, angle, width, height) ? centred : scaleToFit({ ...rect, cx: 0, cy: 0 }, angle, width, height);
    return scaled.w * scaled.h >= centredFits.w * centredFits.h ? scaled : centredFits;
}

function scaleToFit(rect: CropRect, angle: number, width: number, height: number): CropRect {
    let low = 0;
    let high = 1;
    for (let i = 0; i < 20; i++) {
        const mid = (low + high) / 2;
        if (fits({ ...rect, w: rect.w * mid, h: rect.h * mid }, angle, width, height)) low = mid;
        else high = mid;
    }
    return { ...rect, w: rect.w * low, h: rect.h * low };
}

/** Largest rect with the given aspect (w/h) centred on `center` that fits the straightened image. */
export function largestWithAspect(aspect: number, center: { cx: number; cy: number }, angle: number, width: number, height: number): CropRect {
    const huge = Math.max(width, height) * 2;
    const base = aspect >= 1 ? { w: huge, h: huge / aspect } : { w: huge * aspect, h: huge };
    // Prefer staying at the current centre; fall back to the image centre if that gives a bigger crop.
    const atCenter = scaleToFit({ ...center, ...base }, angle, width, height);
    const atOrigin = scaleToFit({ cx: 0, cy: 0, ...base }, angle, width, height);
    return atCenter.w >= atOrigin.w * 0.98 ? atCenter : atOrigin;
}

/** Rotate a crop rect 90° counter-clockwise on screen (y points down). */
export function rotateRectCCW(rect: CropRect): CropRect {
    return { cx: rect.cy, cy: -rect.cx, w: rect.h, h: rect.w };
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * Resize from a handle by a delta (source px). The opposite edge/corner stays fixed; with an aspect lock,
 * corners follow the dominant axis and edge handles grow symmetrically about the centre line.
 */
export function resizeFromHandle(start: CropRect, handle: Handle, dx: number, dy: number, aspect: number | null, minSize: number): CropRect {
    let left = start.cx - start.w / 2;
    let right = start.cx + start.w / 2;
    let top = start.cy - start.h / 2;
    let bottom = start.cy + start.h / 2;

    if (handle.includes("w")) left = Math.min(left + dx, right - minSize);
    if (handle.includes("e")) right = Math.max(right + dx, left + minSize);
    if (handle.includes("n")) top = Math.min(top + dy, bottom - minSize);
    if (handle.includes("s")) bottom = Math.max(bottom + dy, top + minSize);

    let w = right - left;
    let h = bottom - top;
    if (!aspect) return { cx: (left + right) / 2, cy: (top + bottom) / 2, w, h };

    const isCorner = handle.length === 2;
    if (isCorner) {
        // Follow whichever axis moved relatively more.
        if (w / start.w > h / start.h) h = w / aspect;
        else w = h * aspect;
        if (handle.includes("w")) left = right - w;
        else right = left + w;
        if (handle.includes("n")) top = bottom - h;
        else bottom = top + h;
        return { cx: (left + right) / 2, cy: (top + bottom) / 2, w, h };
    }
    if (handle === "e" || handle === "w") {
        h = w / aspect;
        return { cx: (left + right) / 2, cy: start.cy, w, h };
    }
    w = h * aspect;
    return { cx: start.cx, cy: (top + bottom) / 2, w, h };
}

/** Round to whole output pixels for display and export. */
export function outputSize(rect: CropRect) {
    return { width: Math.max(1, Math.round(rect.w)), height: Math.max(1, Math.round(rect.h)) };
}
