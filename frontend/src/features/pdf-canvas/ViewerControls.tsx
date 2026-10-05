import { ChevronLeft, ChevronRight, type LucideIcon, SlidersHorizontal, ZoomIn, ZoomOut } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";
import { type useZoom, ZOOM_STEPS } from "./useZoom";

const toolbarButton =
    "grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-secondary transition-colors duration-150 outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-35 aria-pressed:bg-[var(--brand-soft)] aria-pressed:text-[var(--brand)] pointer-coarse:size-11";

export function ToolbarButton({ icon: Icon, label, onClick, disabled, pressed, shortcut, className }: { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; shortcut?: string; className?: string }) {
    return (
        <button type="button" className={cn(toolbarButton, className)} onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={pressed} aria-keyshortcuts={shortcut} title={shortcut ? `${label} (${shortcut})` : label}>
            <Icon className="size-[1.125rem]" aria-hidden />
        </button>
    );
}

export const ToolbarDivider = () => <span aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-[var(--card-line)]" />;

export function Toolbar({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
    return (
        <div role="toolbar" aria-label={label} className={cn("flex shrink-0 items-center gap-0.5 overflow-x-auto rounded-xl border border-[var(--card-line)] bg-primary p-1 [scrollbar-width:none]", className)}>
            {children}
        </div>
    );
}

/**
 * Phones and tablets: pages and zoom at the bottom, under the thumb, and a button for the panel (which
 * opens as a sheet). Wide screens have these in the top toolbar and the side panel.
 */
export function MobileBar({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div role="toolbar" aria-label={label} className="flex shrink-0 items-center justify-between gap-1 overflow-x-auto rounded-xl border border-[var(--card-line)] bg-primary p-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] [scrollbar-width:none] lg:hidden">
            {children}
        </div>
    );
}

/** Opens the tool's panel as a sheet (phones and tablets). */
export function PanelButton({ label, onClick, badge }: { label: string; onClick: () => void; badge?: boolean }) {
    return (
        <button type="button" onClick={onClick} aria-label={label} title={label} className="relative flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-secondary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 sm:px-3 pointer-coarse:h-11">
            <SlidersHorizontal className="size-4" aria-hidden />
            <span className="hidden sm:inline">{label}</span>
            {badge && <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-[var(--brand)]" />}
        </button>
    );
}

/** Zoom out / the zoom (fit or a percentage) / zoom in. */
export function ZoomControl({ zoom, compact = false }: { zoom: ReturnType<typeof useZoom>; compact?: boolean }) {
    const t = useT();
    const copy = t.documents.viewer;
    const id = useId();
    const value = zoom.mode === "custom" ? "custom" : zoom.mode;
    return (
        <div className="flex shrink-0 items-center">
            <ToolbarButton icon={ZoomOut} label={copy.zoomOut} onClick={zoom.zoomOut} disabled={!zoom.canZoomOut} shortcut="Control+-" className={cn(compact && "hidden sm:grid")} />
            <label htmlFor={id} className="sr-only">
                {copy.zoom}
            </label>
            <select
                id={id}
                value={value}
                onChange={(event) => {
                    const chosen = event.target.value;
                    if (chosen === "width" || chosen === "page") zoom.fit(chosen);
                    else if (chosen !== "custom") zoom.choose(Number(chosen));
                }}
                className="h-9 min-w-[5.5rem] cursor-pointer rounded-lg border border-transparent bg-transparent px-2 text-center text-sm font-medium text-primary tabular-nums outline-focus-ring hover:bg-primary_hover focus-visible:outline-2 pointer-coarse:h-11"
            >
                <option value="custom" hidden>
                    {zoom.percent}%
                </option>
                <option value="width">{copy.fitWidth}</option>
                <option value="page">{copy.fitPage}</option>
                {ZOOM_STEPS.map((step) => (
                    <option key={step} value={step}>
                        {step}%
                    </option>
                ))}
            </select>
            <ToolbarButton icon={ZoomIn} label={copy.zoomIn} onClick={zoom.zoomIn} disabled={!zoom.canZoomIn} shortcut="Control+=" className={cn(compact && "hidden sm:grid")} />
        </div>
    );
}

/** Previous / page number (type to jump) / next. */
export function PageNav({ current, count, onGo }: { current: number; count: number; onGo: (page: number) => void }) {
    const t = useT();
    const copy = t.documents.viewer;
    // What's being typed, for the page it was typed on — scrolling to another page shows that page's number.
    const [typed, setTyped] = useState<{ page: number; value: string } | null>(null);
    const draft = typed?.page === current ? typed.value : null;
    const setDraft = (value: string | null) => setTyped(value === null ? null : { page: current, value });
    const commit = () => {
        const page = Number.parseInt(draft ?? "", 10);
        if (Number.isFinite(page)) onGo(Math.min(count, Math.max(1, page)));
        setDraft(null);
    };
    return (
        <div className="flex shrink-0 items-center">
            <ToolbarButton icon={ChevronLeft} label={copy.previousPage} onClick={() => onGo(current - 1)} disabled={current <= 1} />
            <input
                type="text"
                inputMode="numeric"
                value={draft ?? String(current)}
                aria-label={copy.pageNumber(count)}
                onFocus={(event) => event.target.select()}
                onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ""))}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        commit();
                    } else if (event.key === "Escape") setDraft(null);
                }}
                className="h-8 w-11 rounded-md border border-[var(--card-line)] bg-primary text-center text-sm text-primary tabular-nums outline-focus-ring focus-visible:outline-2 pointer-coarse:h-10"
            />
            <span className="px-1.5 text-sm whitespace-nowrap text-tertiary tabular-nums">/ {count}</span>
            <ToolbarButton icon={ChevronRight} label={copy.nextPage} onClick={() => onGo(current + 1)} disabled={current >= count} />
        </div>
    );
}
