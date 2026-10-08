import { useCallback, useEffect, useReducer, useRef } from "react";
import { ApiError } from "@/lib/api/apiClient";
import { type GeneratedPhoto, type ProgressEvent, processPhoto, type Rect, type RenderedPhoto, type StepId, type WarningCode } from "@/lib/api/photoGeneratorApi";
import type { AppErrorInfo } from "@/i18n";

export const STEPS: readonly StepId[] = ["format", "orientation", "face", "background", "align", "white", "composition", "resolution", "finalize"];

export type StepStatus = "pending" | "active" | "done" | "skipped";

export interface StepState {
    status: StepStatus;
    detail?: Extract<ProgressEvent, { type: "step" }>["detail"];
}

export interface Preview {
    url: string;
    width: number;
    height: number;
}

interface State {
    status: "idle" | "running" | "done" | "error";
    steps: Record<StepId, StepState>;
    previews: Partial<Record<"original" | "cutout" | "white", Preview>>;
    /** The chosen crop, as fractions of the previews. */
    crop: Rect | null;
    warnings: WarningCode[];
    result: GeneratedPhoto | null;
    error: AppErrorInfo | null;
    startedAt: number | null;
}

const pendingSteps = () => Object.fromEntries(STEPS.map((step) => [step, { status: "pending" }])) as Record<StepId, StepState>;
const initial: State = { status: "idle", steps: pendingSteps(), previews: {}, crop: null, warnings: [], result: null, error: null, startedAt: null };

type Action =
    | { type: "start" }
    | { type: "event"; event: ProgressEvent }
    | { type: "done"; result: GeneratedPhoto }
    | { type: "fail"; error: AppErrorInfo }
    | { type: "rendered"; photo: RenderedPhoto & { crop: Rect } }
    | { type: "restore"; result: GeneratedPhoto }
    | { type: "rotated"; photo: Omit<GeneratedPhoto, "source"> }
    | { type: "reset" };

function reducer(state: State, action: Action): State {
    switch (action.type) {
        case "start":
            return { ...initial, steps: pendingSteps(), status: "running", startedAt: Date.now() };
        case "event": {
            const { event } = action;
            if (event.type === "step") return { ...state, steps: { ...state.steps, [event.step]: { status: event.status, detail: { ...state.steps[event.step].detail, ...event.detail } } } };
            if (event.type === "preview") return { ...state, previews: { ...state.previews, [event.stage]: { url: event.url, width: event.width, height: event.height } } };
            if (event.type === "crop") return { ...state, crop: event.rect };
            return state.warnings.includes(event.code) ? state : { ...state, warnings: [...state.warnings, event.code] };
        }
        case "done":
            return { ...state, status: "done", result: action.result, warnings: action.result.warnings };
        case "fail":
            return { ...state, status: "error", error: action.error };
        case "rendered": {
            if (!state.result) return state;
            const { crop, ...photo } = action.photo;
            return { ...state, result: { ...state.result, ...photo, work: { ...state.result.work, crop } } };
        }
        case "rotated":
            // The same photo, turned by hand: everything about it is new except where it came from.
            return state.result ? { ...state, result: { ...state.result, ...action.photo }, warnings: action.photo.warnings } : state;
        case "restore":
            // A saved photo only fills an empty page — never one already working or showing a result.
            return state.status === "idle" ? { ...initial, status: "done", result: action.result, warnings: action.result.warnings } : state;
        case "reset":
            return initial;
    }
}

/**
 * One run of the photo generator: the steps as the server reports them, the stage previews, and the
 * result. A new run (or leaving) cancels the one in flight.
 */
export function usePhotoJob() {
    const [state, dispatch] = useReducer(reducer, initial);
    const controller = useRef<AbortController | null>(null);

    const cancel = useCallback(() => {
        controller.current?.abort();
        controller.current = null;
        dispatch({ type: "reset" });
    }, []);
    useEffect(() => () => controller.current?.abort(), []);

    const run = useCallback(async (image: File, preset: string) => {
        controller.current?.abort();
        const abort = new AbortController();
        controller.current = abort;
        dispatch({ type: "start" });
        try {
            const result = await processPhoto(image, preset, (event) => !abort.signal.aborted && dispatch({ type: "event", event }), abort.signal);
            if (!abort.signal.aborted) dispatch({ type: "done", result });
        } catch (error) {
            if (abort.signal.aborted) return;
            dispatch({ type: "fail", error: error instanceof ApiError ? { code: error.code ?? (error.status === 0 ? "NETWORK" : undefined) } : { code: "GENERIC" } });
        } finally {
            if (controller.current === abort) controller.current = null;
        }
    }, []);

    const applyRender = useCallback((photo: RenderedPhoto & { crop: Rect }) => dispatch({ type: "rendered", photo }), []);
    const restore = useCallback((result: GeneratedPhoto) => dispatch({ type: "restore", result }), []);
    const applyRotation = useCallback((photo: Omit<GeneratedPhoto, "source">) => dispatch({ type: "rotated", photo }), []);

    return { ...state, run, cancel, reset: cancel, applyRender, restore, applyRotation };
}
