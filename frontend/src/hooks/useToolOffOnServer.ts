import { useEffect, useState } from "react";
import { getProcessorHealth } from "@/lib/api/processorsApi";
import type { AppErrorInfo } from "@/i18n";

/**
 * A tool switched off on this server (not merely starting up), as the error to show — checked once
 * when the tool opens, so it says so up front instead of failing after an upload. Null otherwise,
 * and while the check is pending or failed (the tool then reports it itself, if it comes to that).
 */
export function useToolOffOnServer(feature: "backgroundRemoval" | "photoGenerator"): AppErrorInfo | null {
    const [off, setOff] = useState<AppErrorInfo | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        getProcessorHealth(controller.signal)
            .then((health) => {
                const status = health[feature];
                if (status.disabled) setOff({ code: feature === "photoGenerator" ? "PHOTO_GENERATOR_DISABLED" : "BACKGROUND_REMOVAL_DISABLED", message: status.message ?? undefined });
            })
            .catch(() => undefined);
        return () => controller.abort();
    }, [feature]);
    return off;
}
