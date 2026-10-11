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
