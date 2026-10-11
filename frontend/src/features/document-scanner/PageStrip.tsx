import { AlertCircle, GripVertical, LoaderCircle, Plus } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useSortable } from "@/features/documents/useSortable";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";
import type { ScanPage } from "./useScanPages";

/**
 * The pages in order, as thumbnails. Click to edit one; drag (or Alt+arrows) to reorder; on touch
 * screens, drag by the grip so the strip still scrolls. The last tile adds more.
 */
export function PageStrip({ pages, selected, onSelect, onReorder, onAdd }: { pages: ScanPage[]; selected: string | null; onSelect: (id: string) => void; onReorder: (pages: ScanPage[]) => void; onAdd: () => void }) {
    const t = useT();
    const copy = t.scanner;
    const { attachContainer, attachGhost, drag, itemProps } = useSortable({ items: pages, getId: (page) => page.id, onReorder });
    const dragged = drag ? pages.find((page) => page.id === drag.id) : undefined;

    const thumb = (page: ScanPage, index: number) => (
        <>
            <span className="relative grid h-24 w-[4.5rem] place-items-center overflow-hidden rounded-lg bg-secondary pointer-coarse:h-28 pointer-coarse:w-20">
                <img src={page.result?.url ?? page.source} alt="" draggable={false} className="size-full object-contain" />
                {(page.status === "detecting" || page.status === "rendering") && (
                    <span className="absolute inset-0 grid place-items-center bg-primary/60">
                        <LoaderCircle className="size-5 animate-spin text-[var(--brand)] motion-reduce:animate-none" aria-hidden />
                    </span>
                )}
                {page.status === "failed" && (
                    <span className="absolute inset-0 grid place-items-center bg-primary/70">
                        <AlertCircle className="size-5 text-error-primary" aria-hidden />
                    </span>
                )}
                <span className="absolute top-1 left-1 grid min-w-5 place-items-center rounded bg-neutral-950/65 px-1 text-[0.6875rem] font-semibold text-white tabular-nums">{index + 1}</span>
            </span>
            <span data-drag-handle aria-hidden className="absolute right-1 bottom-1 grid size-7 cursor-grab touch-none place-items-center rounded-md bg-primary/90 text-quaternary pointer-fine:hidden">
                <GripVertical className="size-4" />
            </span>
        </>
    );

    return (
        <div className="flex flex-col gap-1.5">
            <p className="text-xs text-tertiary">{copy.stripHint}</p>
            <div className="flex gap-2 overflow-x-auto overscroll-x-contain pb-1">
                <ol ref={attachContainer} aria-label={copy.pagesLabel} className="flex gap-2">
                    {pages.map((page, index) => {
                        const props = itemProps(page.id);
                        const label = `${copy.pageN(index + 1)}: ${copy.statuses[page.status]}`;
                        return (
                            <li
                                key={page.id}
                                {...props}
                                tabIndex={0}
                                aria-label={label}
                                aria-current={page.id === selected ? "true" : undefined}
                                title={page.name}
                                onClick={() => onSelect(page.id)}
                                onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        onSelect(page.id);
                                    } else props.onKeyDown(event);
                                }}
                                className={cn(
                                    "relative shrink-0 cursor-pointer rounded-xl border-2 p-1 outline-focus-ring transition-[border-color,opacity] duration-150 select-none focus-visible:outline-2 data-dragging:opacity-30",
                                    page.id === selected ? "border-[var(--brand)]" : "border-transparent hover:border-[var(--card-line)]",
                                )}
                            >
                                {thumb(page, index)}
                            </li>
                        );
                    })}
                </ol>
                <button
                    type="button"
                    onClick={onAdd}
                    className="grid h-[6.5rem] w-[4.5rem] shrink-0 cursor-pointer place-items-center content-center gap-1 rounded-xl border-2 border-dashed border-[var(--card-line)] text-xs font-medium text-tertiary outline-focus-ring hover:border-[var(--brand)] hover:text-[var(--brand)] focus-visible:outline-2 pointer-coarse:h-[7.5rem] pointer-coarse:w-20"
                >
                    <Plus className="size-5" aria-hidden />
                    {copy.addPage}
                </button>
            </div>
            {dragged && drag && (
                <div ref={attachGhost} aria-hidden className="pointer-events-none fixed top-0 left-0 z-50 rounded-xl border-2 border-[var(--brand)] bg-primary p-1 shadow-xl">
                    {thumb(dragged, pages.indexOf(dragged))}
                </div>
            )}
        </div>
    );
}
