import { apiClient } from "./apiClient";

export interface ProcessorHealth {
    /** `disabled`: switched off on this server (not just starting up); `message` says so. */
    backgroundRemoval: { available: boolean; status: string; disabled?: boolean; message?: string | null };
    photoGenerator: { available: boolean; disabled?: boolean; message?: string | null };
    /** AI inpainting (LaMa) for the object remover; `disabled`: no model or service on this server. */
    objectRemoval: { available: boolean; engine: string | null; disabled?: boolean; message?: string | null };
    upscaling: { available: boolean; status: string; message: string | null; scales: number[] };
    /** High quality (PowerPaint) for Object Remover and AI Retouch: whether this server can run it, or why not. */
    retouch?: { available: boolean; premium?: { available: boolean; blocker: "not-installed" | "off" | "low-memory" | null } };
    limits: { maxFileSizeMb: number; formats: string[] };
}

export function getProcessorHealth(signal?: AbortSignal): Promise<ProcessorHealth> {
    return apiClient.get<ProcessorHealth>("/health/processors", { signal });
}
