import { detectDocument, DETECT_SIDE } from "./detect";
import { applyLook } from "./filters";
import { outputSize, rotateQuad, scaleQuad, warpPerspective } from "./geometry";
import type { ScanRequest, ScanResponse } from "./scanClient";

/** The last photo decoded, at full size and detection size. One at a time: phones run short of memory. */
let cached: { key: string; full: ImageData; small: ImageData } | null = null;

async function decode(key: string, file: Blob) {
    if (cached?.key === key) return cached;
    cached = null;
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
        throw new Error("decode");
    }
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(bitmap, 0, 0);
    const full = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const scale = Math.min(1, DETECT_SIDE / Math.max(bitmap.width, bitmap.height));
    const small = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    const smallContext = small.getContext("2d", { willReadFrequently: true })!;
    smallContext.imageSmoothingQuality = "high";
    smallContext.drawImage(bitmap, 0, 0, small.width, small.height);
    bitmap.close();
    cached = { key, full, small: smallContext.getImageData(0, 0, small.width, small.height) };
    return cached;
}

async function handle(request: ScanRequest): Promise<unknown> {
    if (request.type === "forget") {
        if (cached?.key === request.key) cached = null;
        return null;
    }
    const { full, small } = await decode(request.key, request.file);
    if (request.type === "detect") {
        const found = detectDocument(small.data, small.width, small.height);
        return { width: full.width, height: full.height, quad: scaleQuad(found.quad, full.width / small.width, full.height / small.height), confident: found.confident };
    }
    const quad = rotateQuad(request.quad, request.quarterTurns);
    const { width, height } = outputSize(quad);
    const pixels = warpPerspective(full, quad, width, height);
    applyLook(pixels, width, height, request.look);
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d")!.putImageData(new ImageData(pixels, width, height), 0, 0);
    const blob = await canvas.convertToBlob({ type: request.format, quality: 0.9 });
    return { blob, width, height };
}

// One request at a time, in order: never two full-size photos in memory at once.
let queue = Promise.resolve();
self.addEventListener("message", (event: MessageEvent<ScanRequest>) => {
    const request = event.data;
    queue = queue.then(async () => {
        let response: ScanResponse;
        try {
            response = { id: request.id, ok: true, result: await handle(request) };
        } catch (error) {
            response = { id: request.id, ok: false, error: error instanceof Error ? error.message : "render" };
        }
        self.postMessage(response);
    });
});
