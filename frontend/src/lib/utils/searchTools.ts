export interface Searchable {
    name: string;
    description: string;
    keywords: readonly string[];
}

/** Lower-case, accent-free, for matching only. */
export const normalise = (text: string) =>
    text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .trim();

/**
 * Tools matching a query, best first: every word must appear in the name, description or keywords;
 * words at the start of the name rank highest, then elsewhere in it, then the rest.
 */
export function searchTools<T extends Searchable>(items: readonly T[], query: string): T[] {
    const words = normalise(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const scored: { item: T; score: number }[] = [];
    for (const item of items) {
        const name = normalise(item.name);
        const rest = normalise([item.description, ...item.keywords].join(" "));
        let score = 0;
        for (const word of words) {
            if (name.startsWith(word)) score += 3;
            else if (name.includes(word)) score += 2;
            else if (rest.includes(word)) score += 1;
            else {
                score = -1;
                break;
            }
        }
        if (score > 0) scored.push({ item, score });
    }
    // Array.sort is stable, so equal scores keep the registry's order.
    return scored.sort((a, b) => b.score - a.score).map((entry) => entry.item);
}

/**
 * Where a query's words appear in a piece of text, as merged [start, end) ranges — for highlighting a
 * result. Case-insensitive; text whose length changes when lower-cased is left unhighlighted.
 */
export function matchRanges(text: string, query: string): [number, number][] {
    const lower = text.toLowerCase();
    if (lower.length !== text.length) return [];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const ranges: [number, number][] = [];
    for (const word of words) {
        for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + word.length)) ranges.push([at, at + word.length]);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const range of ranges) {
        const last = merged.at(-1);
        if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
        else merged.push([...range]);
    }
    return merged;
}
