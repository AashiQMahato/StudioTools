import { apiClient } from "./apiClient";

export interface ProcessorHealth {
    /** `disabled`: switched off on this server (not just starting up); `message` says so. */
    backgroundRemoval: { available: boolean; status: string; disabled?: boolean; message?: string | null };
    photoGenerator: { available: boolean; disabled?: boolean; message?: string | null };
    upscaling: { available: boolean; status: string; message: string | null; scales: number[] };
    limits: { maxFileSizeMb: number; formats: string[] };
}

export function getProcessorHealth(signal?: AbortSignal): Promise<ProcessorHealth> {
    return apiClient.get<ProcessorHealth>("/health/processors", { signal });
}
