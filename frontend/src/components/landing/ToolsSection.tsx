import { ArrowRight, Crop, Eraser, FileStack, ScanText, Shrink, SlidersHorizontal, Stamp, ZoomIn } from "lucide-react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { HUES } from "@/components/layout/toolRegistry";
import { useInView } from "@/hooks/useInView";
import { ROUTES } from "@/lib/constants/routes";
import { SectionHeading } from "./SectionHeading";
import { useT } from "@/i18n";

const TOOLS = [
    {
        key: "removeBackground",
        tone: HUES.indigo,
        icon: Eraser,
        href: ROUTES.removeBackground,
    },
    {
        key: "upscale",
        tone: HUES.violet,
        icon: ZoomIn,
        href: ROUTES.upscale,
    },
    {
        key: "crop",
        tone: HUES.amber,
        icon: Crop,
        href: ROUTES.crop,
    },
    {
        key: "editor",
        tone: HUES.coral,
        icon: SlidersHorizontal,
        href: ROUTES.editor,
    },
    {
        key: "compressor",
        tone: HUES.green,
        icon: Shrink,
        href: ROUTES.compress,
    },
    {
        key: "watermarkRemover",
        tone: HUES.sky,
        icon: Stamp,
        href: ROUTES.watermarkRemover,
    },
    {
        key: "ocr",
        tone: HUES.violet,
        icon: ScanText,
        href: ROUTES.ocr,
    },
    {
        key: "documents",
        tone: HUES.coral,
        icon: FileStack,
        href: ROUTES.documents,
    },
] as const;

export function ToolsSection() {
    const t = useT();
    const [ref, inView] = useInView<HTMLElement>();
    return (
        <section ref={ref} data-inview={inView} id="tools" aria-labelledby="tools-title" className="scroll-mt-20 py-20 md:py-24">
            <div className="page-container">
                <SectionHeading
                    id="tools-title"
                    badge={t.toolsSection.badge}
                    title={t.toolsSection.title}
                    description={t.toolsSection.description}
                />
                <div className="mt-12 grid gap-3 sm:grid-cols-2 md:mt-14 lg:grid-cols-4 lg:gap-4">
                    {TOOLS.map(({ key, icon: Icon, href, tone }, index) => {
                        const { title, description } = t.toolsSection.items[key];
                        return (
                        <Link
                            key={title}
                            to={href}
                            className="reveal tool-card group flex flex-col rounded-[1.25rem] border p-5 outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-4"
                            style={{ "--i": index + 3, "--accent": tone } as CSSProperties}
                        >
                            <span className="tool-card-icon flex size-11 items-center justify-center rounded-xl">
                                <Icon className="size-5" strokeWidth={1.9} aria-hidden />
                            </span>
                            <h3 className="mt-5 text-lg font-semibold tracking-[-0.01em] text-primary">{title}</h3>
                            <p className="mt-1.5 flex-1 text-sm leading-relaxed text-tertiary">{description}</p>
                            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--accent)]">
                                {t.common.openTool}
                                <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
                            </span>
                        </Link>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
