import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Footer } from "./Footer";
import { Navbar } from "./Navbar";
import { SearchDialog } from "./SearchDialog";
import { useDocumentLanguage, useT } from "@/i18n";
import { useSeo } from "@/lib/seo/useSeo";
import { useLayoutStore } from "@/store/useLayoutStore";

export function AppLayout() {
    const { pathname, hash } = useLocation();
    const t = useT();
    const immersive = useLayoutStore((state) => state.immersive);
    useDocumentLanguage();
    useSeo();

    // Start each route at the top, like a normal page load — or at the linked section (e.g. /#faq).
    useEffect(() => {
        if (hash) {
            const target = document.getElementById(hash.slice(1));
            if (target) {
                target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
                return;
            }
        }
        window.scrollTo(0, 0);
    }, [pathname, hash]);

    return (
        <div className="flex min-h-dvh flex-col bg-[var(--page-bg)]">
            <a
                href="#main"
                className="sr-only rounded-lg bg-brand-solid px-3 py-2 text-sm font-semibold text-primary_on-brand focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
            >
                {t.common.skipToContent}
            </a>
            {!immersive && <Navbar />}
            <main id="main" className="flex-1">
                <Outlet />
            </main>
            {!immersive && <Footer />}
            {/* Tool search (⌘K / Ctrl+K) works everywhere, tool workspaces included. */}
            <SearchDialog />
        </div>
    );
}
