import { ArrowRight, Search } from "lucide-react";
import type { CSSProperties, KeyboardEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { ROUTES } from "@/lib/constants/routes";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";
import type { NavPanelProps } from "./NavDropdown";
import { useToolSearch } from "@/store/useToolSearch";
import { aiStudioTools, groupTools, NAV_GROUPS, popularTools, TOOL_ACCENT, type ToolEntry, toolCopy } from "./toolRegistry";

const linkRing = "outline-focus-ring focus-visible:outline-2";

function ToolLink({ tool, onNavigate, children, className }: { tool: ToolEntry; onNavigate: () => void; children: React.ReactNode; className?: string }) {
    const { pathname } = useLocation();
    const current = pathname === tool.route && !tool.search;
    return (
        <Link
            to={{ pathname: tool.route, search: tool.search }}
            data-nav-item
            onClick={onNavigate}
            aria-current={current ? "page" : undefined}
            // The tool's own colour, picked up by its icon on hover, focus and when it's the current page.
            style={{ "--accent": TOOL_ACCENT[tool.id] ?? "var(--brand)" } as CSSProperties}
            className={cn("group transition-colors duration-150", linkRing, current ? "bg-secondary" : "hover:bg-secondary", className)}
        >
            {children}
        </Link>
    );
}

const ToolIcon = ({ tool, size = "sm" }: { tool: ToolEntry; size?: "sm" | "md" }) => (
    <span
        className={cn(
            "nav-tool-icon grid shrink-0 place-items-center rounded-lg border border-transparent bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)] transition-colors duration-150",
            // Hover, focus and the current page deepen the tint.
            "group-hover:bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] group-focus-visible:bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] group-aria-[current=page]:bg-[color-mix(in_srgb,var(--accent)_22%,transparent)]",
            size === "md" ? "size-9" : "size-8",
        )}
    >
        <tool.icon className="size-4" strokeWidth={1.9} aria-hidden />
    </span>
);

/** Tools: shortcuts and a search field on top, then one column per kind of tool. */
export function ToolsMegaMenu({ id, open, panelRef, onNavigate, onKeyDown }: NavPanelProps) {
    const t = useT();
    const copy = t.nav.mega;
    const openSearch = useToolSearch((state) => state.setOpen);

    // ↑ ↓ Home End move through every entry (the dropdown's own handling); ← → jump between columns.
    const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return onKeyDown(event);
        const columns = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-menu-column]"));
        const from = columns.findIndex((column) => column.contains(document.activeElement));
        if (from < 0) return;
        event.preventDefault();
        const row = Array.from(columns[from]!.querySelectorAll<HTMLElement>("[data-nav-item]")).indexOf(document.activeElement as HTMLElement);
        const target = columns[(from + (event.key === "ArrowRight" ? 1 : -1) + columns.length) % columns.length]!;
        const items = target.querySelectorAll<HTMLElement>("[data-nav-item]");
        items[Math.min(row, items.length - 1)]?.focus();
    };

    return (
        <div className="pointer-events-none absolute top-[calc(100%-1.125rem)] left-1/2 w-[min(60rem,calc(100vw-2rem))] -translate-x-1/2">
            <div id={id} ref={panelRef} data-open={open || undefined} inert={!open} onKeyDown={onPanelKeyDown} className="nav-panel pt-5">
                <div className="overflow-hidden rounded-[1.25rem] border border-secondary bg-primary shadow-xl">
                    <div className="flex items-center gap-3 border-b border-secondary px-4 py-3 xl:px-5">
                        <button
                            type="button"
                            data-nav-item
                            onClick={() => {
                                onNavigate();
                                openSearch(true);
                            }}
                            className={cn("flex h-9 w-56 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-secondary bg-secondary/50 px-3 text-sm text-tertiary transition-colors duration-150 hover:bg-secondary", linkRing)}
                        >
                            <Search className="size-4" aria-hidden />
                            {copy.searchField}
                        </button>
                        <span aria-hidden className="h-5 w-px bg-[var(--card-line)]" />
                        <section aria-label={copy.popular} className="flex min-w-0 flex-1 items-center gap-1.5">
                            <h2 className="mr-1 shrink-0 text-label text-quaternary">{copy.popular}</h2>
                            {popularTools().map((tool) => (
                                <ToolLink key={tool.id} tool={tool} onNavigate={onNavigate} className="flex min-w-0 items-center gap-1.5 rounded-full border border-secondary px-3 py-1.5 text-sm font-medium whitespace-nowrap text-secondary hover:text-primary">
                                    <tool.icon className="size-3.5 shrink-0 text-[var(--accent)]" strokeWidth={2} aria-hidden />
                                    <span className="truncate">{toolCopy(t, tool).title}</span>
                                </ToolLink>
                            ))}
                        </section>
                    </div>

                    <div className="grid grid-cols-4 gap-x-1 p-2.5 xl:gap-x-3 xl:p-4">
                        {NAV_GROUPS.map((group) => (
                            <section key={group} aria-labelledby={`nav-group-${group}`} data-menu-column className="min-w-0">
                                <h2 id={`nav-group-${group}`} className="px-2.5 pt-1.5 pb-2.5 text-label text-quaternary">
                                    {copy.groups[group]}
                                </h2>
                                <ul className="flex flex-col gap-0.5">
                                    {groupTools(group).map((tool) => (
                                        <li key={tool.id}>
                                            <ToolLink tool={tool} onNavigate={onNavigate} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2">
                                                <ToolIcon tool={tool} />
                                                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-primary">{toolCopy(t, tool).title}</span>
                                            </ToolLink>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        ))}
                    </div>

                    <div className="flex items-center justify-end gap-1 border-t border-secondary bg-secondary/40 px-3 py-2 xl:px-5">
                        <Link to={ROUTES.documents} data-nav-item onClick={onNavigate} className={cn("rounded-lg px-2.5 py-1.5 text-sm font-medium text-secondary hover:bg-primary_hover hover:text-primary", linkRing)}>
                            {copy.viewAllPdf}
                        </Link>
                        <Link to={ROUTES.imageTools} data-nav-item onClick={onNavigate} className={cn("flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-[var(--brand)] transition-colors duration-150 hover:bg-primary_hover", linkRing)}>
                            {copy.viewAll}
                            <ArrowRight className="nav-arrow size-4" aria-hidden />
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}

/** AI Studio: a handful of the AI tools, with what each does — not another giant list. */
export function AiStudioMenu({ id, open, panelRef, onNavigate, onKeyDown }: NavPanelProps) {
    const t = useT();
    const copy = t.nav.mega;
    return (
        <div className="pointer-events-none absolute top-full left-1/2 w-[min(23rem,calc(100vw-2rem))] -translate-x-1/2">
            <div id={id} ref={panelRef} data-open={open || undefined} inert={!open} onKeyDown={onKeyDown} className="nav-panel pt-5">
                <div className="overflow-hidden rounded-[1.25rem] border border-secondary bg-primary shadow-xl">
                    <div className="p-2.5">
                        <p className="px-2.5 pt-1.5 pb-1 text-label text-quaternary">{copy.aiStudio}</p>
                        <p className="px-2.5 pb-2 text-xs text-tertiary">{copy.aiStudioHint}</p>
                        <ul className="flex flex-col gap-0.5">
                            {aiStudioTools().map((tool) => {
                                const { title, description } = toolCopy(t, tool);
                                return (
                                    <li key={tool.id}>
                                        <ToolLink tool={tool} onNavigate={onNavigate} className="flex items-center gap-3 rounded-xl px-2.5 py-2">
                                            <ToolIcon tool={tool} size="md" />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-semibold text-primary">{title}</span>
                                                <span className="block truncate text-xs text-tertiary">{description}</span>
                                            </span>
                                        </ToolLink>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                    <div className="flex justify-end border-t border-secondary bg-secondary/40 px-3 py-2">
                        <Link to={ROUTES.imageTools} data-nav-item onClick={onNavigate} className={cn("flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-[var(--brand)] transition-colors duration-150 hover:bg-primary_hover", linkRing)}>
                            {copy.allAi}
                            <ArrowRight className="nav-arrow size-4" aria-hidden />
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
