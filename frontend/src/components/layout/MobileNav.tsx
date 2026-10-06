import { ArrowRight, ChevronDown, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Segmented } from "@/components/common/Segmented";
import { UploadButton } from "@/components/common/UploadButton";
import { ROUTES } from "@/lib/constants/routes";
import { SECTION_LINKS, type SectionKey } from "@/lib/constants/navigation";
import { cn } from "@/lib/utils/cn";
import { DICTIONARIES, LOCALES, useLocale, useT } from "@/i18n";
import { documentMenu, imageMenu, isCurrentItem, type MenuSectionKey, menuItemCopy, navSections, type ToolMenu } from "./toolMenus";
import { NavItem } from "./NavItem";
import { scrollToSection, sectionHref } from "./sections";

interface MobileNavProps {
    id: string;
    open: boolean;
    onClose: () => void;
    activeSection: SectionKey | null;
}

/**
 * Phones and tablets: a near-full-width sheet under the bar, with Image Tools and Text Tools as
 * accordions rather than squeezed desktop panels. Stays mounted so it can animate out; `inert` keeps it out of reach.
 */
export function MobileNav({ id, open, onClose, activeSection }: MobileNavProps) {
    const t = useT();
    const { locale, setLocale } = useLocale();
    const [toolsOpen, setToolsOpen] = useState(false);
    const [documentsOpen, setDocumentsOpen] = useState(false);

    // The page underneath shouldn't scroll while the sheet is up.
    useEffect(() => {
        if (!open) return;
        const root = document.documentElement;
        const previous = root.style.overflow;
        root.style.overflow = "hidden";
        return () => {
            root.style.overflow = previous;
        };
    }, [open]);

    return (
        <>
            <div aria-hidden data-open={open || undefined} onClick={onClose} className="nav-scrim fixed inset-x-0 top-18 bottom-0 bg-overlay/25 lg:hidden" />

            <div id={id} data-open={open || undefined} inert={!open} className="nav-sheet absolute inset-x-0 top-full px-[var(--page-gutter)] pt-2 lg:hidden">
                <nav aria-label={t.nav.main} className="mx-auto max-h-[calc(100dvh-6rem)] max-w-xl overflow-y-auto rounded-2xl border border-secondary bg-primary p-2 shadow-xl">
                    <button
                        type="button"
                        aria-expanded={toolsOpen}
                        aria-controls={`${id}-tools`}
                        onClick={() => setToolsOpen((value) => !value)}
                        className="flex min-h-12 w-full cursor-pointer items-center justify-between rounded-lg px-3 text-md font-medium text-primary transition-colors duration-150 outline-focus-ring hover:bg-primary_hover focus-visible:outline-2"
                    >
                        {t.nav.tools}
                        <Plus className="nav-plus size-5 text-quaternary" aria-hidden />
                    </button>

                    <div id={`${id}-tools`} data-open={toolsOpen || undefined} inert={!toolsOpen} className="nav-accordion">
                        <div>
                            <MobileMenu menu={imageMenu} idPrefix={`${id}-tools`} onClose={onClose} />
                        </div>
                    </div>

                    <button
                        type="button"
                        aria-expanded={documentsOpen}
                        aria-controls={`${id}-documents-menu`}
                        onClick={() => setDocumentsOpen((value) => !value)}
                        className="flex min-h-12 w-full cursor-pointer items-center justify-between rounded-lg px-3 text-md font-medium text-primary transition-colors duration-150 outline-focus-ring hover:bg-primary_hover focus-visible:outline-2"
                    >
                        {t.nav.documents}
                        <Plus className="nav-plus size-5 text-quaternary" aria-hidden />
                    </button>

                    <div id={`${id}-documents-menu`} data-open={documentsOpen || undefined} inert={!documentsOpen} className="nav-accordion">
                        <div>
                            <MobileMenu menu={documentMenu} idPrefix={`${id}-documents`} onClose={onClose} />
                        </div>
                    </div>

                    <ul>
                        {SECTION_LINKS.map((link) => (
                            <li key={link.key}>
                                <NavItem
                                    size="sheet"
                                    href={sectionHref(link.id)}
                                    active={activeSection === link.key}
                                    onNavigate={() => {
                                        scrollToSection(link.id);
                                        onClose();
                                    }}
                                >
                                    {t.nav[link.key]}
                                </NavItem>
                            </li>
                        ))}
                    </ul>

                    <div className="mt-2 flex flex-col gap-3 border-t border-secondary px-1 pt-3 pb-1">
                        {/* The desktop language dropdown would be clipped inside this scrolling sheet. */}
                        <Segmented
                            label={t.common.language}
                            value={locale}
                            onChange={setLocale}
                            className="w-full [&>button]:flex-1"
                            options={LOCALES.map((code) => ({ value: code, label: DICTIONARIES[code].meta.name }))}
                        />
                        <UploadButton
                            size="lg"
                            label={t.common.startEditing}
                            navigateTo={ROUTES.editor}
                            className="flex w-full md:hidden"
                            buttonClassName="w-full rounded-full before:rounded-full"
                        />
                    </div>
                </nav>
            </div>
        </>
    );
}

/**
 * A tool menu on phones and tablets: not the desktop's columns, but its sections as their own
 * accordions — each opens to its tools — then a link to the menu's overview page.
 */
function MobileMenu<K extends MenuSectionKey>({ menu, idPrefix, onClose }: { menu: ToolMenu<K>; idPrefix: string; onClose: () => void }) {
    const t = useT();
    const { pathname } = useLocation();
    const [openSection, setOpenSection] = useState<K | null>(null);

    return (
        <div className="flex flex-col gap-0.5 px-1 pt-1 pb-3">
            {navSections(menu).map((section) => {
                const copy = menu.sectionCopy(t, section.key);
                const open = openSection === section.key;
                const panelId = `${idPrefix}-${section.key}`;
                const Icon = section.icon;
                return (
                    <section key={section.key}>
                        <button
                            type="button"
                            aria-expanded={open}
                            aria-controls={panelId}
                            onClick={() => setOpenSection(open ? null : section.key)}
                            className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg px-2 text-left transition-colors duration-150 outline-focus-ring hover:bg-primary_hover focus-visible:outline-2"
                        >
                            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-secondary">
                                <Icon className="size-[1.125rem]" strokeWidth={1.9} aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-[0.9375rem] font-semibold text-primary">{copy.title}</span>
                                <span className="block truncate text-xs text-tertiary">{copy.description}</span>
                            </span>
                            <ChevronDown className="nav-chevron size-4 shrink-0 text-quaternary" aria-hidden />
                        </button>
                        <div id={panelId} data-open={open || undefined} inert={!open} className="nav-accordion">
                            <ul className="pb-1 pl-11">
                                {section.items.map((item) => {
                                    const current = isCurrentItem(item, pathname);
                                    return (
                                        <li key={item.key}>
                                            <Link
                                                to={{ pathname: item.href, search: item.search }}
                                                onClick={onClose}
                                                aria-current={current ? "page" : undefined}
                                                className={cn(
                                                    "flex min-h-11 items-center rounded-lg px-2 text-[0.9375rem] font-medium transition-colors duration-150 outline-focus-ring focus-visible:outline-2",
                                                    current ? "bg-primary_hover text-primary" : "text-secondary hover:bg-primary_hover hover:text-primary",
                                                )}
                                            >
                                                {menuItemCopy(t, item.key).title}
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    </section>
                );
            })}
            <Link
                to={menu.href}
                onClick={onClose}
                className="mt-1 flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[0.9375rem] font-semibold text-[var(--brand)] outline-focus-ring hover:bg-primary_hover focus-visible:outline-2"
            >
                {menu.viewAll(t)}
                <ArrowRight className="size-4" aria-hidden />
            </Link>
        </div>
    );
}
