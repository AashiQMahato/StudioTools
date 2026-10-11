import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

// The real app, with translation left unconfigured (the default).
process.env.TRANSLATION_PROVIDER = "none";
let base = "";
let close = () => {};

before(async () => {
    const { createApp } = await import("../app.js");
    const server = createApp().listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    close = () => server.close();
});
after(() => close());

test("GET /api/translate/status reports not configured, with no URLs or keys", async () => {
    const response = await fetch(`${base}/translate/status`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, data: { available: false, provider: null, message: "Translation isn't set up on this server." } });
});

test("POST /api/translate answers 503 TRANSLATION_NOT_CONFIGURED", async () => {
    const response = await fetch(`${base}/translate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texts: ["Hello"], source: "en", target: "ne" }) });
    assert.equal(response.status, 503);
    const body = (await response.json()) as { success: boolean; code: string };
    assert.equal(body.success, false);
    assert.equal(body.code, "TRANSLATION_NOT_CONFIGURED");
});
