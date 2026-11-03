import { ArrowDown, ArrowUpRight, Check, FileText, ImageIcon, Presentation } from "lucide-react";
import { type CSSProperties, useState } from "react";
import { Link } from "react-router-dom";
import { UploadButton } from "@/components/common/UploadButton";
import { documentMenu, imageMenu, sidebarSections, type ToolMenu } from "@/components/layout/toolMenus";
import { HUES } from "@/components/layout/toolRegistry";
import { Button } from "@/components/ui/base/buttons/button";
import { ROUTES } from "@/lib/constants/routes";
import { useT } from "@/i18n";
import { HeroShowcase } from "./HeroShowcase";

/** How many tools a suite really has: each tool once (its modes and presets aren't counted). */
const toolCount = (menu: ToolMenu) => sidebarSections(menu).reduce((sum, section) => sum + section.items.length, 0);

/**
 * The first viewport: what Studio Tools is in one line, a way in, the reasons to trust it, and the
 * three parts of the suite — beside the product itself, running, in a glass bezel (stacked on narrow
 * screens). Light comes from above, so the eye moves from the headline down to the showcase.
 */
export function Hero() {
    const t = useT();
    const copy = t.hero;
    const [uploadError, setUploadError] = useState<string | null>(null);
    const pill = "press-scale rounded-full before:hidden ring-0!";

    const suites = [
        { key: "images", href: ROUTES.imageTools, icon: ImageIcon, tone: HUES.indigo, title: copy.suites.images.title, hint: copy.suites.images.hint(toolCount(imageMenu)) },
        { key: "documents", href: ROUTES.documents, icon: FileText, tone: HUES.coral, title: copy.suites.documents.title, hint: copy.suites.documents.hint(toolCount(documentMenu)) },
        { key: "whiteboard", href: ROUTES.whiteboard, icon: Presentation, tone: HUES.violet, title: copy.suites.whiteboard.title, hint: copy.suites.whiteboard.hint() },
    ];

    return (
        <section aria-labelledby="hero-title" className="hero-premium relative isolate -mt-18 overflow-x-clip pt-18">
            {/* Wide screens: the words on the left, the product running on the right — both in the first view.
                Narrow screens: words first, then the showcase, in one column exactly the screen's width. */}
            <div className="page-container grid grid-cols-1 items-center gap-12 pt-8 pb-16 md:pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-10 lg:pt-14 lg:pb-20 xl:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] xl:gap-16">
                <div className="mx-auto flex max-w-2xl flex-col items-center text-center lg:mx-0 lg:max-w-none lg:items-start lg:text-left">
                    <p className="animate-enter hero-badge inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-secondary [--i:1] sm:text-sm">
                        <span aria-hidden className="size-1.5 rounded-full bg-[var(--green)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--green)_20%,transparent)]" />
                        {copy.badge}
                    </p>
                    <h1 id="hero-title" className="animate-enter mt-6 text-hero text-balance text-primary [--i:2] lg:text-[3.125rem] lg:leading-[1.08] lg:tracking-[-0.035em] xl:text-[3.5rem]">
                        {copy.titleLead} <span className="hero-accent">{copy.titleAccent}</span>
                    </h1>
                    <p className="animate-enter mt-5 max-w-xl text-lead text-pretty text-tertiary [--i:3]">{copy.description}</p>

                    <div className="animate-enter mt-8 flex flex-wrap items-center justify-center gap-3 [--i:4] lg:justify-start">
                        <UploadButton size="xl" label={t.common.startEditing} navigateTo={ROUTES.editor} onErrorChange={setUploadError} buttonClassName={`${pill} btn-ink px-7`} />
                        <Button size="xl" color="secondary" href="#tools" iconTrailing={ArrowDown} className={`${pill} glass px-6 shadow-none`}>
                            {copy.exploreTools}
                        </Button>
                    </div>
                    {uploadError && (
                        <p role="alert" className="mt-4 text-sm text-error-primary">
                            {uploadError}
                        </p>
                    )}

                    <ul className="animate-enter mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-tertiary [--i:5] lg:justify-start">
                        {copy.trust.map((item) => (
                            <li key={item} className="inline-flex items-center gap-1.5">
                                <Check className="size-4 text-success-primary" strokeWidth={2.5} aria-hidden />
                                {item}
                            </li>
                        ))}
                    </ul>

                    {/* The suite at a glance: three ways in. */}
                    <nav aria-label={copy.suitesLabel} className="animate-enter mt-10 w-full [--i:6]">
                        <ul className="grid grid-cols-1 gap-2 min-[30rem]:grid-cols-3">
                            {suites.map(({ key, href, icon: Icon, tone, title, hint }) => (
                                <li key={key}>
                                    <Link
                                        to={href}
                                        style={{ "--accent": tone } as CSSProperties}
                                        className="group flex items-center gap-3 rounded-2xl bg-[color-mix(in_srgb,var(--color-bg-primary)_70%,transparent)] p-2.5 text-left shadow-[0_0_0_1px_var(--card-line)] outline-focus-ring transition-[background-color,box-shadow,scale] duration-200 hover:bg-primary hover:shadow-[0_0_0_1px_var(--card-line),0_10px_24px_-14px_rgb(32_33_36/0.35)] focus-visible:outline-2 active:scale-[0.98]"
                                    >
                                        <span className="grid size-9 shrink-0 place-items-center rounded-[0.625rem] bg-[color-mix(in_srgb,var(--accent)_13%,transparent)] text-[var(--accent)] transition-colors duration-200 group-hover:bg-[var(--accent)] group-hover:text-white">
                                            <Icon className="size-4" strokeWidth={2} aria-hidden />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-semibold text-primary">{title}</span>
                                            <span className="block truncate text-xs text-tertiary">{hint}</span>
                                        </span>
                                        <ArrowUpRight className="size-4 shrink-0 text-quaternary transition-[color,translate] duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[var(--accent)] motion-reduce:group-hover:translate-0" aria-hidden />
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </nav>
                </div>

                {/* Large screens: the showcase reaches past the column toward the edge — never past the side gutter. */}
                <HeroShowcase className="animate-enter [--i:4] lg:-mr-4 lg:ml-0 lg:w-auto lg:max-w-none xl:-mr-[min(5rem,calc((100vw-var(--page-max))/2+var(--page-gutter)-1rem))] 2xl:-mr-[min(7rem,calc((100vw-var(--page-max))/2+var(--page-gutter)-1rem))]" />
            </div>
        </section>
    );
}
