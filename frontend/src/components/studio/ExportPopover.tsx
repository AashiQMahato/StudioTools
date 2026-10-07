import { ChevronDown, Download } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { studioExportButton } from "./styles";
import { usePopover } from "./usePopover";

interface ExportPopoverProps {
    /** The button's label, e.g. "Export". */
    label: string;
    /** The popover's heading (and accessible name). */
    title: string;
    disabled?: boolean;
    /** Show the title above the choices (off when the choices bring their own heading). */
    heading?: boolean;
    /** The export choices; `close` folds the popover away (after a choice is made). */
    children: (close: () => void) => ReactNode;
}

/**
 * The top bar's Export button and the choices it opens, anchored to it. Every way out of a tool lives
 * here — not in a panel tab — so it's in the same place in every tool.
 */
export function ExportPopover({ label, title, disabled = false, heading = true, children }: ExportPopoverProps) {
    const { open, setOpen, wrap, trigger } = usePopover();
    return (
        <div ref={wrap} className="relative">
            <button ref={trigger} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog" disabled={disabled} className={studioExportButton}>
                <Download className="size-4" aria-hidden />
                <span className="sr-only sm:not-sr-only">{label}</span>
                <ChevronDown className={cn("size-4 opacity-70 transition-transform duration-200", open && "rotate-180")} aria-hidden />
            </button>
            {open && (
                <div role="dialog" aria-label={title} className="absolute top-full right-0 z-50 mt-2 max-h-[calc(100dvh-5rem)] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border border-[var(--card-line)] bg-primary p-4 shadow-xl">
                    {heading && <p className="mb-4 text-sm font-semibold text-primary">{title}</p>}
                    {children(() => setOpen(false))}
                </div>
            )}
        </div>
    );
}
