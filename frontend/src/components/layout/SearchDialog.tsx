import { ArrowRight, CornerDownLeft, Search, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useToolSearch } from "@/store/useToolSearch";
import { matchRanges, searchTools } from "@/lib/utils/searchTools";
import { ROUTES } from "@/lib/constants/routes";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";
import { buildSearchIndex, type SearchEntry, suggestedEntries } from "./searchIndex";

/** The query's words, marked in a result's text. */
function Highlight({ text, query }: { text: string; query: string }) {
    const ranges = query ? matchRanges(text, query) : [];
    if (ranges.length === 0) return <>{text}</>;
    const parts: ReactNode[] = [];
    let at = 0;
    for (const [start, end] of ranges) {
        if (start > at) parts.push(text.slice(at, start));
        parts.push(
            <mark key={start} className="rounded-[3px] bg-[var(--brand-soft)] text-inherit">
                {text.slice(start, end)}
            </mark>,
        );
        at = end;
    }
    parts.push(text.slice(at));
    return <>{parts}</>;
}

function Key({ children }: { children: ReactNode }) {
    return <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-[5px] border border-secondary bg-secondary px-1 font-sans text-[0.6875rem] leading-none font-medium text-tertiary">{children}</kbd>;
}

/**
 * Tool search: a compact command palette over the page (native <dialog>: focus is trapped, Escape
 * closes, focus returns to what opened it). ⌘K / Ctrl+K toggles it. The input is a combobox — arrow
 * keys move through the results, Enter opens one — over every tool in the navbar's menus and the
 * Whiteboard, in the page's language, with no server.
 */
export function SearchDialog() {
    const t = useT();
    const copy = t.nav.mega.search;
    const navigate = useNavigate();
    const open = useToolSearch((state) => state.open);
    const setOpen = useToolSearch((state) => state.setOpen);
    const dialog = useRef<HTMLDialogElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const list = useRef<HTMLUListElement>(null);
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const listId = useId();

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        if (open && !element.open) {
            element.showModal();
            input.current?.focus();
        }
        if (!open && element.open) element.close();
    }, [open]);

    useEffect(() => {
        const onKeyDown = (event: globalThis.KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
                event.preventDefault();
                setOpen(!useToolSearch.getState().open);
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [setOpen]);

    const index = useMemo(() => buildSearchIndex(t), [t]);
    const searchable = useMemo(() => index.map((entry) => ({ ...entry, name: entry.title })), [index]);
    const trimmed = query.trim();
    const results: SearchEntry[] = useMemo(() => (trimmed ? searchTools(searchable, trimmed) : suggestedEntries(index)), [trimmed, searchable, index]);
    const current = Math.min(active, Math.max(results.length - 1, 0));

    // Keep the highlighted row in view as the arrow keys move it.
    useEffect(() => {
        list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
    }, [current]);

    const close = () => {
        setOpen(false);
        setQuery("");
        setActive(0);
    };
    const go = (entry: SearchEntry) => {
        navigate({ pathname: entry.route, search: entry.search });
        close();
    };
    const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (results.length) setActive((current + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
        } else if (event.key === "Home" && results.length && !query) {
            setActive(0);
        } else if (event.key === "Enter" && results[current]) {
            event.preventDefault();
            go(results[current]);
        }
    };

    const optionId = (position: number) => `${listId}-option-${position}`;

    return (
        <dialog
            ref={dialog}
            aria-label={copy.title}
            onClose={close}
            // A press on the backdrop (the dialog element itself, outside its panel) closes it.
            onClick={(event) => event.target === event.currentTarget && close()}
            className={cn(
                "search-palette fixed inset-x-0 top-2 m-0 mx-auto flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl border border-secondary bg-primary p-0 text-primary shadow-xl backdrop:bg-overlay/30",
                "sm:top-[12vh] sm:max-h-[min(34rem,76dvh)] sm:w-[min(38rem,calc(100vw-2rem))] [&:not([open])]:hidden",
            )}
        >
            <div className="flex shrink-0 items-center gap-2.5 border-b border-secondary pr-2 pl-4">
                <Search className="size-[1.125rem] shrink-0 text-quaternary" aria-hidden />
                <input
                    ref={input}
                    value={query}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setActive(0);
                    }}
                    onKeyDown={onInputKey}
                    placeholder={copy.placeholder}
                    aria-label={copy.label}
                    role="combobox"
                    aria-expanded={results.length > 0}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-activedescendant={results.length ? optionId(current) : undefined}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="go"
                    className="h-14 min-w-0 flex-1 bg-transparent text-md text-primary outline-none placeholder:text-quaternary"
                />
                {query && (
                    <button
                        type="button"
                        onClick={() => {
                            setQuery("");
                            input.current?.focus();
                        }}
                        className="h-8 shrink-0 cursor-pointer rounded-lg px-2 text-xs font-medium text-tertiary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2"
                    >
                        {copy.clear}
                    </button>
                )}
                <button type="button" onClick={close} aria-label={copy.close} className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-tertiary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 pointer-coarse:size-11">
                    <X className="size-4" aria-hidden />
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
                <p aria-live="polite" className="px-2.5 pt-1.5 pb-1.5 text-xs font-medium text-quaternary">
                    {trimmed ? (results.length ? copy.count(results.length) : "") : copy.suggested}
                </p>
                {results.length > 0 ? (
                    <ul ref={list} id={listId} role="listbox" aria-label={trimmed ? copy.count(results.length) : copy.suggested}>
                        {results.map((entry, position) => {
                            const Icon = entry.icon;
                            const selected = position === current;
                            return (
                                <li
                                    key={entry.id}
                                    id={optionId(position)}
                                    role="option"
                                    aria-selected={selected}
                                    data-index={position}
                                    onPointerMove={() => position !== current && setActive(position)}
                                    // Keep focus in the input: the row is chosen with a press, not focused.
                                    onPointerDown={(event) => event.preventDefault()}
                                    onClick={() => go(entry)}
                                    className={cn("flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors duration-100", selected && "bg-secondary")}
                                >
                                    <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg border bg-primary transition-colors duration-100", selected ? "border-[var(--brand-line)] text-[var(--brand)]" : "border-secondary text-secondary")}>
                                        <Icon className="size-4" strokeWidth={1.9} aria-hidden />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-semibold text-primary">
                                            <Highlight text={entry.title} query={trimmed} />
                                        </span>
                                        <span className="block truncate text-xs text-tertiary">
                                            <Highlight text={entry.description} query={trimmed} />
                                        </span>
                                    </span>
                                    <span className="hidden shrink-0 rounded-md border border-secondary px-1.5 py-0.5 text-[0.6875rem] font-medium whitespace-nowrap text-tertiary sm:inline">{entry.category}</span>
                                    <CornerDownLeft className={cn("size-4 shrink-0 text-quaternary transition-opacity duration-100", selected ? "opacity-100" : "opacity-0")} aria-hidden />
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <div className="px-3 py-8 text-center">
                        <p className="text-sm font-semibold text-primary">{copy.empty(trimmed)}</p>
                        <p className="mt-1 text-xs text-tertiary">{copy.emptyHint}</p>
                        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                            {copy.tryWords.map((word) => (
                                <button
                                    key={word}
                                    type="button"
                                    onClick={() => {
                                        setQuery(word);
                                        setActive(0);
                                        input.current?.focus();
                                    }}
                                    className="h-8 cursor-pointer rounded-full border border-secondary px-3 text-xs font-medium text-secondary outline-focus-ring transition-colors duration-150 hover:bg-primary_hover hover:text-primary focus-visible:outline-2"
                                >
                                    {word}
                                </button>
                            ))}
                        </div>
                        <Link to={ROUTES.imageTools} onClick={close} className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-[var(--brand)] outline-focus-ring hover:bg-primary_hover focus-visible:outline-2">
                            {copy.browse}
                            <ArrowRight className="size-4" aria-hidden />
                        </Link>
                    </div>
                )}
            </div>
            <div className="hidden shrink-0 items-center gap-4 border-t border-secondary px-4 py-2.5 text-xs text-quaternary sm:flex">
                <span className="flex items-center gap-1.5">
                    <Key>↑</Key>
                    <Key>↓</Key>
                    {copy.keysMove}
                </span>
                <span className="flex items-center gap-1.5">
                    <Key>↵</Key>
                    {copy.keysOpen}
                </span>
                <span className="flex items-center gap-1.5">
                    <Key>esc</Key>
                    {copy.keysClose}
                </span>
            </div>
        </dialog>
    );
}
