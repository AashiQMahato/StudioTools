import type { ToolKey } from "@/lib/constants/navigation";
import { type AppErrorInfo, errorMessage, useT } from "@/i18n";
import { StudioShell } from "./StudioShell";
import { StudioCanvas, StudioError } from "./StudioParts";

/** A tool this server doesn't offer: the studio frame, saying so plainly — no upload, no "try again". */
export function ToolUnavailable({ tool, error }: { tool: ToolKey; error: AppErrorInfo }) {
    const t = useT();
    return (
        <StudioShell tool={tool} panel={null} panelLabel={t.nav.toolItems[tool].title} hasWork={false}>
            <StudioCanvas>
                <StudioError title={t.studio.unavailableTitle} message={errorMessage(t, error)} />
            </StudioCanvas>
        </StudioShell>
    );
}
