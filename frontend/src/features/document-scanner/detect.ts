import { insetQuad, orderCorners, type Point, polygonArea, type Quad } from "./geometry";

/** The side detection works at: plenty to find a page's edges, fast enough to feel instant. */
export const DETECT_SIDE = 500;

export interface Detection {
    quad: Quad;
    /** False: no clear page was found, and `quad` is a guess inset from the image's edges. */
    confident: boolean;
}

/** Otsu's threshold for a 256-bin histogram: the split that best separates two classes. */
export function otsu(histogram: ArrayLike<number>): number {
    let total = 0;
    let sum = 0;
    for (let i = 0; i < 256; i++) {
        total += histogram[i]!;
        sum += i * histogram[i]!;
    }
    let weightBelow = 0;
    let sumBelow = 0;
    let best = 0;
    let threshold = 0;
    for (let i = 0; i < 256; i++) {
        weightBelow += histogram[i]!;
        if (!weightBelow) continue;
        const weightAbove = total - weightBelow;
        if (!weightAbove) break;
        sumBelow += i * histogram[i]!;
        const meanBelow = sumBelow / weightBelow;
        const meanAbove = (sum - sumBelow) / weightAbove;
        const between = weightBelow * weightAbove * (meanBelow - meanAbove) ** 2;
        if (between > best) {
            best = between;
            threshold = i;
        }
    }
    return threshold;
}

/** One 3×3 erosion (`keep` = 0) or dilation (`keep` = 1) of a 0/1 mask. */
function morph(mask: Uint8Array, width: number, height: number, keep: 0 | 1): Uint8Array {
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let value = 1 - keep;
            for (let dy = -1; dy <= 1 && value !== keep; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= height) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx;
                    if (xx >= 0 && xx < width && mask[yy * width + xx] === keep) {
                        value = keep;
                        break;
                    }
                }
            }
            out[y * width + x] = value;
        }
    }
    return out;
}

/** The largest 4-connected region of set pixels, as a 0/1 mask, with its pixel count. */
function largestComponent(mask: Uint8Array, width: number, height: number): { mask: Uint8Array; area: number } {
    const labels = new Int32Array(mask.length);
    const stack = new Int32Array(mask.length);
    let best = 0;
    let bestArea = 0;
    let label = 0;
    for (let start = 0; start < mask.length; start++) {
        if (!mask[start] || labels[start]) continue;
        label++;
        let area = 0;
        let top = 0;
        stack[top++] = start;
        labels[start] = label;
        while (top) {
            const i = stack[--top]!;
            area++;
            const x = i % width;
            const neighbours = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i >= width ? i - width : -1, i < width * (height - 1) ? i + width : -1];
            for (const n of neighbours) {
                if (n >= 0 && mask[n] && !labels[n]) {
                    labels[n] = label;
                    stack[top++] = n;
                }
            }
        }
        if (area > bestArea) {
            bestArea = area;
            best = label;
        }
    }
    const out = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++) out[i] = labels[i] === best && best ? 1 : 0;
    return { mask: out, area: bestArea };
}

/** Sets every pixel that can't reach the image's border without crossing the region (text on the page). */
function fillHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
    const outside = new Uint8Array(mask.length);
    const stack = new Int32Array(mask.length);
    let top = 0;
    const push = (i: number) => {
        if (!mask[i] && !outside[i]) {
            outside[i] = 1;
            stack[top++] = i;
        }
    };
    for (let x = 0; x < width; x++) {
        push(x);
        push((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
        push(y * width);
        push(y * width + width - 1);
    }
    while (top) {
        const i = stack[--top]!;
        const x = i % width;
        if (x > 0) push(i - 1);
        if (x < width - 1) push(i + 1);
        if (i >= width) push(i - width);
        if (i < width * (height - 1)) push(i + width);
    }
    const out = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++) out[i] = outside[i] ? 0 : 1;
    return out;
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Andrew's monotone chain. */
export function convexHull(points: Point[]): Point[] {
    const sorted = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
    if (sorted.length < 3) return sorted;
    const lower: Point[] = [];
    for (const p of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper: Point[] = [];
    for (const p of sorted.reverse()) {
        while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
        upper.push(p);
    }
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Drops the hull vertices that matter least (smallest triangle with their neighbours) until `limit` are left. */
function simplify(hull: Point[], limit: number): Point[] {
    const points = [...hull];
    while (points.length > limit) {
        let weakest = 0;
        let smallest = Infinity;
        for (let i = 0; i < points.length; i++) {
            const area = Math.abs(cross(points[(i + points.length - 1) % points.length]!, points[i]!, points[(i + 1) % points.length]!));
            if (area < smallest) {
                smallest = area;
                weakest = i;
            }
        }
        points.splice(weakest, 1);
    }
    return points;
}

/** The four hull vertices that enclose the most area. */
function largestQuad(hull: Point[]): Point[] {
    let best: Point[] = hull.slice(0, 4);
    let bestArea = -1;
    const n = hull.length;
    for (let a = 0; a < n; a++)
        for (let b = a + 1; b < n; b++)
            for (let c = b + 1; c < n; c++)
                for (let d = c + 1; d < n; d++) {
                    const quad = [hull[a]!, hull[b]!, hull[c]!, hull[d]!];
                    const area = polygonArea(quad);
                    if (area > bestArea) {
                        bestArea = area;
                        best = quad;
                    }
                }
    return best;
}

/** The middle of the frame, where the page almost always is. Its median colour is the paper's. */
function paperColour(data: Uint8ClampedArray, width: number, height: number): [number, number, number] {
    const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let count = 0;
    for (let y = Math.floor(height * 0.35); y < Math.ceil(height * 0.65); y++) {
        for (let x = Math.floor(width * 0.35); x < Math.ceil(width * 0.65); x++) {
            const i = (y * width + x) * 4;
            for (let c = 0; c < 3; c++) histograms[c]![data[i + c]!]!++;
            count++;
        }
    }
    return histograms.map((histogram) => {
        let seen = 0;
        for (let v = 0; v < 256; v++) {
            seen += histogram[v]!;
            if (seen * 2 >= count) return v;
        }
        return 255;
    }) as [number, number, number];
}

/**
 * Finds a page in a small RGBA image. The paper is told apart from the background by its colour
 * (distance from the centre's median, split with Otsu), the main region is kept and its holes (the
 * text) filled, and the largest quadrilateral on its convex hull is the page.
 */
export function detectDocument(data: Uint8ClampedArray, width: number, height: number): Detection {
    const fallback: Detection = { quad: insetQuad(width, height, 0.05), confident: false };
    if (width < 16 || height < 16) return fallback;

    // A 3×3 box blur first, so camera noise and paper texture don't fragment the mask.
    const blurred = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            for (let c = 0; c < 3; c++) {
                let sum = 0;
                let n = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    const yy = y + dy;
                    if (yy < 0 || yy >= height) continue;
                    for (let dx = -1; dx <= 1; dx++) {
                        const xx = x + dx;
                        if (xx < 0 || xx >= width) continue;
                        sum += data[(yy * width + xx) * 4 + c]!;
                        n++;
                    }
                }
                blurred[(y * width + x) * 4 + c] = sum / n;
            }
        }
    }

    const [pr, pg, pb] = paperColour(blurred, width, height);
    const distances = new Uint8Array(width * height);
    const histogram = new Uint32Array(256);
    for (let i = 0; i < distances.length; i++) {
        const d = Math.min(255, Math.round(Math.hypot(blurred[i * 4]! - pr, blurred[i * 4 + 1]! - pg, blurred[i * 4 + 2]! - pb)));
        distances[i] = d;
        histogram[d]!++;
    }
    const threshold = otsu(histogram);
    let mask: Uint8Array = new Uint8Array(distances.length);
    for (let i = 0; i < mask.length; i++) mask[i] = distances[i]! <= threshold ? 1 : 0;

    // An opening (erode twice, dilate twice) cuts thin bridges to similar-coloured things nearby.
    mask = morph(morph(mask, width, height, 0), width, height, 0);
    mask = morph(morph(mask, width, height, 1), width, height, 1);
    const component = largestComponent(mask, width, height);
    if (!component.area) return fallback;
    const filled = fillHoles(component.mask, width, height);

    // The region's outline: each row's outermost pixels, by their outer edges.
    const points: Point[] = [];
    let filledArea = 0;
    for (let y = 0; y < height; y++) {
        let left = -1;
        let right = -1;
        for (let x = 0; x < width; x++) {
            if (!filled[y * width + x]) continue;
            filledArea++;
            if (left < 0) left = x;
            right = x;
        }
        if (left < 0) continue;
        points.push({ x: left, y }, { x: left, y: y + 1 }, { x: right + 1, y }, { x: right + 1, y: y + 1 });
    }
    const hull = simplify(convexHull(points), 32);
    if (hull.length < 4) return fallback;
    const quad = orderCorners(largestQuad(hull));
    const quadArea = polygonArea(quad);
    const share = quadArea / (width * height);
    // A page fills a good part of the frame but not all of it, and is a quadrilateral, not a blob.
    const confident = share > 0.08 && share < 0.97 && filledArea / quadArea > 0.88;
    return confident ? { quad, confident } : fallback;
}
