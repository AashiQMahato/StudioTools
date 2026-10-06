import { ArrowLeft, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { documentMenu, imageMenu, isCurrentItem, menuItemCopy, type ToolMenu } from "@/components/layout/toolMenus";
import { isDocumentTool, type ToolKey } from "@/lib/constants/navigation";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";

interface StudioSidebarProps {
    current: ToolKey;
    /** Wide screens: folded away (the menu button in the header brings it back). */
    collapsed: boolean;
    /** Narrow screens: the drawer is open. */
    drawerOpen: boolean;
    onCloseDrawer: () => void;
    id: string;
}

/**
 * Every tool, grouped the way the landing page groups them. Wide screens show it beside the work —
 * each tool's name and what it does, an icon rail at laptop width — and the menu button folds it away
 * (smoothly; remembered). Narrow screens keep it in a drawer the same button slides open.
 */
export function StudioSidebar({ current, collapsed, drawerOpen, onCloseDrawer, id }: StudioSidebarProps) {
    const t = useT();
    const drawer = useRef<HTMLDivElement>(null);

    // The drawer: focus moves in when it opens, Escape closes it, focus returns to the menu button.
    useEffect(() => {
        if (!drawerOpen) return;
        const returnTo = document.activeElement as HTMLElement | null;
        drawer.current?.focus();
        const onKey = (event: KeyboardEvent) => event.key === "Escape" && onCloseDrawer();
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("keydown", onKey);
            returnTo?.focus?.();
        };
    }, [drawerOpen, onCloseDrawer]);

    return (
        <>
            {/* Wide screens: the column's width animates to nothing; the contents keep their width, so nothing reflows mid-slide. */}
            <div
                id={id}
                inert={collapsed}
                className={cn(
                    "hidden shrink-0 overflow-hidden transition-[width,margin-right,opacity] duration-300 ease-[var(--ease-out)] motion-reduce:transition-none lg:flex",
                    collapsed ? "w-0 opacity-0 lg:-mr-3" : "opacity-100 lg:w-[4.25rem] xl:w-64",
                )}
            >
                <SidebarNav current={current} className="lg:w-[4.25rem] xl:w-64" />
            </div>

            {/* Narrow screens: a drawer from the left, over the page. */}
            <div className={cn("fixed inset-0 z-50 lg:hidden", !drawerOpen && "pointer-events-none")} inert={!drawerOpen}>
                <div aria-hidden onClick={onCloseDrawer} className={cn("absolute inset-0 bg-neutral-950/40 transition-opacity duration-300 motion-reduce:transition-none", drawerOpen ? "opacity-100" : "opacity-0")} />
                <div
                    ref={drawer}
                    role="dialog"
                    aria-modal="true"
                    aria-label={t.studio.toolsNav}
                    tabIndex={-1}
                    className={cn(
                        "absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col gap-1 bg-secondary p-2 pt-[max(0.5rem,env(safe-area-inset-top))] shadow-2xl outline-none transition-transform duration-300 ease-[var(--ease-out)] motion-reduce:transition-none",
                        drawerOpen ? "translate-x-0" : "-translate-x-full",
                    )}
                >
                    <div className="flex shrink-0 items-center justify-between py-1 pr-1 pl-3">
                        <span className="text-sm font-semibold text-primary">{t.studio.toolsNav}</span>
                        <button type="button" onClick={onCloseDrawer} aria-label={t.studio.hideTools} className="grid size-9 cursor-pointer place-items-center rounded-lg text-tertiary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 pointer-coarse:size-11">
                            <X className="size-4" aria-hidden />
                        </button>
                    </div>
                    <SidebarNav current={current} className="min-h-0 flex-1" onNavigate={onCloseDrawer} />
                </div>
            </div>
        </>
    );
}

/** The tool list itself (the same in the column and the drawer): the suite's sections, as in its menu. */
function SidebarNav({ current, className, onNavigate }: { current: ToolKey; className?: string; onNavigate?: () => void }) {
    const t = useT();
    const copy = t.studio;
    const { pathname } = useLocation();
    const documents = isDocumentTool(current);
    const menu: ToolMenu = documents ? documentMenu : imageMenu;
    const back = documents ? copy.backToDocuments : copy.backToImageTools;
    const list = useRef<HTMLDivElement>(null);

    // The current tool may be further down a long list: bring it into view (no animation on arrival).
    useEffect(() => {
        list.current?.querySelector<HTMLElement>("[aria-current=page]")?.scrollIntoView({ block: "nearest" });
    }, [pathname]);

    return (
        <nav aria-label={copy.toolsNav} className={cn("flex shrink-0 flex-col rounded-2xl border border-[var(--card-line)] bg-primary p-2 xl:p-3", className)}>
            <div ref={list} className="-mx-1 flex flex-1 flex-col gap-5 overflow-y-auto px-1 pb-1">
                {menu.sections.map((section) => (
                    <section key={section.key} aria-labelledby={`studio-group-${section.key}`} className="flex flex-col gap-0.5">
                        <h2 id={`studio-group-${section.key}`} className="px-2 pb-1.5 text-[0.6875rem] font-semibold tracking-[0.08em] text-quaternary uppercase lg:sr-only xl:not-sr-only">
                            {menu.sectionCopy(t, section.key).title}
                        </h2>
                        {section.items.map((item) => {
                            const Icon = item.icon;
                            const active = isCurrentItem(item, pathname);
                            const { title, description } = menuItemCopy(t, item.key);
                            return (
                                <Link
                                    key={item.key}
                                    to={{ pathname: item.href, search: item.search }}
                                    onClick={onNavigate}
                                    aria-current={active ? "page" : undefined}
                                    title={title}
                                    className={cn(
                                        "studio-nav-item group relative flex items-center gap-3 rounded-xl p-1.5 outline-focus-ring focus-visible:outline-2 lg:justify-center xl:justify-start xl:pr-2",
                                        active ? "bg-[var(--brand-soft)]" : "hover:bg-secondary",
                                    )}
                                >
                                    <span
                                        className={cn(
                                            "grid size-9 shrink-0 place-items-center rounded-[0.625rem] border transition-colors duration-150",
                                            active ? "border-transparent bg-linear-to-b from-[#3B82F6] to-[#2563EB] text-white shadow-[0_4px_10px_-4px_rgb(37_99_235/0.6)]" : "border-[var(--card-line)] bg-primary text-tertiary group-hover:text-primary",
                                        )}
                                    >
                                        <Icon className="size-[1.125rem]" strokeWidth={1.9} aria-hidden />
                                    </span>
                                    <span className="min-w-0 lg:sr-only xl:not-sr-only">
                                        <span className={cn("block truncate text-sm font-semibold", active ? "text-[var(--brand)]" : "text-primary")}>{title}</span>
                                        <span className="block truncate text-xs text-tertiary">{description}</span>
                                    </span>
                                </Link>
                            );
                        })}
                    </section>
                ))}
            </div>

            <div className="mt-3 flex flex-col gap-2 border-t border-[var(--card-line)] pt-3">
                <div className="flex items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,#10B981_22%,transparent)] bg-[color-mix(in_srgb,#10B981_8%,transparent)] p-3 lg:hidden xl:flex">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#059669] dark:text-[#34D399]" aria-hidden />
                    <p className="text-xs leading-relaxed text-tertiary">
                        <span className="block text-sm font-semibold text-[#047857] dark:text-[#6EE7B7]">{copy.privateTitle}</span>
                        {copy.privateNote}
                    </p>
                </div>
                <Link
                    to={menu.href}
                    onClick={onNavigate}
                    title={back}
                    className="flex h-10 items-center gap-2 rounded-xl px-2.5 text-sm font-medium text-tertiary outline-focus-ring transition-colors duration-150 hover:bg-secondary hover:text-primary focus-visible:outline-2 lg:justify-center xl:justify-start"
                >
                    <ArrowLeft className="size-4 shrink-0" aria-hidden />
                    <span className="lg:sr-only xl:not-sr-only">{back}</span>
                </Link>
            </div>
        </nav>
    );
}
