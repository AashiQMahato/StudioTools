import { type KeyboardEvent, useRef } from "react";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";
import { type Preset } from "./presets";

/** A tiny box in the preset's shape, so ratios compare at a glance. */
export function RatioSwatch({ width, height, active, circle }: { width: number; height: number; active?: boolean; circle?: boolean }) {
    const box = 26;
    const scale = box / Math.max(width, height);
    return (
        <span aria-hidden className="grid size-8 shrink-0 place-items-center">
            <span
                className={cn("block border-[1.5px] transition-colors duration-150", circle ? "rounded-full" : "rounded-[3px]", active ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-fg-quaternary")}
                style={{ width: Math.max(4, width * scale), height: Math.max(4, height * scale) }}
            />
        </span>
    );
}

const number = (value: number) => value.toLocaleString("en-US");

/**
 * The presets for one platform as radio cards. A swipeable strip on phones (canvas stays in view), a
 * grid in the side panel. Arrow keys move the selection, as in any radio group.
 */
export function PresetGallery({ presets, value, onChange, label }: { presets: readonly Preset[]; value: string; onChange: (preset: Preset) => void; label: string }) {
    const t = useT();
    const copy = t.socialResizer;
    const listRef = useRef<HTMLDivElement>(null);
    const index = presets.findIndex((preset) => preset.id === value);

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const next = presets[(Math.max(0, index) + step + presets.length) % presets.length];
        if (!next) return;
        onChange(next);
        const card = listRef.current?.querySelector<HTMLElement>(`[data-preset="${next.id}"]`);
        card?.focus();
        card?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };

    return (
        <div
            ref={listRef}
            role="radiogroup"
            aria-label={label}
            onKeyDown={onKeyDown}
            className="scrollbar-hide -mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 sm:-mx-5 sm:px-5 lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0"
        >
            {presets.map((preset, i) => {
                const selected = preset.id === value;
                const name = copy.labels[preset.label];
                return (
                    <button
                        key={preset.id}
                        type="button"
                        role="radio"
                        data-preset={preset.id}
                        aria-checked={selected}
                        aria-label={`${name}, ${copy.kinds[preset.kind]}, ${preset.ratio}, ${number(preset.width)} × ${number(preset.height)}`}
                        tabIndex={selected || (index < 0 && i === 0) ? 0 : -1}
                        onClick={() => onChange(preset)}
                        className={cn(
                            "flex min-h-11 w-40 shrink-0 cursor-pointer snap-start items-start gap-2.5 rounded-xl border p-2.5 text-left transition-[border-color,background-color,scale] duration-150 outline-focus-ring select-none focus-visible:outline-2 active:scale-[0.98] lg:w-auto",
                            selected ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--card-line)] bg-primary hover:border-fg-quaternary",
                        )}
                    >
                        <RatioSwatch width={preset.width} height={preset.height} active={selected} circle={preset.circle} />
                        <span className="min-w-0">
                            <span className={cn("block text-sm leading-snug font-semibold", selected ? "text-[var(--brand)]" : "text-primary")}>{name}</span>
                            <span className="mt-0.5 block text-xs text-tertiary">
                                {copy.kinds[preset.kind]} · {preset.ratio}
                            </span>
                            <span className="block text-xs text-tertiary tabular-nums">
                                {number(preset.width)} × {number(preset.height)}
                            </span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
