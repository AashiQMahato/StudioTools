import assert from "node:assert/strict";
import { test } from "node:test";
import { DICTIONARIES } from "@/i18n";
import { ROUTES } from "@/lib/constants/routes";
import { searchTools } from "@/lib/utils/searchTools";
import { buildSearchIndex, suggestedEntries } from "./searchIndex";

const routes = new Set<string>(Object.values(ROUTES));

for (const [locale, t] of Object.entries(DICTIONARIES)) {
    test(`${locale}: every entry opens a real route, once, with a title and a category`, () => {
        const index = buildSearchIndex(t);
        assert.equal(new Set(index.map((entry) => entry.id)).size, index.length);
        for (const entry of index) {
            assert.ok(routes.has(entry.route), `${entry.id} → ${entry.route}`);
            assert.ok(entry.title && entry.description && entry.category, entry.id);
        }
    });
}

test("search reaches image, AI, PDF and document tools and the Whiteboard", () => {
    const index = buildSearchIndex(DICTIONARIES.en);
    const find = (query: string) => searchTools(index.map((entry) => ({ ...entry, name: entry.title })), query).map((entry) => entry.id);
    assert.equal(find("whiteboard")[0], "whiteboard");
    assert.ok(find("diagram").includes("whiteboard"));
    assert.ok(find("background").includes("removeBackground"));
    assert.ok(find("merge").includes("pdfMerge"));
    assert.ok(find("ocr").includes("ocr"));
    assert.ok(find("compress").includes("compressor"));
});

test("suggestions are the popular tools, then the Whiteboard", () => {
    const suggested = suggestedEntries(buildSearchIndex(DICTIONARIES.en));
    assert.equal(suggested.at(-1)?.id, "whiteboard");
    assert.ok(suggested.length >= 4);
});
