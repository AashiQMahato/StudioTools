import { ApiError, apiBase } from "./apiClient";

/**
 * POSTs a form and reads a newline-delimited JSON stream: every event before the end goes to
 * `onEvent`; `{ type: "result", data }` resolves, `{ type: "error", code, message }` rejects with an
 * ApiError. Used where the server reports real progress while it works.
 */
export async function postNdjson<Result, Event>(path: string, form: FormData, onEvent: (event: Event) => void, { signal, timeoutMs }: { signal?: AbortSignal; timeoutMs: number }): Promise<Result> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const failure = (error: unknown) => {
        if (timeout.aborted) return new ApiError("Timed out", 408, "PROCESSING_TIMEOUT");
        if (error instanceof DOMException && error.name === "AbortError") return error;
        return new ApiError("Network error", 0, "NETWORK");
    };

    let response: Response;
    try {
        response = await fetch(`${apiBase(path)}/api${path}`, { method: "POST", body: form, signal: combined });
    } catch (error) {
        throw failure(error);
    }
    if (!response.ok || !response.body) {
        // Rejected before work started (size, type, rate limit): a normal JSON error.
        const body = (await response.json().catch(() => null)) as { message?: string; code?: string } | null;
        throw new ApiError(body?.message ?? "Request failed", response.status, body?.code);
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let pending = "";
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            pending += value;
            let newline: number;
            while ((newline = pending.indexOf("\n")) >= 0) {
                const line = pending.slice(0, newline).trim();
                pending = pending.slice(newline + 1);
                if (!line) continue;
                const event = JSON.parse(line) as { type: string; data?: Result; code?: string; message?: string };
                if (event.type === "result") return event.data as Result;
                if (event.type === "error") throw new ApiError(event.message ?? "Processing failed", 422, event.code);
                onEvent(event as Event);
            }
        }
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw failure(error);
    } finally {
        reader.releaseLock();
    }
    // The stream ended without a result: the connection dropped.
    throw new ApiError("Connection lost", 0, "NETWORK");
}
