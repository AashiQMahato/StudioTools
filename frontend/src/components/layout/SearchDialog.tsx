import { ArrowRight, Search, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useToolSearch } from "@/store/useToolSearch";
import { searchTools } from "@/lib/utils/searchTools";
import { ROUTES } from "@/lib/constants/routes";
import { useT } from "@/i18n";
import { popularTools, TOOL_REGISTRY, type ToolEntry, toolCopy } from "./toolRegistry";

/**
 * Tool search: a modal over the page (native <dialog>: focus is trapped, Escape closes, focus returns to
 * what opened it). ⌘K / Ctrl+K toggles it. Searches the registry's names, descriptions and keywords, in
 * the page's language, with no server.
 */
export function SearchDialog() {
    const t = useT();
    const copy = t.nav.mega.search;
    const navigate = useNavigate();
    const open = useToolSearch((state) => state.open);
    const setOpen = useToolSearch((state) => state.setOpen);
    const dialog = useRef<HTMLDialogElement>(null);
    const [query, setQuery] = useState("");

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        if (open && !element.open) element.showModal();
        if (!open && element.open) element.close();
    }, [open]);

    useEffect(() => {
        const onKeyDown = (event: globalThis.KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                setOpen(!useToolSearch.getState().open);
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [setOpen]);

    const items = useMemo(() => TOOL_REGISTRY.map((tool) => {
            const { title, description } = toolCopy(t, tool);
            return { tool, name: title, description, keywords: tool.keywords };
        }), [t]);
    const trimmed = query.trim();
    const results: ToolEntry[] = trimmed ? searchTools(items, trimmed).map((item) => item.tool) : popularTools();

    const close = () => {
        setOpen(false);
        setQuery("");
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
        const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-search-input], [data-search-result]"));
        const index = rows.indexOf(document.activeElement as HTMLElement);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            rows[(index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length]?.focus();
        } else if (event.key === "Enter" && index === 0 && results[0]) {
            event.preventDefault();
            navigate({ pathname: results[0].route, search: results[0].search });
            close();
        }
    };

    return (
        <dialog
            ref={dialog}
            aria-label={copy.title}
            onClose={close}
            onKeyDown={onKeyDown}
            // A press on the backdrop (the dialog element itself, outside its panel) closes it.
            onClick={(event) => event.target === event.currentTarget && close()}
            className="fixed inset-x-0 top-[10vh] m-0 mx-auto w-[min(36rem,calc(100vw-1.5rem))] rounded-2xl border border-secondary bg-primary p-0 text-primary shadow-xl backdrop:bg-overlay/30"
        >
            <div className="flex items-center gap-3 border-b border-secondary px-4">
                <Search className="size-4.5 shrink-0 text-quaternary" aria-hidden />
                <input
                    data-search-input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={copy.placeholder}
                    aria-label={copy.label}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-14 min-w-0 flex-1 bg-transparent text-md text-primary outline-none placeholder:text-quaternary"
                />
                <button type="button" onClick={close} aria-label={copy.close} className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-tertiary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 pointer-coarse:size-11">
                    <X className="size-4" aria-hidden />
                </button>
            </div>

            <div className="max-h-[min(26rem,60dvh)] overflow-y-auto p-2">
                <p aria-live="polite" className="px-3 pt-1.5 pb-2 text-label text-quaternary">
                    {trimmed ? (results.length ? copy.count(results.length) : "") : copy.suggested}
                </p>
                {results.length > 0 ? (
                    <ul>
                        {results.map((tool) => {
                            const Icon = tool.icon;
                            const { title, description } = toolCopy(t, tool);
                            return (
                                <li key={tool.id}>
                                    <Link
                                        to={{ pathname: tool.route, search: tool.search }}
                                        data-search-result
                                        onClick={close}
                                        className="flex items-center gap-3 rounded-xl px-3 py-2.5 outline-focus-ring transition-colors duration-150 hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-2"
                                    >
                                        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-secondary bg-primary text-secondary">
                                            <Icon className="size-4" strokeWidth={1.9} aria-hidden />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-semibold text-primary">{title}</span>
                                            <span className="block truncate text-xs text-tertiary">{description}</span>
                                        </span>
                                        <ArrowRight className="size-4 shrink-0 text-quaternary" aria-hidden />
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <div className="px-3 py-8 text-center">
                        <p className="text-sm font-semibold text-primary">{copy.empty(trimmed)}</p>
                        <p className="mt-1 text-xs text-tertiary">{copy.emptyHint}</p>
                        <Link to={ROUTES.imageTools} onClick={close} data-search-result className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-[var(--brand)] outline-focus-ring hover:bg-primary_hover focus-visible:outline-2">
                            {copy.browse}
                            <ArrowRight className="size-4" aria-hidden />
                        </Link>
                    </div>
                )}
            </div>
            <p className="hidden border-t border-secondary px-4 py-2 text-xs text-quaternary sm:block">{copy.keys}</p>
        </dialog>
    );
}
