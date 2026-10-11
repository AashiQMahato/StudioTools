/**
 * Perspective geometry for the scanner: corner ordering, the homography between two quadrilaterals
 * and the warp that flattens a photographed page into a rectangle.
 */

export interface Point {
    x: number;
    y: number;
}

/** Corners in reading order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

/** A 3×3 matrix, row-major, with the last entry fixed at 1. */
export type Homography = number[];

/** The longest side of a flattened page, in pixels: plenty for 300 dpi A4, still safe for phone memory. */
export const MAX_OUTPUT_SIDE = 3500;

/** Solves a·x = b (n×n) by Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
    const n = b.length;
    const m = a.map((row, i) => [...row, b[i]!]);
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let row = col + 1; row < n; row++) if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) pivot = row;
        if (Math.abs(m[pivot]![col]!) < 1e-12) throw new Error("degenerate");
        [m[col], m[pivot]] = [m[pivot]!, m[col]!];
        const top = m[col]!;
        for (let row = col + 1; row < n; row++) {
            const current = m[row]!;
            const factor = current[col]! / top[col]!;
            for (let k = col; k <= n; k++) current[k]! -= factor * top[k]!;
        }
    }
    const x = new Array<number>(n).fill(0);
    for (let row = n - 1; row >= 0; row--) {
        const current = m[row]!;
        let sum = current[n]!;
        for (let k = row + 1; k < n; k++) sum -= current[k]! * x[k]!;
        x[row] = sum / current[row]!;
    }
    return x;
}

/** The homography that takes each corner of `from` onto the matching corner of `to`. */
export function homography(from: Quad, to: Quad): Homography {
    const a: number[][] = [];
    const b: number[] = [];
    for (let i = 0; i < 4; i++) {
        const { x, y } = from[i]!;
        const { x: u, y: v } = to[i]!;
        a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
        b.push(u);
        a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
        b.push(v);
    }
    return [...solve(a, b), 1];
}

export function project(h: Homography, x: number, y: number): Point {
    const w = h[6]! * x + h[7]! * y + h[8]!;
    return { x: (h[0]! * x + h[1]! * y + h[2]!) / w, y: (h[3]! * x + h[4]! * y + h[5]!) / w };
}

/** Any four corners of a convex shape, put in reading order (y grows downwards). */
export function orderCorners(points: readonly Point[]): Quad {
    const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    // Clockwise on screen, starting from the corner nearest the top left.
    const sorted = [...points].sort((p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx));
    let start = 0;
    sorted.forEach((p, i) => {
        if (p.x + p.y < sorted[start]!.x + sorted[start]!.y) start = i;
    });
    return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]!) as Quad;
}

/** The output turned clockwise by `quarterTurns`: the same warp, with the corners relabelled. */
export function rotateQuad(quad: Quad, quarterTurns: number): Quad {
    const r = ((quarterTurns % 4) + 4) % 4;
    return [0, 1, 2, 3].map((i) => quad[(i + 4 - r) % 4]!) as Quad;
}

export function scaleQuad(quad: Quad, sx: number, sy = sx): Quad {
    return quad.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Quad;
}

/** The whole image, or the image pulled in by `inset` (a fraction of each side). */
export function insetQuad(width: number, height: number, inset = 0): Quad {
    const dx = width * inset;
    const dy = height * inset;
    return [
        { x: dx, y: dy },
        { x: width - dx, y: dy },
        { x: width - dx, y: height - dy },
        { x: dx, y: height - dy },
    ];
}

export function polygonArea(points: readonly Point[]): number {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const p = points[i]!;
        const q = points[(i + 1) % points.length]!;
        sum += p.x * q.y - q.x * p.y;
    }
    return Math.abs(sum) / 2;
}

const distance = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);

/** The flattened page's size: the average of opposite edges, capped at `maxSide`. */
export function outputSize(quad: Quad, maxSide = MAX_OUTPUT_SIDE): { width: number; height: number } {
    const [tl, tr, br, bl] = quad;
    const width = (distance(tl, tr) + distance(bl, br)) / 2;
    const height = (distance(tl, bl) + distance(tr, br)) / 2;
    const scale = Math.min(1, maxSide / Math.max(width, height, 1));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Flattens the quadrilateral `quad` of an RGBA image into a `width`×`height` rectangle: every output
 * pixel is mapped back through the homography and sampled bilinearly from the source.
 */
export function warpPerspective(source: { data: Uint8ClampedArray; width: number; height: number }, quad: Quad, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
    const { data, width: sw, height: sh } = source;
    const h = homography(insetQuad(width, height), quad);
    const out = new Uint8ClampedArray(width * height * 4);
    const maxX = sw - 1;
    const maxY = sh - 1;
    let o = 0;
    for (let y = 0; y < height; y++) {
        const py = y + 0.5;
        // Numerators and denominator are linear in x: step them instead of recomputing.
        let nx = h[0]! * 0.5 + h[1]! * py + h[2]!;
        let ny = h[3]! * 0.5 + h[4]! * py + h[5]!;
        let nw = h[6]! * 0.5 + h[7]! * py + h[8]!;
        for (let x = 0; x < width; x++) {
            const sx = Math.min(maxX, Math.max(0, nx / nw - 0.5));
            const sy = Math.min(maxY, Math.max(0, ny / nw - 0.5));
            const x0 = Math.floor(sx);
            const y0 = Math.floor(sy);
            const x1 = x0 < maxX ? x0 + 1 : x0;
            const y1 = y0 < maxY ? y0 + 1 : y0;
            const fx = sx - x0;
            const fy = sy - y0;
            const a = (y0 * sw + x0) * 4;
            const b = (y0 * sw + x1) * 4;
            const c = (y1 * sw + x0) * 4;
            const d = (y1 * sw + x1) * 4;
            const wa = (1 - fx) * (1 - fy);
            const wb = fx * (1 - fy);
            const wc = (1 - fx) * fy;
            const wd = fx * fy;
            for (let k = 0; k < 4; k++) out[o + k] = data[a + k]! * wa + data[b + k]! * wb + data[c + k]! * wc + data[d + k]! * wd;
            o += 4;
            nx += h[0]!;
            ny += h[3]!;
            nw += h[6]!;
        }
    }
    return out;
}
