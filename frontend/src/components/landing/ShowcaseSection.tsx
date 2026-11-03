import { ArrowRight, ChevronLeft, ChevronRight, MoveHorizontal } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { Link } from "react-router-dom";
import { gooseDetail, images } from "@/assets/images/landing";
import { CompareSlider } from "@/components/common/CompareSlider";
import { useInView } from "@/hooks/useInView";
import { ROUTES } from "@/lib/constants/routes";
import { cn } from "@/lib/utils/cn";
import { OutlineLink } from "./OutlineLink";
import { SectionHeading } from "./SectionHeading";
import { useT } from "@/i18n";

interface Slide {
    id: "heron" | "goose" | "kingfisher";
    tool: "removeBackground" | "upscale";
    href: string;
    before: { src: string; srcSet?: string };
    after: { src: string; srcSet?: string };
    transparent?: boolean;
    /** Frame both images identically (object-position / zoom). */
    framing?: string;
    upscale?: boolean;
}

const SLIDES: Slide[] = [
    {
        id: "heron",
        tool: "removeBackground",
        href: ROUTES.removeBackground,
        before: { ...images.heron },
        after: { ...images.heronCutout },
        transparent: true,
    },
    {
        id: "goose",
        tool: "upscale",
        href: ROUTES.upscale,
        before: { src: gooseDetail.low },
        after: { src: gooseDetail.high },
        framing: "scale-[2.2] origin-[61%_30%]",
        upscale: true,
    },
    {
        id: "kingfisher",
        tool: "removeBackground",
        href: ROUTES.removeBackground,
        before: { ...images.kingfisher },
        after: { ...images.kingfisherCutout },
        transparent: true,
    },
];

export function ShowcaseSection() {
    const t = useT();
    const [ref, inView] = useInView<HTMLElement>();
    const [index, setIndex] = useState(0);
    const [position, setPosition] = useState(50);
    const slide = SLIDES[index] ?? SLIDES[0]!;
    const copy = t.showcase.slides[slide.id];
    const beforeLabel = slide.upscale ? t.common.original : t.common.before;
    const afterLabel = slide.upscale ? t.showcase.upscaled : t.common.after;
    const toolLabel = t.toolPage.switcher[slide.tool];

    const go = (next: number) => {
        setIndex((next + SLIDES.length) % SLIDES.length);
        setPosition(50);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "ArrowLeft") go(index - 1);
        if (event.key === "ArrowRight") go(index + 1);
    };

    const imageClass = cn("absolute inset-0 size-full object-cover", slide.framing);

    return (
        <section ref={ref} data-inview={inView} aria-labelledby="showcase-title" className="py-20 md:py-24">
            <div className="page-container">
                <SectionHeading
                    id="showcase-title"
                    badge={t.showcase.badge}
                    title={t.showcase.title}
                    description={t.showcase.description}
                    action={<OutlineLink to={ROUTES.removeBackground}>{t.showcase.tryIt}</OutlineLink>}
                />

                <div
                    className="reveal card mt-12 bg-tertiary shadow-none p-4 sm:p-6 md:mt-14 md:p-8 [--i:3]"
                    role="region"
                    aria-roledescription="carousel"
                    aria-label={t.showcase.region}
                    tabIndex={0}
                    onKeyDown={onKeyDown}
                >
                    <div className="grid items-center gap-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:gap-8">
                        <NavButton direction="prev" onClick={() => go(index - 1)} className="hidden md:flex" />

                        <div className="mx-auto w-full max-w-[36rem]">
                            <div key={slide.id} className="animate-enter relative [--i:-1]">
                                <CompareSlider
                                    value={position}
                                    onChange={setPosition}
                                    beforeLabel={beforeLabel}
                                    afterLabel={afterLabel}
                                    className="aspect-[6/5] w-full rounded-2xl shadow-[0_20px_50px_-25px_rgb(26_32_44/0.45)]"
                                    before={<img src={slide.before.src} srcSet={slide.before.srcSet} sizes="576px" alt={copy.before} loading="lazy" draggable={false} className={imageClass} />}
                                    after={
                                        <>
                                            {slide.transparent && <div className="absolute inset-0 bg-checkerboard" />}
                                            <img src={slide.after.src} srcSet={slide.after.srcSet} sizes="576px" alt={copy.after} loading="lazy" draggable={false} className={imageClass} />
                                        </>
                                    }
                                >
                                    <span className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-neutral-950/55 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md">
                                        <MoveHorizontal className="size-3.5" aria-hidden /> {t.showcase.dragToCompare}
                                    </span>
                                </CompareSlider>
                            </div>

                            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-center">
                                <p className="text-md font-semibold text-primary">{copy.title}</p>
                                <Link
                                    to={slide.href}
                                    className="inline-flex items-center gap-1 rounded-full border border-[var(--brand-line)] bg-[var(--brand-soft)] px-3 py-1 text-sm font-medium text-[var(--brand)] transition-colors hover:bg-[var(--brand-line)] outline-focus-ring focus-visible:outline-2"
                                >
                                    {toolLabel} <ArrowRight className="size-3.5" aria-hidden />
                                </Link>
                            </div>
                            {"note" in copy && <p className="mt-2 text-center text-xs text-quaternary">{copy.note}</p>}

                            <div className="mt-5 flex items-center justify-center gap-4">
                                <NavButton direction="prev" onClick={() => go(index - 1)} className="md:hidden" />
                                <div role="tablist" aria-label={t.showcase.choose} className="flex items-center gap-2">
                                    {SLIDES.map((item, i) => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            role="tab"
                                            aria-selected={i === index}
                                            aria-label={t.showcase.slides[item.id].title}
                                            onClick={() => go(i)}
                                            // A 24px target around the small dot, so it's easy to tap.
                                            className="group grid h-6 min-w-6 cursor-pointer place-items-center rounded-full outline-focus-ring focus-visible:outline-2"
                                        >
                                            <span
                                                aria-hidden
                                                className={cn(
                                                    "h-2 rounded-full transition-[width,background-color] duration-500 ease-[var(--ease-spring)]",
                                                    i === index ? "w-6 bg-[var(--brand)]" : "w-2 bg-[var(--brand-line)] group-hover:bg-[var(--brand)]/50",
                                                )}
                                            />
                                        </button>
                                    ))}
                                </div>
                                <NavButton direction="next" onClick={() => go(index + 1)} className="md:hidden" />
                            </div>
                        </div>

                        <NavButton direction="next" onClick={() => go(index + 1)} className="hidden md:flex" />
                    </div>
                </div>
            </div>
        </section>
    );
}

function NavButton({ direction, onClick, className }: { direction: "prev" | "next"; onClick: () => void; className?: string }) {
    const t = useT();
    const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
    return (
        <div className={cn("flex-col items-center gap-2", className)}>
            <button
                type="button"
                onClick={onClick}
                aria-label={direction === "prev" ? t.showcase.prevAria : t.showcase.nextAria}
                className="flex size-11 cursor-pointer items-center justify-center rounded-full border border-secondary bg-primary text-secondary shadow-xs transition-[scale,color] duration-200 hover:text-primary active:scale-95 outline-focus-ring focus-visible:outline-2"
            >
                <Icon className="size-5" aria-hidden />
            </button>
            <span className="hidden text-[0.6875rem] font-medium tracking-[0.08em] text-quaternary uppercase md:block">{direction === "prev" ? t.showcase.prev : t.showcase.next}</span>
        </div>
    );
}
