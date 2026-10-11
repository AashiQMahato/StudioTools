import type { Look } from "./filters";
import type { Quad } from "./geometry";

export type ImageFormat = "image/jpeg" | "image/png";

export interface DetectResult {
    /** The photo's upright size (EXIF orientation applied). */
    width: number;
    height: number;
    quad: Quad;
    confident: boolean;
}

export interface RenderResult {
    blob: Blob;
    width: number;
    height: number;
}

type Request =
    | { type: "detect"; key: string; file: Blob }
    | { type: "render"; key: string; file: Blob; quad: Quad; quarterTurns: number; look: Look; format: ImageFormat }
    | { type: "forget"; key: string };

export type ScanRequest = Request & { id: number };
export type ScanResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** The browser can do the work off the main thread (every current browser can; very old ones can't). */
export const scannerSupported = () => typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined";

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function connect(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<ScanResponse>) => {
        const call = pending.get(event.data.id);
        if (!call) return;
        pending.delete(event.data.id);
        if (event.data.ok) call.resolve(event.data.result);
        else call.reject(new Error(event.data.error));
    };
    // A crash (e.g. out of memory) fails everything waiting; the next call starts a fresh worker.
    worker.onerror = (event) => {
        event.preventDefault();
        disconnectScanner();
    };
    return worker;
}

function call<T>(request: Request): Promise<T> {
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        connect().postMessage({ ...request, id } satisfies ScanRequest);
    });
}

/** Finds the page in a photo. `key` lets the worker keep the decoded photo for the renders that follow. */
export const detectPage = (key: string, file: Blob) => call<DetectResult>({ type: "detect", key, file });

/** Flattens, turns and cleans up a page at full resolution. */
export const renderPage = (key: string, file: Blob, quad: Quad, quarterTurns: number, look: Look, format: ImageFormat = "image/jpeg") => call<RenderResult>({ type: "render", key, file, quad, quarterTurns, look, format });

/** The page is gone: drop its decoded photo if the worker still holds it. */
export const forgetPage = (key: string) => worker && void call({ type: "forget", key });

export function disconnectScanner() {
    worker?.terminate();
    worker = null;
    pending.forEach((call) => call.reject(new Error("worker")));
    pending.clear();
}
