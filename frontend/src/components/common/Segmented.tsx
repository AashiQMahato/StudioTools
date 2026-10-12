import { type KeyboardEvent, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils/cn";

export interface SegmentedOption<T extends string | number> {
    value: T;
    label: ReactNode;
    /** Accessible name when the label is an icon or abbreviation. */
    ariaLabel?: string;
    disabled?: boolean;
    title?: string;
    /** Render as a link (navigation) instead of a choice. */
    href?: string;
}

interface SegmentedProps<T extends string | number> {
    options: ReadonlyArray<SegmentedOption<T>>;
    value: T;
    onChange?: (value: T) => void;
    label: string;
    /** "radio" for a setting, "tab" for switching panels, "nav" for page links. */
    kind?: "radio" | "tab" | "nav";
    size?: "sm" | "md";
    className?: string;
    /** Let the control scroll sideways when it doesn't fit. */
    scrollable?: boolean;
    /** Span the full width, segments sharing it equally, with squarer corners (panel tabs). */
    fill?: boolean;
}

/**
 * Apple-style segmented control: a translucent track with a raised thumb that glides (critically damped
 * spring) to the selected segment. Keyboard: arrow keys move between segments.
 */
export function Segmented<T extends string | number>({
    options,
    value,
    onChange,
    label,
    kind = "radio",
    size = "md",
    className,
    scrollable = false,
    fill = false,
}: SegmentedProps<T>) {
    const trackRef = useRef<HTMLDivElement>(null);
    const [thumb, setThumb] = useState<{ left: number; width: number; animate: boolean } | null>(null);
    const index = options.findIndex((option) => option.value === value);

    useLayoutEffect(() => {
        const track = trackRef.current;
        if (!track) return;
        const measure = (animate: boolean) => {
            const item = track.querySelectorAll<HTMLElement>("[data-segment]")[index];
            if (!item) return setThumb(null);
            setThumb((current) => ({ left: item.offsetLeft, width: item.offsetWidth, animate: animate && current !== null }));
            if (scrollable && animate) item.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
        };
        measure(true);
        const observer = new ResizeObserver(() => measure(false));
        observer.observe(track);
        return () => observer.disconnect();
    }, [index, scrollable, options.length]);

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (kind === "nav" || !onChange) return;
        const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        for (let i = 1; i <= options.length; i++) {
            const next = options[(index + step * i + options.length) % options.length];
            if (next && !next.disabled) {
                onChange(next.value);
                trackRef.current?.querySelectorAll<HTMLElement>("[data-segment]")[options.indexOf(next)]?.focus();
                break;
            }
        }
    };

    const height = size === "sm" ? "min-h-8 text-[0.8125rem]" : "min-h-9 text-sm";
    const role = kind === "tab" ? "tablist" : kind === "radio" ? "radiogroup" : undefined;

    const track = (
        <div
            ref={trackRef}
            role={role}
            aria-label={kind === "nav" ? undefined : label}
            onKeyDown={onKeyDown}
            className={cn(
                "relative isolate flex items-center bg-[var(--seg-track)] p-[3px]",
                fill ? "w-full rounded-xl" : "w-max rounded-full",
                scrollable && "scrollbar-hide max-w-full overflow-x-auto",
                className,
            )}
        >
            {thumb && (
                <span
                    aria-hidden
                    className={cn("absolute top-[3px] bottom-[3px] -z-10 bg-[var(--seg-thumb)] shadow-[var(--seg-thumb-shadow)]", fill ? "rounded-[0.625rem]" : "rounded-full", thumb.animate && "transition-[left,width] duration-500 ease-[var(--ease-spring)] motion-reduce:transition-none")}
                    style={{ left: thumb.left, width: thumb.width }}
                />
            )}
            {options.map((option, i) => {
                const selected = i === index;
                const itemClass = cn(
                    "relative flex cursor-pointer items-center justify-center gap-1.5 px-3.5 font-medium whitespace-nowrap tabular-nums transition-[color,opacity] duration-200 select-none",
                    "outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
                    "active:opacity-70 disabled:cursor-not-allowed disabled:opacity-35",
                    height,
                    fill ? "min-w-0 flex-1 rounded-[0.625rem] pointer-coarse:min-h-11" : "shrink-0 rounded-full",
                    selected ? "text-primary" : "text-tertiary hover:text-primary",
                );
                if (option.href) {
                    return (
                        <Link key={String(option.value)} data-segment to={option.href} aria-current={selected ? "page" : undefined} className={itemClass}>
                            {option.label}
                        </Link>
                    );
                }
                return (
                    <button
                        key={String(option.value)}
                        data-segment
                        type="button"
                        role={kind === "tab" ? "tab" : "radio"}
                        aria-selected={kind === "tab" ? selected : undefined}
                        aria-checked={kind === "radio" ? selected : undefined}
                        aria-label={option.ariaLabel}
                        title={option.title}
                        disabled={option.disabled}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onChange?.(option.value)}
                        className={itemClass}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );

    return kind === "nav" ? <nav aria-label={label}>{track}</nav> : track;
}
