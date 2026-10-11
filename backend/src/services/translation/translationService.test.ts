import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { AppError } from "../../utils/AppError.js";
import { createGoogleProvider, decodeEntities } from "./googleProvider.js";
import { createLibreTranslateProvider } from "./libreTranslateProvider.js";
import { createTranslationService, MAX_CHARACTERS, MAX_SEGMENTS, parseTranslateRequest } from "./translationService.js";

const SECRET = "sk-test-SECRET-123";

interface Seen {
    method?: string;
    url?: string;
    headers: http.IncomingHttpHeaders;
    body: Record<string, unknown>;
}

/** A local stand-in for a provider: records each request and answers with `reply`. */
async function mockServer(reply: (seen: Seen) => { status?: number; json?: unknown; hang?: boolean }) {
    const requests: Seen[] = [];
    const server = http.createServer((req, res) => {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
            const seen: Seen = { method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : {} };
            requests.push(seen);
            const answer = reply(seen);
            if (answer.hang) return;
            res.writeHead(answer.status ?? 200, { "Content-Type": "application/json" }).end(JSON.stringify(answer.json));
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    after(() => {
        server.closeAllConnections();
        server.close();
    });
    return { url, requests };
}

const never = new AbortController().signal;

async function rejectsWith(promise: Promise<unknown>, code: string, status: number) {
    await assert.rejects(promise, (error: unknown) => {
        assert.ok(error instanceof AppError, String(error));
        assert.equal(error.code, code);
        assert.equal(error.statusCode, status);
        return true;
    });
}

test("not configured: status says so and translate is a 503", async () => {
    for (const service of [createTranslationService(null, 1000), createTranslationService(createGoogleProvider({ apiKey: "" }), 1000), createTranslationService(createLibreTranslateProvider({ url: "", apiKey: "" }), 1000)]) {
        assert.deepEqual(service.status(), { available: false, provider: null, message: "Translation isn't set up on this server." });
        await rejectsWith(service.translate({ texts: ["hi"], source: "en", target: "ne" }, never), "TRANSLATION_NOT_CONFIGURED", 503);
    }
});

test("LibreTranslate: request shape, auto-detect, order preserved", async () => {
    const { url, requests } = await mockServer(({ body }) => ({
        json: { translatedText: (body.q as string[]).map((text) => `[${body.target}] ${text}`), detectedLanguage: [{ confidence: 90, language: "en" }, { confidence: 80, language: "en" }] },
    }));
    const service = createTranslationService(createLibreTranslateProvider({ url: `${url}/`, apiKey: SECRET }), 2000);
    assert.deepEqual(service.status(), { available: true, provider: "libretranslate", message: "Translation is available." });
    const result = await service.translate({ texts: ["Hello", "  ", "World"], source: "auto", target: "ne" }, never);
    assert.deepEqual(result, { translations: ["[ne] Hello", "", "[ne] World"], detectedSource: "en", provider: "libretranslate" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].url, "/translate");
    assert.deepEqual(requests[0].body, { q: ["Hello", "World"], source: "auto", target: "ne", format: "text", api_key: SECRET });
});

test("LibreTranslate: a single-object reply and a reply without detection", async () => {
    const { url } = await mockServer(({ body }) => ({ json: body.source === "auto" ? { translatedText: "नमस्ते", detectedLanguage: { confidence: 99, language: "en" } } : { translatedText: ["नमस्ते"] } }));
    const provider = createLibreTranslateProvider({ url, apiKey: "" });
    assert.deepEqual(await provider.translate(["Hello"], "auto", "ne", never), { translations: ["नमस्ते"], detectedSource: "en" });
    assert.deepEqual(await provider.translate(["Hello"], "en", "ne", never), { translations: ["नमस्ते"] });
});

test("Google: key in a header (not the URL), no source when auto, entities decoded, order preserved, >128 segments split", async () => {
    const { url, requests } = await mockServer(({ body }) => ({
        json: { data: { translations: (body.q as string[]).map((text) => ({ translatedText: `${text} &amp; &#39;ok&#39; &quot;x&quot; &#x0928;`, detectedSourceLanguage: "en" })) } },
    }));
    const service = createTranslationService(createGoogleProvider({ apiKey: SECRET, url: `${url}/language/translate/v2` }), 2000);
    const texts = Array.from({ length: 150 }, (_, i) => `t${i}`);
    const result = await service.translate({ texts, source: "auto", target: "hi" }, never);
    assert.equal(result.translations.length, 150);
    assert.equal(result.translations[0], `t0 & 'ok' "x" न`);
    assert.equal(result.translations[149], `t149 & 'ok' "x" न`);
    assert.equal(result.detectedSource, "en");
    assert.equal(requests.length, 2);
    assert.equal((requests[0].body.q as string[]).length, 128);
    for (const request of requests) {
        assert.equal(request.url, "/language/translate/v2");
        assert.equal(request.headers["x-goog-api-key"], SECRET);
        assert.equal(request.body.format, "text");
        assert.equal(request.body.target, "hi");
        assert.ok(!("source" in request.body));
    }
    await service.translate({ texts: ["Hello"], source: "en", target: "ne" }, never);
    assert.equal(requests[2].body.source, "en");
});

test("decodeEntities leaves unknown and malformed entities alone", () => {
    assert.equal(decodeEntities("a &lt;b&gt; &unknown; &#0; &#65;"), "a <b> &unknown; &#0; A");
});

test("provider errors become TRANSLATION_FAILED without the key or the provider's body", async () => {
    const { url } = await mockServer(() => ({ status: 403, json: { error: { message: `API key ${SECRET} is invalid; text was: secret words` } } }));
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
    try {
        for (const provider of [createGoogleProvider({ apiKey: SECRET, url }), createLibreTranslateProvider({ url, apiKey: SECRET })]) {
            const service = createTranslationService(provider, 2000);
            await assert.rejects(service.translate({ texts: ["secret words"], source: "en", target: "ne" }, never), (error: unknown) => {
                assert.ok(error instanceof AppError);
                assert.equal(error.code, "TRANSLATION_FAILED");
                assert.equal(error.statusCode, 502);
                assert.ok(!error.message.includes(SECRET) && !error.message.includes("secret words"));
                return true;
            });
        }
        // A malformed (but 200) reply is a failure too, never passed through.
        const bad = await mockServer(() => ({ json: { translatedText: ["only one"] } }));
        await rejectsWith(createTranslationService(createLibreTranslateProvider({ url: bad.url, apiKey: "" }), 2000).translate({ texts: ["a", "b"], target: "ne" }, never), "TRANSLATION_FAILED", 502);
        // Unreachable server.
        await rejectsWith(createTranslationService(createLibreTranslateProvider({ url: "http://127.0.0.1:1", apiKey: SECRET }), 2000).translate({ texts: ["a"], target: "ne" }, never), "TRANSLATION_FAILED", 502);
    } finally {
        console.warn = warn;
    }
    assert.ok(warnings.length >= 4);
    for (const line of warnings) assert.ok(!line.includes(SECRET) && !line.includes("secret words") && !line.includes("127.0.0.1"), line);
});

test("a slow provider times out with TRANSLATION_TIMEOUT; a client that leaves is REQUEST_CANCELLED", async () => {
    const { url } = await mockServer(() => ({ hang: true }));
    const service = createTranslationService(createLibreTranslateProvider({ url, apiKey: "" }), 100);
    await rejectsWith(service.translate({ texts: ["Hello"], target: "ne" }, never), "TRANSLATION_TIMEOUT", 504);
    const slow = createTranslationService(createLibreTranslateProvider({ url, apiKey: "" }), 5000);
    await rejectsWith(slow.translate({ texts: ["Hello"], target: "ne" }, AbortSignal.timeout(50)), "REQUEST_CANCELLED", 499);
});

test("size limits", () => {
    const tooLong = (body: unknown) => assert.throws(() => parseTranslateRequest(body), (error: unknown) => error instanceof AppError && error.code === "TEXT_TOO_LONG" && error.statusCode === 413);
    tooLong({ texts: Array.from({ length: MAX_SEGMENTS + 1 }, () => "a"), target: "ne" });
    tooLong({ texts: ["a".repeat(MAX_CHARACTERS - 5), "b".repeat(6)], target: "ne" });
    assert.doesNotThrow(() => parseTranslateRequest({ texts: Array.from({ length: MAX_SEGMENTS }, () => "a"), target: "ne" }));
    assert.doesNotThrow(() => parseTranslateRequest({ texts: ["a".repeat(MAX_CHARACTERS)], target: "ne" }));
});

test("languages are checked against the allow-list pattern; malformed bodies are INVALID_REQUEST", () => {
    const code = (body: unknown) => {
        try {
            parseTranslateRequest(body);
            return "ok";
        } catch (error) {
            return (error as AppError).code;
        }
    };
    for (const target of ["ne", "hi", "fil", "zh-CN", "zh-Hans", "pt-BR"]) assert.equal(code({ texts: ["a"], source: "auto", target }), "ok", target);
    for (const target of ["english", "EN", "e", "../etc", "en-", "en-US-x", "auto", "", 5, null]) assert.equal(code({ texts: ["a"], source: "auto", target }), "INVALID_LANGUAGE", String(target));
    assert.equal(code({ texts: ["a"], source: "xx;rm", target: "ne" }), "INVALID_LANGUAGE");
    assert.equal(code({ texts: ["a"], source: "ne", target: "ne" }), "INVALID_LANGUAGE");
    for (const body of [null, {}, { texts: "a", target: "ne" }, { texts: [], target: "ne" }, { texts: ["a", 3], target: "ne" }]) assert.equal(code(body), "INVALID_REQUEST");
});
