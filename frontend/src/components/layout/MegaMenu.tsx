import { ArrowRight } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";
import type { NavPanelProps } from "./NavDropdown";
import { isCurrentItem, type MenuSection, type MenuSectionKey, menuItemCopy, navSections, type ToolMenu } from "./toolMenus";

/** Columns per menu size, and the panel's width to match. */
const LAYOUT = {
    2: { width: "w-[min(30rem,calc(100vw-2rem))]", grid: "grid-cols-2" },
    3: { width: "w-[min(44rem,calc(100vw-2rem))]", grid: "grid-cols-3" },
    4: { width: "w-[min(70rem,calc(100vw-2rem))]", grid: "grid-cols-4" },
} as const;

/**
 * A tool menu's panel: one column per section, then a link to the menu's overview page. It hangs from
 * the centre of the navigation, and its top padding is the hover bridge from the trigger.
 */
export function MegaMenu<K extends MenuSectionKey>({ menu, id, open, panelRef, onNavigate, onKeyDown }: NavPanelProps & { menu: ToolMenu<K> }) {
    const t = useT();
    const sections = navSections(menu);
    const layout = LAYOUT[Math.min(Math.max(sections.length, 2), 4) as 2 | 3 | 4];

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
        <div className={cn("pointer-events-none absolute top-full left-1/2 -translate-x-1/2", layout.width)}>
            <div id={id} ref={panelRef} data-open={open || undefined} inert={!open} onKeyDown={onPanelKeyDown} className="nav-panel pt-5">
                <div className="overflow-hidden rounded-[1.25rem] border border-secondary bg-primary shadow-xl">
                    <div className={cn("grid gap-x-1 p-2.5 xl:gap-x-3 xl:p-4", layout.grid)}>
                        {sections.map((section) => (
                            <Column key={section.key} section={section} copy={menu.sectionCopy(t, section.key)} onNavigate={onNavigate} />
                        ))}
                    </div>
                    <div className="flex justify-end border-t border-secondary bg-secondary/40 px-3 py-2 xl:px-5">
                        <Link
                            to={menu.href}
                            data-nav-item
                            onClick={onNavigate}
                            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-[var(--brand)] outline-focus-ring transition-colors duration-150 hover:bg-primary_hover focus-visible:outline-2"
                        >
                            {menu.viewAll(t)}
                            <ArrowRight className="nav-arrow size-4" aria-hidden />
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Column({ section, copy, onNavigate }: { section: MenuSection; copy: { title: string; description: string }; onNavigate: () => void }) {
    const t = useT();
    const { pathname } = useLocation();
    const headingId = `nav-menu-${section.key}`;
    const Icon = section.icon;

    return (
        <section aria-labelledby={headingId} data-menu-column className="min-w-0">
            <header className="px-2.5 pt-1.5 pb-2.5">
                <h2 id={headingId} className="flex items-center gap-1.5 text-label text-quaternary">
                    <Icon className="size-3.5" strokeWidth={2} aria-hidden />
                    {copy.title}
                </h2>
            </header>
            <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                    const ItemIcon = item.icon;
                    const itemCopy = menuItemCopy(t, item.key);
                    const current = isCurrentItem(item, pathname);
                    return (
                        <li key={item.key}>
                            <Link
                                to={{ pathname: item.href, search: item.search }}
                                data-nav-item
                                onClick={onNavigate}
                                aria-current={current ? "page" : undefined}
                                className={cn(
                                    "nav-tool flex items-center gap-2.5 rounded-xl px-2.5 py-2 outline-focus-ring transition-colors duration-150 focus-visible:outline-2",
                                    current ? "bg-secondary" : "hover:bg-secondary",
                                )}
                            >
                                <span className="nav-tool-icon grid size-8 shrink-0 place-items-center rounded-lg border border-secondary bg-primary text-secondary">
                                    <ItemIcon className="size-4" strokeWidth={1.9} aria-hidden />
                                </span>
                                {/* Names only: the overview page has the descriptions. */}
                                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-primary">{itemCopy.title}</span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
