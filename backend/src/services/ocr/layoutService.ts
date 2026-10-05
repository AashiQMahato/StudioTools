import type { BlockType, Box, LayoutRegion, Recognition, RecognizedLine, RecognizedWord } from "./types.js";

/** A block before formatting: its kind, its lines (in working-image pixels) and any structure. */
export interface LayoutGroup {
    kind: BlockType;
    lines: RecognizedLine[];
    box: Box;
    list?: { ordered: boolean; items: { marker: string; lines: RecognizedLine[] }[] };
    table?: { rows: string[][]; columns: number[]; rowHeights: number[] };
}

const right = (box: Box) => box.x + box.width;
const bottom = (box: Box) => box.y + box.height;
const union = (boxes: Box[]): Box => {
    const x = Math.min(...boxes.map((box) => box.x));
    const y = Math.min(...boxes.map((box) => box.y));
    return { x, y, width: Math.max(...boxes.map(right)) - x, height: Math.max(...boxes.map(bottom)) - y };
};
const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(right(a), right(b)) - Math.max(a.x, b.x)) * Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y));
const median = (values: number[]) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
};

/** Layout-model labels → block kinds. Regions of pictures, charts and seals don't make blocks. */
const KINDS: Record<string, BlockType> = {
    doc_title: "title",
    paragraph_title: "heading",
    header: "header",
    header_image: "header",
    footer: "footer",
    footer_image: "footer",
    number: "footer",
    footnote: "footer",
    table: "table",
    figure_title: "caption",
    table_title: "caption",
    chart_title: "caption",
    text: "paragraph",
    content: "paragraph",
    abstract: "paragraph",
    reference: "paragraph",
    reference_content: "paragraph",
    aside_text: "paragraph",
    algorithm: "paragraph",
};
/** When regions overlap heavily, the more specific kind wins. */
const PRIORITY: BlockType[] = ["title", "table", "heading", "header", "footer", "caption", "paragraph"];

// A bullet, or a number/letter/roman/Devanagari numeral followed by "." or ")".
const LIST_MARKER = /^\s*((?:[•●○◦▪■▶►\-–—*·✓✔])|(?:(?:\d{1,3}|[a-zA-Z]|[ivxlcIVXLC]{1,5}|[०-९]{1,3})[.)]))\s+/u;
const ORDERED = /^\s*(?:\d|[a-zA-Z]|[०-९])/u;

function mergeRow(segments: RecognizedLine[]): RecognizedLine {
    const sorted = [...segments].sort((a, b) => a.box.x - b.box.x);
    const words: RecognizedWord[] = sorted.flatMap((segment) => segment.words);
    const confidence = sorted.reduce((sum, segment) => sum + segment.confidence * segment.text.length, 0) / Math.max(1, sorted.reduce((sum, segment) => sum + segment.text.length, 0));
    // Pieces that touch (a word split by the engine, "." after a word) join without a space.
    const text = sorted.reduce((joined, segment, index) => {
        const piece = segment.text.trim();
        if (!index) return piece;
        const previous = sorted[index - 1]!;
        const gap = segment.box.x - (previous.box.x + previous.box.width);
        return joined + (gap < Math.min(segment.box.height, previous.box.height) * 0.25 ? "" : " ") + piece;
    }, "");
    return { text, confidence, box: union(sorted.map((segment) => segment.box)), textHeight: median(sorted.map((segment) => segment.textHeight)), words };
}

/**
 * Pieces of one visual line (engines split a line where the gap is wide) become one line again:
 * they share a row (vertical overlap) and sit close enough horizontally.
 */
function reconstructLines(segments: RecognizedLine[]): RecognizedLine[] {
    const sorted = [...segments].sort((a, b) => a.box.y + a.box.height / 2 - (b.box.y + b.box.height / 2));
    const rows: RecognizedLine[][] = [];
    for (const segment of sorted) {
        const row = rows.find((candidate) =>
            candidate.some((other) => {
                const shared = Math.min(bottom(other.box), bottom(segment.box)) - Math.max(other.box.y, segment.box.y);
                const gap = Math.max(other.box.x, segment.box.x) - Math.min(right(other.box), right(segment.box));
                return shared >= 0.6 * Math.min(other.box.height, segment.box.height) && gap < 1.6 * Math.max(other.box.height, segment.box.height);
            }),
        );
        if (row) row.push(segment);
        else rows.push([segment]);
    }
    return rows.map(mergeRow).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
}

/** Paragraphs: a new one starts where the vertical gap is clearly larger than the line spacing. */
function paragraphs(lines: RecognizedLine[]): RecognizedLine[][] {
    const sorted = [...lines].sort((a, b) => a.box.y - b.box.y);
    const height = median(sorted.map((line) => line.box.height));
    const gaps = sorted.slice(1).map((line, index) => line.box.y - bottom(sorted[index]!.box));
    const usual = median(gaps.filter((gap) => gap < height * 1.5));
    const groups: RecognizedLine[][] = [];
    sorted.forEach((line, index) => {
        const gap = index ? gaps[index - 1]! : 0;
        if (!index || gap > Math.max(usual * 1.8, height * 0.7)) groups.push([line]);
        else groups.at(-1)!.push(line);
    });
    return groups;
}

/** A paragraph whose lines start with bullets or numbers is a list (lines before the first marker stay a paragraph). */
function splitList(lines: RecognizedLine[]): LayoutGroup[] {
    const first = lines.findIndex((line) => LIST_MARKER.test(line.text));
    const markers = lines.filter((line) => LIST_MARKER.test(line.text)).length;
    if (first < 0 || markers < 1 || (markers === 1 && lines.length === 1 && !/^\s*[•●○◦▪■▶►\-–—*·✓✔]/u.test(lines[0]!.text))) {
        return [{ kind: "paragraph", lines, box: union(lines.map((line) => line.box)) }];
    }
    const before = lines.slice(0, first);
    const items: { marker: string; lines: RecognizedLine[] }[] = [];
    for (const line of lines.slice(first)) {
        const match = LIST_MARKER.exec(line.text);
        if (match) items.push({ marker: match[1]!, lines: [{ ...line, text: line.text.slice(match[0].length) }] });
        else items.at(-1)!.lines.push(line);
    }
    const listLines = lines.slice(first);
    const groups: LayoutGroup[] = [];
    if (before.length) groups.push({ kind: "paragraph", lines: before, box: union(before.map((line) => line.box)) });
    groups.push({ kind: "list", lines: listLines, box: union(listLines.map((line) => line.box)), list: { ordered: ORDERED.test(items[0]!.marker), items } });
    return groups;
}

/**
 * A table from the positions of its cells: rows by vertical position, columns by clustering where
 * cells start. One column isn't a table — then it's just text.
 */
function buildTable(segments: RecognizedLine[]): { rows: string[][]; columns: number[]; rowHeights: number[] } | null {
    if (segments.length < 4) return null;
    const height = median(segments.map((segment) => segment.box.height));
    const byRow = [...segments].sort((a, b) => a.box.y + a.box.height / 2 - (b.box.y + b.box.height / 2));
    const rows: RecognizedLine[][] = [];
    for (const segment of byRow) {
        const centre = segment.box.y + segment.box.height / 2;
        const row = rows.at(-1);
        const rowCentre = row ? median(row.map((cell) => cell.box.y + cell.box.height / 2)) : -Infinity;
        if (row && Math.abs(centre - rowCentre) < height * 0.6) row.push(segment);
        else rows.push([segment]);
    }
    // Columns: cells whose horizontal extents overlap share a column (so a centred header joins the
    // column beneath it, however it's aligned).
    const spans: { start: number; end: number }[] = [];
    for (const segment of [...segments].sort((a, b) => a.box.x - b.box.x)) {
        const start = segment.box.x;
        const end = segment.box.x + segment.box.width;
        const last = spans.at(-1);
        if (last && start <= last.end + height * 0.5) last.end = Math.max(last.end, end);
        else spans.push({ start, end });
    }
    const columns = spans.map((span) => span.start);
    if (columns.length < 2 || rows.length < 2) return null;
    const columnOf = (segment: RecognizedLine) => {
        const centre = segment.box.x + segment.box.width / 2;
        const index = spans.findIndex((span) => centre >= span.start - height * 0.5 && centre <= span.end + height * 0.5);
        return index < 0 ? 0 : index;
    };
    const texts = rows.map((row) => {
        const cells = columns.map(() => [] as string[]);
        for (const cell of [...row].sort((a, b) => a.box.x - b.box.x)) cells[columnOf(cell)]!.push(cell.text.trim());
        return cells.map((parts) => parts.join(" "));
    });
    // Each column's share of the table's width: from where it starts to where the next one does.
    const box = union(segments.map((segment) => segment.box));
    const edges = [box.x, ...columns.slice(1), box.x + box.width];
    const widths = edges.slice(1).map((edge, index) => Math.max(1, edge - edges[index]!));
    const total = widths.reduce((sum, width) => sum + width, 0);
    // Each row's share of its height: boundaries halfway between neighbouring rows' centres.
    const centres = rows.map((row) => median(row.map((cell) => cell.box.y + cell.box.height / 2)));
    const bounds = [box.y, ...centres.slice(1).map((centre, index) => (centre + centres[index]!) / 2), box.y + box.height];
    const heights = bounds.slice(1).map((bound, index) => Math.max(1, bound - bounds[index]!));
    const tall = heights.reduce((sum, height) => sum + height, 0);
    const share = (value: number, sum: number) => Math.round((value / sum) * 1000) / 1000;
    return { rows: texts, columns: widths.map((width) => share(width, total)), rowHeights: heights.map((height) => share(height, tall)) };
}

/** Keeps the clearest of heavily overlapping regions (the layout model often reports both kinds of title). */
function cleanRegions(regions: LayoutRegion[]) {
    const usable = regions
        .filter((region) => region.score >= 0.4 && KINDS[region.label])
        .map((region) => ({ ...region, kind: KINDS[region.label]! }))
        .sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind) || b.score - a.score);
    const kept: typeof usable = [];
    for (const region of usable) {
        const duplicate = kept.some((other) => overlapArea(other.box, region.box) > 0.6 * Math.min(other.box.width * other.box.height, region.box.width * region.box.height));
        if (!duplicate) kept.push(region);
    }
    return kept;
}

/**
 * Lines → blocks. With a layout model, each line joins the region it sits in and takes that
 * region's kind; without one (or for lines no region covers), blocks come from geometry alone.
 * Either way, blocks are then split into paragraphs, lists and tables, and put in reading order.
 */
export function analyzeLayout(recognition: Recognition): LayoutGroup[] {
    const { lines: segments, height } = recognition;
    if (!segments.length) return [];
    const regions = cleanRegions(recognition.regions);
    const buckets = new Map<number, RecognizedLine[]>();
    const loose: RecognizedLine[] = [];
    for (const segment of segments) {
        let best = -1;
        let bestShare = 0.5;
        regions.forEach((region, index) => {
            const share = overlapArea(region.box, segment.box) / Math.max(1, segment.box.width * segment.box.height);
            if (share > bestShare) {
                best = index;
                bestShare = share;
            }
        });
        if (best < 0) loose.push(segment);
        else buckets.set(best, [...(buckets.get(best) ?? []), segment]);
    }

    const groups: LayoutGroup[] = [];
    for (const [index, members] of buckets) {
        const region = regions[index]!;
        if (region.kind === "table") {
            const table = buildTable(members);
            if (table) {
                groups.push({ kind: "table", lines: reconstructLines(members), box: union(members.map((line) => line.box)), table });
                continue;
            }
        }
        const lines = reconstructLines(members);
        if (region.kind === "paragraph" || region.kind === "table") for (const paragraph of paragraphs(lines)) groups.push(...splitList(paragraph));
        else groups.push({ kind: region.kind, lines, box: union(lines.map((line) => line.box)) });
    }
    // Lines outside every region: grouped by closeness, then treated like body text.
    for (const paragraph of paragraphs(reconstructLines(loose))) groups.push(...splitList(paragraph));

    // Geometry fills in what the model didn't say: noticeably larger short blocks are headings, and
    // small lines hugging the top or bottom edge are running headers and footers.
    // Body text size: paragraphs and lists — or, on a page that is only a heading and a table, the table.
    const bodyGroups = groups.filter((group) => group.kind === "paragraph" || group.kind === "list");
    const body = median((bodyGroups.length > 1 ? bodyGroups : groups.filter((group) => group.kind !== "title" && group.kind !== "heading")).flatMap((group) => group.lines.map((line) => line.textHeight)));
    for (const group of groups) {
        const size = median(group.lines.map((line) => line.textHeight));
        if (group.kind === "paragraph" && group.lines.length <= 2 && body && size >= body * 1.3) group.kind = size >= body * 1.7 ? "title" : "heading";
        if (group.kind === "paragraph" && group.lines.length <= 2 && (!body || size <= body * 1.05)) {
            if (bottom(group.box) < height * 0.07) group.kind = "header";
            else if (group.box.y > height * 0.93) group.kind = "footer";
        }
    }
    // Only one title: extra "titles" are headings.
    let titled = false;
    for (const group of [...groups].sort((a, b) => a.box.y - b.box.y)) {
        if (group.kind !== "title") continue;
        if (titled) group.kind = "heading";
        titled = true;
    }

    // Reading order: top to bottom; side-by-side blocks (columns) left to right.
    return groups.sort((a, b) => {
        const sideBySide = Math.min(bottom(a.box), bottom(b.box)) - Math.max(a.box.y, b.box.y) > 0 && (right(a.box) <= b.box.x || right(b.box) <= a.box.x);
        return sideBySide ? a.box.x - b.box.x : a.box.y - b.box.y;
    });
}
