/**
 * The clean-up looks, as real pixel processing on RGBA data (in place). Every look works on the
 * flattened page, so the background is paper and the rest is ink.
 */

export const LOOKS = ["original", "enhance", "shadow", "grayscale", "bw"] as const;
export type Look = (typeof LOOKS)[number];

/** Rec. 601 luma, 0–255. */
export function luminance(data: Uint8ClampedArray): Uint8ClampedArray {
    const out = new Uint8ClampedArray(data.length / 4);
    for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!;
    return out;
}

export function grayscale(data: Uint8ClampedArray): void {
    const lum = luminance(data);
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) data[p] = data[p + 1] = data[p + 2] = lum[i]!;
}

/** The luma below which `fraction` of the pixels fall. */
function percentile(histogram: Uint32Array, total: number, fraction: number): number {
    let seen = 0;
    for (let v = 0; v < 256; v++) {
        seen += histogram[v]!;
        if (seen >= total * fraction) return v;
    }
    return 255;
}

/**
 * Contrast stretch: the darkest `low` and brightest `high` share of pixels (by luma) go to black and
 * white, everything between is spread linearly. One map for all channels, so colours keep their hue.
 */
export function stretchContrast(data: Uint8ClampedArray, low = 0.01, high = 0.99): void {
    const lum = luminance(data);
    const histogram = new Uint32Array(256);
    for (const v of lum) histogram[v]!++;
    const lo = percentile(histogram, lum.length, low);
    const hi = percentile(histogram, lum.length, high);
    if (hi - lo < 8) return;
    const scale = 255 / (hi - lo);
    for (let p = 0; p < data.length; p += 4) {
        data[p] = (data[p]! - lo) * scale;
        data[p + 1] = (data[p + 1]! - lo) * scale;
        data[p + 2] = (data[p + 2]! - lo) * scale;
    }
}

/** Summed-area table of a channel ((w+1)×(h+1)); Uint32 holds 255 × 16.8 M pixels, beyond our largest page. */
function integral(values: Uint8ClampedArray, width: number, height: number): Uint32Array {
    const table = new Uint32Array((width + 1) * (height + 1));
    for (let y = 0; y < height; y++) {
        let row = 0;
        for (let x = 0; x < width; x++) {
            row += values[y * width + x]!;
            table[(y + 1) * (width + 1) + x + 1] = table[y * (width + 1) + x + 1]! + row;
        }
    }
    return table;
}

/** Mean of the box around each pixel, clipped to the image. */
function boxMean(table: Uint32Array, width: number, height: number, x: number, y: number, radius: number): number {
    const x0 = Math.max(0, x - radius);
    const y0 = Math.max(0, y - radius);
    const x1 = Math.min(width, x + radius + 1);
    const y1 = Math.min(height, y + radius + 1);
    const stride = width + 1;
    const sum = table[y1 * stride + x1]! - table[y0 * stride + x1]! - table[y1 * stride + x0]! + table[y0 * stride + x0]!;
    return sum / ((x1 - x0) * (y1 - y0));
}

/**
 * Local-mean (Bradley) threshold: a pixel is ink when it's more than `t` darker than the average of
 * its neighbourhood, so a shadow across the page doesn't turn into a black patch.
 */
export function adaptiveThreshold(lum: Uint8ClampedArray, width: number, height: number, radius = Math.max(8, Math.round(Math.max(width, height) / 24)), t = 0.15): Uint8ClampedArray {
    const table = integral(lum, width, height);
    const out = new Uint8ClampedArray(lum.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            out[i] = lum[i]! < boxMean(table, width, height, x, y, radius) * (1 - t) ? 0 : 255;
        }
    }
    return out;
}

export function blackAndWhite(data: Uint8ClampedArray, width: number, height: number): void {
    const ink = adaptiveThreshold(luminance(data), width, height);
    for (let i = 0, p = 0; i < ink.length; i++, p += 4) data[p] = data[p + 1] = data[p + 2] = ink[i]!;
}

/**
 * How bright the paper is around each pixel, ignoring the ink: the brightest pixel of each block (text
 * is thinner than a block), spread a little further, then smoothed. Returned at block resolution.
 */
function paperLevel(lum: Uint8ClampedArray, width: number, height: number) {
    const block = Math.max(1, Math.ceil(Math.max(width, height) / 160));
    const gw = Math.ceil(width / block);
    const gh = Math.ceil(height / block);
    const grid = new Uint8ClampedArray(gw * gh);
    for (let y = 0; y < height; y++) {
        const gy = Math.floor(y / block);
        for (let x = 0; x < width; x++) {
            const g = gy * gw + Math.floor(x / block);
            if (lum[y * width + x]! > grid[g]!) grid[g] = lum[y * width + x]!;
        }
    }
    // Spread the maximum two blocks further, past headings and thick strokes.
    const spread = new Uint8ClampedArray(grid.length);
    for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
            let max = 0;
            for (let dy = -2; dy <= 2; dy++)
                for (let dx = -2; dx <= 2; dx++) {
                    const xx = x + dx;
                    const yy = y + dy;
                    if (xx >= 0 && xx < gw && yy >= 0 && yy < gh && grid[yy * gw + xx]! > max) max = grid[yy * gw + xx]!;
                }
            spread[y * gw + x] = max;
        }
    }
    const table = integral(spread, gw, gh);
    const smooth = new Float32Array(grid.length);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) smooth[y * gw + x] = boxMean(table, gw, gh, x, y, 4);
    return { smooth, block, gw, gh };
}

/**
 * Shadow reduction: each pixel divided by the paper's brightness around it (a heavily smoothed,
 * ink-free background estimate), so lit and shaded paper both come out white; then a gentle stretch.
 */
export function reduceShadows(data: Uint8ClampedArray, width: number, height: number): void {
    const { smooth, block, gw, gh } = paperLevel(luminance(data), width, height);
    for (let y = 0; y < height; y++) {
        // Bilinear between block centres.
        const gy = Math.min(gh - 1, Math.max(0, (y + 0.5) / block - 0.5));
        const y0 = Math.floor(gy);
        const y1 = Math.min(gh - 1, y0 + 1);
        const fy = gy - y0;
        for (let x = 0; x < width; x++) {
            const gx = Math.min(gw - 1, Math.max(0, (x + 0.5) / block - 0.5));
            const x0 = Math.floor(gx);
            const x1 = Math.min(gw - 1, x0 + 1);
            const fx = gx - x0;
            const top = smooth[y0 * gw + x0]! * (1 - fx) + smooth[y0 * gw + x1]! * fx;
            const bottom = smooth[y1 * gw + x0]! * (1 - fx) + smooth[y1 * gw + x1]! * fx;
            const gain = 245 / Math.max(16, top * (1 - fy) + bottom * fy);
            const p = (y * width + x) * 4;
            data[p] = data[p]! * gain;
            data[p + 1] = data[p + 1]! * gain;
            data[p + 2] = data[p + 2]! * gain;
        }
    }
    stretchContrast(data, 0.005, 0.995);
}

export function applyLook(data: Uint8ClampedArray, width: number, height: number, look: Look): void {
    if (look === "grayscale") grayscale(data);
    else if (look === "bw") blackAndWhite(data, width, height);
    else if (look === "enhance") stretchContrast(data);
    else if (look === "shadow") reduceShadows(data, width, height);
}
