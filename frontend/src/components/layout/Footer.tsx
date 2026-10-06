import { ArrowUp, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { LogoMark, Wordmark } from "@/components/common/Logo";
import type { ToolKey } from "@/lib/constants/navigation";
import { type AppRoute, ROUTES } from "@/lib/constants/routes";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";

interface FooterLink {
    key: ToolKey;
    href: AppRoute;
}

const IMAGE_LINKS: readonly FooterLink[] = [
    { key: "removeBackground", href: ROUTES.removeBackground },
    { key: "upscaler", href: ROUTES.upscale },
    { key: "retouch", href: ROUTES.retouch },
    { key: "photoGenerator", href: ROUTES.photoGenerator },
    { key: "compressor", href: ROUTES.compress },
    { key: "crop", href: ROUTES.crop },
    { key: "editor", href: ROUTES.editor },
];

/** The most-used document tools; the rest are one click away on the Documents page. */
const DOCUMENT_LINKS: readonly FooterLink[] = [
    { key: "pdfEditor", href: ROUTES.pdfEditor },
    { key: "pdfSign", href: ROUTES.pdfSign },
    { key: "pdfToWord", href: ROUTES.pdfToWord },
    { key: "pdfOrganizer", href: ROUTES.pdfMerge },
    { key: "ocr", href: ROUTES.ocr },
    { key: "textEditor", href: ROUTES.textEditor },
];

const linkClass =
    "group inline-flex items-center gap-2.5 rounded-md text-[0.9375rem] text-secondary transition-colors duration-200 hover:text-primary outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2";

/** A link with a dot that takes the brand colour, and the words easing a step right, on hover. */
function FooterItem({ to, children, strong }: { to: string; children: React.ReactNode; strong?: boolean }) {
    return (
        <li>
            <Link to={to} className={cn(linkClass, strong && "font-medium text-primary")}>
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--footer-dot)] transition-[background-color,scale] duration-200 group-hover:scale-125 group-hover:bg-[var(--brand)]" />
                <span className="transition-transform duration-200 ease-[var(--ease-out)] group-hover:translate-x-0.5 motion-reduce:transform-none">{children}</span>
            </Link>
        </li>
    );
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <nav aria-label={title}>
            <h2 className="text-xs font-semibold tracking-[0.12em] text-tertiary uppercase">{title}</h2>
            <ul className="mt-5 flex flex-col gap-3.5">{children}</ul>
        </nav>
    );
}

/**
 * The site footer: a soft, light gradient (a deep navy one in dark mode) with the brand and what the
 * app does on the left, and the tools and resources on the right.
 */
export function Footer() {
    const t = useT();
    const copy = t.footer;
    return (
        <footer className="site-footer relative isolate overflow-hidden">
            <div className="page-container grid grid-cols-2 gap-x-6 gap-y-12 pt-16 pb-12 sm:pt-20 sm:pb-14 md:grid-cols-3 lg:grid-cols-[minmax(0,1.7fr)_repeat(3,minmax(0,1fr))] lg:gap-12">
                <div className="col-span-2 md:col-span-3 lg:col-span-1 lg:pr-10">
                    <Link
                        to={ROUTES.home}
                        className="inline-flex items-center gap-2.5 rounded-full border border-[var(--footer-line)] bg-[var(--footer-glass)] py-1.5 pr-4 pl-1.5 shadow-[0_1px_2px_rgb(15_23_42/0.04)] backdrop-blur-md outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2"
                        aria-label={t.common.homeAria}
                    >
                        <LogoMark className="size-7" />
                        <Wordmark name={t.common.appName} className="text-sm" />
                    </Link>
                    <p className="mt-7 max-w-lg text-[1.75rem] leading-[1.15] font-semibold tracking-[-0.02em] text-balance text-primary sm:text-[2rem]">{copy.tagline}</p>
                    <p className="mt-4 max-w-md text-[0.9375rem] leading-relaxed text-pretty text-tertiary">{copy.blurb}</p>
                    <p className="mt-6 inline-flex w-fit max-w-full items-center gap-2 rounded-full border border-[var(--footer-line)] bg-[var(--footer-glass)] px-3 py-1.5 text-xs font-medium text-secondary backdrop-blur-md">
                        <ShieldCheck className="size-3.5 shrink-0 text-success-primary" aria-hidden />
                        {copy.trust}
                    </p>
                </div>

                <Column title={copy.product}>
                    {IMAGE_LINKS.map((item) => (
                        <FooterItem key={item.key} to={item.href}>
                            {t.nav.toolItems[item.key].title}
                        </FooterItem>
                    ))}
                </Column>

                <Column title={copy.documents}>
                    {DOCUMENT_LINKS.map((item) => (
                        <FooterItem key={item.key} to={item.href}>
                            {t.nav.toolItems[item.key].title}
                        </FooterItem>
                    ))}
                    <FooterItem to={ROUTES.documents} strong>
                        {copy.allDocuments}
                    </FooterItem>
                </Column>

                <Column title={copy.resources}>
                    <FooterItem to={`${ROUTES.home}#how-it-works`}>{t.nav.howItWorks}</FooterItem>
                    <FooterItem to={`${ROUTES.home}#features`}>{t.nav.features}</FooterItem>
                    <FooterItem to={`${ROUTES.home}#faq`}>{copy.faq}</FooterItem>
                </Column>
            </div>

            <div className="page-container">
                {/* A hairline that fades out at both ends. */}
                <span aria-hidden className="block h-px bg-[linear-gradient(90deg,transparent,var(--footer-line)_15%,var(--footer-line)_85%,transparent)]" />
                <div className="flex flex-col gap-4 py-7 text-sm text-tertiary sm:flex-row sm:items-center sm:justify-between">
                    <p>{copy.rights(new Date().getFullYear())}</p>
                    <a
                        href="#top"
                        onClick={(event) => {
                            event.preventDefault();
                            window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
                        }}
                        className="group inline-flex items-center gap-2 self-start rounded-full border border-[var(--footer-line)] bg-[var(--footer-glass)] px-3.5 py-1.5 font-medium text-secondary backdrop-blur-md transition-colors duration-200 outline-focus-ring hover:text-primary focus-visible:outline-2 sm:self-auto"
                    >
                        {copy.backToTop}
                        <ArrowUp className="size-3.5 transition-transform duration-200 group-hover:-translate-y-0.5 motion-reduce:transform-none" aria-hidden />
                    </a>
                </div>
            </div>
        </footer>
    );
}
