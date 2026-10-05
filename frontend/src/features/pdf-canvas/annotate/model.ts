/**
 * What the PDF editor adds to pages. Everything is in points on the page as the reader sees it (top
 * left origin, y down, the page's own rotation applied) — the same space the server draws in, so what
 * you place is where it lands.
 */

export type Tool = "select" | "text" | "draw" | "highlight" | "underline" | "strike" | "rect" | "ellipse" | "line" | "arrow" | "image" | "signature" | "date";

interface Base {
    id: string;
    /** 1-based. */
    page: number;
}

export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

export type TextAnnotation = Base & Box & { kind: "text"; rotation: number; text: string; size: number; color: string; bold: boolean };
export type ImageAnnotation = Base & Box & { kind: "image"; rotation: number; image: string; opacity: number; signature?: boolean };
export type InkAnnotation = Base & { kind: "ink"; strokes: [number, number][][]; color: string; width: number; opacity: number };
export type MarkupAnnotation = Base & { kind: "highlight" | "underline" | "strike"; rects: Box[]; color: string };
export type ShapeAnnotation = Base & Box & { kind: "rect" | "ellipse"; stroke: string; strokeWidth: number; fill: string | null; opacity: number };
export type LineAnnotation = Base & { kind: "line" | "arrow"; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth: number; opacity: number };

export type Annotation = TextAnnotation | ImageAnnotation | InkAnnotation | MarkupAnnotation | ShapeAnnotation | LineAnnotation;
/** An annotation before it has an id (each kind keeps its own fields). */
export type NewAnnotation = Annotation extends infer Item ? (Item extends Annotation ? Omit<Item, "id"> & { id?: string } : never) : never;

/** A picture used by image annotations (an uploaded image or a signature), kept in the browser until saving. */
export interface Picture {
    blob: Blob;
    url: string;
    width: number;
    height: number;
}

export const newId = () => crypto.randomUUID();

/** Text is set in Helvetica (Arial on screen) — Nepali in Noto Sans Devanagari — at 1.25 line height. */
export const TEXT_FONT = 'Helvetica, Arial, "Noto Sans Devanagari", sans-serif';
export const LINE_HEIGHT = 1.25;

let measurer: CanvasRenderingContext2D | null = null;
/** A text box's size: its widest line by its number of lines. */
function measureText(text: string, size: number, bold: boolean) {
    measurer ??= document.createElement("canvas").getContext("2d");
    const lines = text.split("\n");
    let width = size * 0.5;
    if (measurer) {
        measurer.font = `${bold ? 700 : 400} ${size}px ${TEXT_FONT}`;
        for (const line of lines) width = Math.max(width, measurer.measureText(line).width);
    }
    return { width: Math.ceil(width + 1), height: lines.length * size * LINE_HEIGHT };
}

/** A text annotation with its box fitted to the text (kept centred where it was, so turning stays put). */
export function refit(item: TextAnnotation, changes: Partial<TextAnnotation> = {}): TextAnnotation {
    const next = { ...item, ...changes };
    const { width, height } = measureText(next.text || " ", next.size, next.bold);
    const centre = { x: item.x + item.width / 2, y: item.y + item.height / 2 };
    // A turned box grows from its centre; an unturned one from its top left (like typing).
    return next.rotation ? { ...next, width, height, x: centre.x - width / 2, y: centre.y - height / 2 } : { ...next, width, height };
}

/** The area an annotation covers (unturned), for selection frames. */
export function bounds(item: Annotation): Box {
    switch (item.kind) {
        case "ink": {
            const points = item.strokes.flat();
            const xs = points.map((point) => point[0]);
            const ys = points.map((point) => point[1]);
            const pad = item.width / 2;
            return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, width: Math.max(...xs) - Math.min(...xs) + item.width, height: Math.max(...ys) - Math.min(...ys) + item.width };
        }
        case "highlight":
        case "underline":
        case "strike": {
            const left = Math.min(...item.rects.map((rect) => rect.x));
            const top = Math.min(...item.rects.map((rect) => rect.y));
            return { x: left, y: top, width: Math.max(...item.rects.map((rect) => rect.x + rect.width)) - left, height: Math.max(...item.rects.map((rect) => rect.y + rect.height)) - top };
        }
        case "line":
        case "arrow":
            return { x: Math.min(item.x1, item.x2), y: Math.min(item.y1, item.y2), width: Math.abs(item.x2 - item.x1), height: Math.abs(item.y2 - item.y1) };
        default:
            return { x: item.x, y: item.y, width: item.width, height: item.height };
    }
}

/** An annotation moved by (dx, dy). */
export function moved<T extends Annotation>(item: T, dx: number, dy: number): T {
    switch (item.kind) {
        case "ink":
            return { ...item, strokes: item.strokes.map((stroke) => stroke.map(([x, y]) => [x + dx, y + dy] as [number, number])) };
        case "highlight":
        case "underline":
        case "strike":
            return { ...item, rects: item.rects.map((rect) => ({ ...rect, x: rect.x + dx, y: rect.y + dy })) };
        case "line":
        case "arrow":
            return { ...item, x1: item.x1 + dx, y1: item.y1 + dy, x2: item.x2 + dx, y2: item.y2 + dy };
        default:
            return { ...item, x: (item as Box).x + dx, y: (item as Box).y + dy };
    }
}

const turn = (x: number, y: number, degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    return { x: x * Math.cos(radians) - y * Math.sin(radians), y: x * Math.sin(radians) + y * Math.cos(radians) };
};

/**
 * A box resized by dragging one corner (sx, sy = ±1) to `pointer`, the opposite corner staying put —
 * in the box's own (turned) frame. `keepAspect`: images and signatures keep their proportions.
 */
export function resizeBox(box: Box & { rotation?: number }, sx: number, sy: number, pointer: { x: number; y: number }, keepAspect: boolean, minimum = 4): Box {
    const rotation = box.rotation ?? 0;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const offset = turn((-sx * box.width) / 2, (-sy * box.height) / 2, rotation);
    const anchor = { x: centre.x + offset.x, y: centre.y + offset.y };
    const local = turn(pointer.x - anchor.x, pointer.y - anchor.y, -rotation);
    let width = Math.max(minimum, sx * local.x);
    let height = Math.max(minimum, sy * local.y);
    if (keepAspect) {
        const factor = Math.max(width / box.width, height / box.height);
        width = Math.max(minimum, box.width * factor);
        height = Math.max(minimum, box.height * factor);
    }
    const half = turn((sx * width) / 2, (sy * height) / 2, rotation);
    return { x: anchor.x + half.x - width / 2, y: anchor.y + half.y - height / 2, width, height };
}

/** The angle (clockwise from up) of a point around a box's centre — for the turn handle. */
export function angleAround(box: Box, pointer: { x: number; y: number }, snap: boolean) {
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    let degrees = (Math.atan2(pointer.y - centre.y, pointer.x - centre.x) * 180) / Math.PI + 90;
    if (snap) degrees = Math.round(degrees / 15) * 15;
    degrees = ((degrees % 360) + 360) % 360;
    return degrees > 180 ? degrees - 360 : degrees;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** What's sent to the server: the edits (ids dropped, numbers rounded) and the pictures they use. */
export function toPayload(items: readonly Annotation[]) {
    return items.map((item) => {
        const { id: _id, ...rest } = item;
        switch (rest.kind) {
            case "ink":
                return { ...rest, strokes: rest.strokes.map((stroke) => stroke.map(([x, y]) => [round(x), round(y)])) };
            case "highlight":
            case "underline":
            case "strike":
                return { ...rest, rects: rest.rects.map((rect) => ({ x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) })) };
            case "line":
            case "arrow":
                return { ...rest, x1: round(rest.x1), y1: round(rest.y1), x2: round(rest.x2), y2: round(rest.y2) };
            case "image": {
                const { signature: _signature, ...image } = rest;
                return { ...image, x: round(image.x), y: round(image.y), width: round(image.width), height: round(image.height), rotation: round(image.rotation) };
            }
            default:
                return { ...rest, x: round(rest.x), y: round(rest.y), width: round(rest.width), height: round(rest.height), ...("rotation" in rest ? { rotation: round(rest.rotation) } : {}) };
        }
    });
}

/** Rectangles on one line of text merged into one (selections come as a box per text run). */
export function mergeLineRects(rects: Box[]): Box[] {
    const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
    const merged: Box[] = [];
    for (const rect of sorted) {
        const last = merged[merged.length - 1];
        const sameLine = last && Math.abs(last.y + last.height / 2 - (rect.y + rect.height / 2)) < Math.min(last.height, rect.height) * 0.5;
        if (last && sameLine && rect.x <= last.x + last.width + rect.height * 0.6) {
            const right = Math.max(last.x + last.width, rect.x + rect.width);
            const top = Math.min(last.y, rect.y);
            const bottom = Math.max(last.y + last.height, rect.y + rect.height);
            last.x = Math.min(last.x, rect.x);
            last.width = right - last.x;
            last.y = top;
            last.height = bottom - top;
        } else merged.push({ ...rect });
    }
    return merged;
}
