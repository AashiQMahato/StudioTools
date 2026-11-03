import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * A panel as a sheet rising from the bottom (phones and tablets). Stays mounted so it can slide both
 * ways; while closed it's inert. Escape, the backdrop or the close button dismiss it.
 */
export function BottomSheet({ open, onClose, title, closeLabel, children, className }: { open: boolean; onClose: () => void; title: string; closeLabel: string; children: ReactNode; className?: string }) {
    const panelRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const returnTo = document.activeElement as HTMLElement | null;
        panelRef.current?.focus();
        const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("keydown", onKey);
            returnTo?.focus?.();
        };
    }, [open, onClose]);

    return (
        <div className={cn("fixed inset-0 z-40 lg:hidden", !open && "pointer-events-none", className)} inert={!open}>
            <div aria-hidden onClick={onClose} className={cn("absolute inset-0 bg-[rgb(17_19_24/0.3)] transition-opacity duration-300", open ? "opacity-100" : "opacity-0")} />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                tabIndex={-1}
                className={cn(
                    "glass-strong absolute inset-x-0 bottom-0 flex max-h-[78svh] flex-col rounded-t-[1.75rem] pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none transition-transform duration-300 ease-[var(--ease-out)] motion-reduce:transition-none",
                    open ? "translate-y-0" : "translate-y-full",
                )}
            >
                <div className="flex shrink-0 items-center justify-between px-4 pt-2 pb-1">
                    <span aria-hidden className="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-[var(--card-line)]" />
                    <h2 className="pt-3 text-sm font-semibold text-primary">{title}</h2>
                    <button type="button" onClick={onClose} className="mt-2 h-9 cursor-pointer rounded-lg px-3 text-sm font-medium text-[var(--brand)] outline-focus-ring hover:bg-secondary focus-visible:outline-2 pointer-coarse:h-11">
                        {closeLabel}
                    </button>
                </div>
                <div className="flex min-h-0 flex-col gap-6 overflow-y-auto overscroll-contain px-4 pt-2 pb-6">{children}</div>
            </div>
        </div>
    );
}
