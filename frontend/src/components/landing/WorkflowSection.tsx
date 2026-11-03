import { Download, Eraser, ImagePlus } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { images } from "@/assets/images/landing";
import { UploadButton } from "@/components/common/UploadButton";
import { useInView } from "@/hooks/useInView";
import { SectionHeading } from "./SectionHeading";
import { useT } from "@/i18n";

export function WorkflowSection() {
    const t = useT();
    const [ref, inView] = useInView<HTMLElement>();
    const visuals: ReactNode[] = [<UploadVisual key="upload" />, <TransformVisual key="transform" />, <DownloadVisual key="download" />];
    const steps = t.workflow.steps.map((step, index) => ({ ...step, visual: visuals[index] }));

    return (
        <section id="how-it-works" ref={ref} data-inview={inView} aria-labelledby="workflow-title" className="scroll-mt-20 py-20 md:py-24">
            <div className="page-container">
                <SectionHeading
                    id="workflow-title"
                    badge={t.workflow.badge}
                    title={t.workflow.title}
                    description={t.workflow.description}
                    action={<UploadButton size="lg" label={t.workflow.getStarted} showIcon={false} buttonClassName="btn-ink rounded-full px-6 ring-0! before:hidden" />}
                />
                <ol className="mt-12 grid gap-4 md:mt-14 md:grid-cols-3 lg:gap-5">
                    {steps.map((step, index) => (
                        <li key={step.title} className="reveal card overflow-hidden" style={{ "--i": index + 3 } as CSSProperties}>
                            <div aria-hidden className="relative flex h-48 items-center justify-center overflow-hidden border-b border-[var(--card-line)] bg-[var(--color-bg-secondary)]">
                                {step.visual}
                            </div>
                            <div className="p-6">
                                <span className="flex size-8 items-center justify-center rounded-full bg-tertiary font-mono text-sm font-semibold text-secondary tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                                <h3 className="mt-4 text-xl font-semibold tracking-[-0.015em] text-primary">{step.title}</h3>
                                <p className="mt-3 text-[0.9375rem] leading-relaxed text-tertiary">{step.description}</p>
                            </div>
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
}

function UploadVisual() {
    const t = useT();
    return (
        <div className="flex h-32 w-4/5 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[var(--brand-line)] bg-[var(--card-bg)]">
            <span className="flex size-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                <ImagePlus className="size-5" />
            </span>
            <span className="mt-3 text-sm font-semibold text-primary">{t.workflow.dropHere}</span>
            <span className="mt-0.5 text-xs text-quaternary">{t.workflow.formats}</span>
        </div>
    );
}

function TransformVisual() {
    const t = useT();
    return (
        <>
            <div className="absolute inset-0 bg-checkerboard [background-size:14px_14px]" />
            <img src={images.heronCutout.src} alt="" loading="lazy" className="absolute inset-0 size-full object-cover object-[65%_45%]" />
            <span className="material absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-primary">
                <Eraser className="size-3.5 text-[var(--brand)]" /> {t.workflow.backgroundRemoved}
            </span>
        </>
    );
}

function DownloadVisual() {
    return (
        <div className="flex w-4/5 items-center gap-3 rounded-2xl bg-[var(--card-bg)] p-3 shadow-[var(--card-shadow)] ring-1 ring-[var(--card-line)]">
            <div className="size-12 shrink-0 overflow-hidden rounded-xl bg-checkerboard [background-size:8px_8px]">
                <img src={images.kingfisherCutout.src} alt="" loading="lazy" className="size-full object-cover object-[32%_50%]" />
            </div>
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-primary">kingfisher.png</p>
                <p className="text-xs text-quaternary">PNG · 1600 × 1000</p>
            </div>
            <span className="flex size-9 items-center justify-center rounded-full bg-brand-solid text-primary_on-brand">
                <Download className="size-4" />
            </span>
        </div>
    );
}
