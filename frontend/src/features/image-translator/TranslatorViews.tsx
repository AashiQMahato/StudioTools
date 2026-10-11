import { type ReactNode } from "react";
import type { Box } from "@/lib/api/ocrApi";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";
import { isStale, type TranslatorBlock } from "./blocks";

const percent = (value: number, total: number) => `${(value / total) * 100}%`;

/** The image with a box over each detected block. Hover or tap a box to find its text. */
export function BoxedImage({ src, alt, page, size, blocks, active, onActive, onPick }: {
    src: string;
    alt: string;
    page: { width: number; height: number };
    size: { width: number; height: number };
    blocks: readonly TranslatorBlock[];
    active: string | null;
    onActive: (id: string | null) => void;
    onPick: (id: string) => void;
}) {
    const copy = useT().translator;
    return (
        <figure className="animate-enter relative overflow-hidden rounded-lg [--i:-1]" style={size}>
            <img src={src} alt={alt} className="size-full object-contain" draggable={false} />
            {blocks.map((block, index) => (
                <button
                    key={block.id}
                    type="button"
                    // The text list is the keyboard path; the boxes are for pointing.
                    tabIndex={-1}
                    aria-label={copy.boxLabel(index + 1)}
                    onPointerEnter={() => onActive(block.id)}
                    onPointerLeave={() => onActive(null)}
                    onClick={() => onPick(block.id)}
                    style={place(block.bbox, page)}
                    className={cn(
                        "absolute cursor-pointer rounded-[3px] border transition-[background-color,border-color,box-shadow] duration-150 ease-out motion-reduce:transition-none",
                        active === block.id
                            ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_16%,transparent)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_25%,transparent)]"
                            : "border-[color-mix(in_srgb,var(--brand)_60%,transparent)] bg-[color-mix(in_srgb,var(--brand)_5%,transparent)]",
                    )}
                />
            ))}
        </figure>
    );
}

const place = (box: Box, page: { width: number; height: number }) => ({ left: percent(box.x, page.width), top: percent(box.y, page.height), width: percent(box.width, page.width), height: percent(box.height, page.height) });

/**
 * One row per block: its original text and, once there is one, its translation beside it (on phones,
 * whichever of the two `view` picks). Both are editable.
 */
export function BlockRows({ blocks, idPrefix, active, onActive, onEdit, showTranslation, view, targetCode }: {
    blocks: readonly TranslatorBlock[];
    idPrefix: string;
    active: string | null;
    onActive: (id: string | null) => void;
    onEdit: (id: string, field: "original" | "translated", text: string) => void;
    showTranslation: boolean;
    view: "original" | "translated";
    targetCode: string;
}) {
    const copy = useT().translator;
    return (
        <ol className="flex flex-col gap-2">
            {showTranslation && (
                <li aria-hidden className="hidden grid-cols-2 gap-2 px-2 text-xs font-semibold tracking-wide text-tertiary uppercase lg:grid">
                    <span>{copy.originalHeading}</span>
                    <span>{copy.translatedHeading}</span>
                </li>
            )}
            {blocks.map((block, index) => (
                <li
                    key={block.id}
                    onPointerEnter={() => onActive(block.id)}
                    onPointerLeave={() => onActive(null)}
                    onFocus={() => onActive(block.id)}
                    className={cn("grid gap-2 rounded-xl border p-2 transition-colors duration-150 motion-reduce:transition-none", showTranslation && "lg:grid-cols-2", active === block.id ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--card-line)]")}
                >
                    <Field id={`${idPrefix}-${block.id}-original`} label={copy.originalField(index + 1)} badge={index + 1} value={block.original} onChange={(text) => onEdit(block.id, "original", text)} className={cn(showTranslation && view === "translated" && "max-lg:hidden")} />
                    {showTranslation && (
                        <Field
                            id={`${idPrefix}-${block.id}-translated`}
                            label={copy.translatedField(index + 1)}
                            badge={index + 1}
                            value={block.translated ?? ""}
                            placeholder={copy.notTranslated}
                            lang={targetCode}
                            onChange={(text) => onEdit(block.id, "translated", text)}
                            className={cn(view === "original" && "max-lg:hidden")}
                        />
                    )}
                    {isStale(block) && <p className="text-xs text-warning-primary lg:col-span-2">{copy.stale}</p>}
                </li>
            ))}
        </ol>
    );
}

function Field({ id, label, badge, value, onChange, placeholder, lang, className }: { id: string; label: string; badge: number; value: string; onChange: (text: string) => void; placeholder?: string; lang?: string; className?: string }): ReactNode {
    return (
        <label htmlFor={id} className={cn("flex min-w-0 gap-2", className)}>
            <span aria-hidden className="mt-2 grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-[0.6875rem] font-semibold text-tertiary tabular-nums">
                {badge}
            </span>
            <span className="sr-only">{label}</span>
            <textarea
                id={id}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                lang={lang}
                dir="auto"
                rows={Math.min(8, Math.max(1, value.split("\n").length))}
                spellCheck={false}
                className="field-sizing-content min-h-11 w-full min-w-0 resize-y rounded-lg border border-transparent bg-primary px-2.5 py-2 text-md leading-relaxed text-primary outline-focus-ring placeholder:text-quaternary hover:border-[var(--card-line)] focus-visible:border-[var(--card-line)] focus-visible:outline-2 lg:text-sm"
            />
        </label>
    );
}
