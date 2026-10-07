import { useEffect, useState } from "react";
import { SEPARATE_AI_SERVER } from "@/lib/api/apiClient";
import { getProcessorHealth } from "@/lib/api/processorsApi";
import type { AppErrorInfo } from "@/i18n";

/**
 * A tool switched off on this server (not merely starting up), as the error to show — checked once
 * when the tool opens, so it says so up front instead of failing after an upload. Null otherwise,
 * and while the check is pending or failed (the tool then reports it itself, if it comes to that).
 */
export function useToolOffOnServer(feature: "backgroundRemoval" | "photoGenerator" | "upscaling"): AppErrorInfo | null {
    const [off, setOff] = useState<AppErrorInfo | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        getProcessorHealth(controller.signal)
            .then((health) => {
                const status: { disabled?: boolean; message?: string | null } = health[feature];
                if (status.disabled) setOff({ code: feature === "photoGenerator" ? "PHOTO_GENERATOR_DISABLED" : "BACKGROUND_REMOVAL_DISABLED", message: status.message ?? undefined });
            })
            // Run on its own server (the Mac) that can't be reached: offline, so say so up front.
            .catch(() => !controller.signal.aborted && SEPARATE_AI_SERVER && setOff({ code: "AI_SERVER_OFFLINE" }));
        return () => controller.abort();
    }, [feature]);
    return off;
}
