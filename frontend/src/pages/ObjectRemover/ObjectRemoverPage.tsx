import { ToolUnavailable } from "@/components/studio/ToolUnavailable";
import { useToolOffOnServer } from "@/hooks/useToolOffOnServer";
import { RetouchPage } from "@/pages/Retouch/RetouchPage";

/**
 * Object Remover: the retouch studio fixed to "remove", filled by LaMa AI inpainting only. When this
 * server has no AI inpainting (no model, no IOPaint), it says so up front instead of offering a weaker fill.
 */
export function ObjectRemoverPage() {
    const off = useToolOffOnServer("objectRemoval");
    return off ? <ToolUnavailable tool="objectRemover" error={off} /> : <RetouchPage variant="objectRemover" />;
}
