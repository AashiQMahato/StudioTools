import { ArrowRight, Menu, Search, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { LanguageMenu } from "@/components/common/LanguageMenu";
import { Logo } from "@/components/common/Logo";
import { UploadButton } from "@/components/common/UploadButton";
import { useActiveSection } from "@/hooks/useActiveSection";
import { useScrolled } from "@/hooks/useScrolled";
import { ROUTES } from "@/lib/constants/routes";
import { useT } from "@/i18n";
import { DesktopNav } from "./DesktopNav";
import { MobileNav } from "./MobileNav";
import { useToolSearch } from "@/store/useToolSearch";
import { ThemeToggle } from "./ThemeToggle";

const DESKTOP = "(min-width: 64rem)";
const MOBILE_NAV_ID = "mobile-nav";
const SHORTCUT = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform) ? "⌘K" : "Ctrl+K";

/**
 * A floating Liquid Glass bar: light and clear over the hero, more opaque with deeper shadow once
 * content scrolls under it. Desktop from 1024px; below that the links move into a sheet and the bar
 * keeps only what's used constantly.
 */
export function Navbar() {
    const t = useT();
    const scrolled = useScrolled();
    const { pathname } = useLocation();
    const activeSection = useActiveSection(pathname === ROUTES.home);
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const openSearch = useToolSearch((state) => state.setOpen);

    // The sheet belongs to the page it was opened on, so any navigation closes it.
    const [menuOpenedAt, setMenuOpenedAt] = useState<string | null>(null);
    const menuOpen = menuOpenedAt === pathname;
    const closeMenu = useCallback(() => setMenuOpenedAt(null), []);

    // Escape closes the sheet; growing into the desktop layout does too (the sheet has no place there).
    useEffect(() => {
        if (!menuOpen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            closeMenu();
            menuButtonRef.current?.focus();
        };
        const desktop = window.matchMedia(DESKTOP);
        const onResize = () => desktop.matches && closeMenu();
        document.addEventListener("keydown", onKeyDown);
        desktop.addEventListener("change", onResize);
        return () => {
            document.removeEventListener("keydown", onKeyDown);
            desktop.removeEventListener("change", onResize);
        };
    }, [menuOpen, closeMenu]);

    const elevated = scrolled || menuOpen;

    return (
        <header className="nav-bar sticky top-0 z-40 pt-2 pb-2">
            <div className="page-container relative">
                {/* A floating pane of glass: clear over the hero, a touch more present once content scrolls under it. */}
                <div
                    data-elevated={elevated || undefined}
                    className="nav-shell relative flex h-14 items-center gap-4 rounded-[1.125rem] pr-1.5 pl-3.5 sm:pl-4 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:gap-4"
                >
                    <Logo className="nav-logo" />

                    <DesktopNav className="hidden lg:block" />

                    <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
                        {/* An icon only: the search itself opens as a palette (also ⌘K / Ctrl+K). */}
                        <button
                            type="button"
                            onClick={() => openSearch(true)}
                            aria-label={t.nav.mega.search.label}
                            aria-haspopup="dialog"
                            aria-keyshortcuts="Meta+K Control+K"
                            title={`${t.nav.mega.search.label} (${SHORTCUT})`}
                            className="group flex h-11 cursor-pointer items-center gap-2 rounded-full px-3 text-secondary transition-colors duration-150 outline-focus-ring hover:nav-fill hover:text-primary focus-visible:outline-2 lg:h-10"
                        >
                            <Search className="size-[1.125rem]" aria-hidden />
                            <kbd aria-hidden className="hidden rounded-md bg-[rgb(120_113_98/0.1)] px-1.5 py-0.5 font-sans text-[0.6875rem] font-medium text-quaternary xl:inline dark:bg-white/8">
                                {SHORTCUT}
                            </kbd>
                        </button>
                        <LanguageMenu className="hidden lg:block" />
                        <ThemeToggle />
                        <UploadButton
                            size="md"
                            label={t.nav.mega.openStudio}
                            navigateTo={ROUTES.editor}
                            icon={Sparkles}
                            trailingIcon={ArrowRight}
                            className="ml-1 hidden md:inline-flex"
                            // Ink, borderless: the one solid object on the glass.
                            buttonClassName="nav-cta btn-ink h-10 rounded-full px-4 ring-0! before:hidden"
                        />
                        <button
                            ref={menuButtonRef}
                            type="button"
                            aria-label={menuOpen ? t.common.closeMenu : t.common.openMenu}
                            aria-expanded={menuOpen}
                            aria-controls={MOBILE_NAV_ID}
                            onClick={() => setMenuOpenedAt(menuOpen ? null : pathname)}
                            className="grid size-11 cursor-pointer place-items-center rounded-full text-secondary transition-colors duration-150 outline-focus-ring hover:nav-fill hover:text-primary focus-visible:outline-2 lg:hidden"
                        >
                            {menuOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
                        </button>
                    </div>
                </div>
            </div>

            <MobileNav id={MOBILE_NAV_ID} open={menuOpen} onClose={closeMenu} activeSection={activeSection} />
        </header>
    );
}
