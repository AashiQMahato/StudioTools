import { Redo2, SlidersHorizontal, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";
import { RETOUCH_TOOLS, type RetouchTool, TOOL_ICONS, toolLabels } from "./modes";

interface RetouchToolbarProps {
    tool: RetouchTool;
    onToolChange: (tool: RetouchTool) => void;
    paintable: boolean;
    canUndo: boolean;
    canRedo: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onOpenSettings: () => void;
    /** The primary action (Retouch, or Keep while a result waits). */
    action: ReactNode;
    /** Which tools to offer (retouch: brush, eraser, move). */
    tools?: readonly RetouchTool[];
    /** Extra buttons before undo/redo (e.g. the watermark remover's Auto detect). */
    extra?: ReactNode;
}

/** Phones and tablets: the tools in one row under the image, thumb-reachable, with the main action at the end. */
export function RetouchToolbar({ tool, onToolChange, paintable, canUndo, canRedo, onUndo, onRedo, onOpenSettings, action, tools = RETOUCH_TOOLS, extra }: RetouchToolbarProps) {
    const t = useT();
    const copy = t.retouch;
    // Tools keep their names (they're the choice that matters); history and settings are icon-only, so the
    // row breathes. The main action gets a row of its own, full width, under the thumb.
    const tool_ =
        "flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[0.6875rem] font-medium transition-colors duration-150 outline-focus-ring focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-35 min-h-12";
    const icon =
        "grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl text-tertiary transition-colors duration-150 outline-focus-ring hover:bg-secondary hover:text-primary focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-35";
    const labels = toolLabels(t);

    return (
        <div className="flex flex-col gap-2 lg:hidden">
            <div role="toolbar" aria-label={copy.tools} className="flex items-center gap-1 rounded-2xl border border-[var(--card-line)] bg-primary p-1">
                <div className="flex min-w-0 flex-1 items-center gap-0.5">
                    {tools.map((id) => {
                        const Icon = TOOL_ICONS[id];
                        const selected = tool === id;
                        return (
                            <button
                                key={id}
                                type="button"
                                aria-pressed={selected}
                                disabled={!paintable && id !== "move"}
                                onClick={() => onToolChange(id)}
                                className={cn(tool_, selected ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-tertiary hover:text-primary")}
                            >
                                <Icon className="size-[1.125rem]" aria-hidden />
                                <span className="truncate">{labels[id].short}</span>
                            </button>
                        );
                    })}
                    {extra}
                </div>
                <span aria-hidden className="h-7 w-px shrink-0 bg-[var(--card-line)]" />
                <div className="flex shrink-0 items-center">
                    <button type="button" className={icon} onClick={onUndo} disabled={!canUndo} aria-label={copy.undo} title={copy.undo}>
                        <Undo2 className="size-5" aria-hidden />
                    </button>
                    <button type="button" className={icon} onClick={onRedo} disabled={!canRedo} aria-label={copy.redo} title={copy.redo}>
                        <Redo2 className="size-5" aria-hidden />
                    </button>
                    <button type="button" className={icon} onClick={onOpenSettings} aria-haspopup="dialog" aria-label={copy.settings} title={copy.settings}>
                        <SlidersHorizontal className="size-5" aria-hidden />
                    </button>
                </div>
            </div>
            <div className="[&>*]:w-full">{action}</div>
        </div>
    );
}
