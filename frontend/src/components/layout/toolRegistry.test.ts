import assert from "node:assert/strict";
import { test } from "node:test";
import { ROUTES } from "@/lib/constants/routes";
import { AI_ROUTES, groupTools, NAV_GROUPS, popularTools, TOOL_REGISTRY } from "./toolRegistry";

const routes = new Set<string>(Object.values(ROUTES));

test("every registry tool points at a route that exists, with no duplicate ids", () => {
    assert.equal(new Set(TOOL_REGISTRY.map((tool) => tool.id)).size, TOOL_REGISTRY.length);
    for (const tool of TOOL_REGISTRY) assert.ok(routes.has(tool.route), `${tool.id} → ${tool.route}`);
});

test("each tool sits in one navbar column only, and every column key resolves", () => {
    const seen = NAV_GROUPS.flatMap((group) => groupTools(group).map((tool) => tool.id));
    assert.equal(new Set(seen).size, seen.length);
    // Resolving a column throws on an unknown tool, so reaching here means every listed tool exists.
    assert.deepEqual(groupTools("pdf").map((tool) => tool.id).slice(0, 2), ["pdfMerge", "pdfSplit"]);
    assert.ok(seen.includes("organizePdf"));
});

test("popular shortcuts and AI routes are tools that exist", () => {
    assert.equal(popularTools().length, 4);
    assert.ok(AI_ROUTES.includes(ROUTES.objectRemover) && AI_ROUTES.includes(ROUTES.photoRestoration));
});
