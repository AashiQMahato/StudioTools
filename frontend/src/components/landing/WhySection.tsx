import { FileImage, ShieldCheck, Timer } from "lucide-react";
import type { CSSProperties } from "react";
import { HUES } from "@/components/layout/toolRegistry";
import { useInView } from "@/hooks/useInView";
import { SectionHeading } from "./SectionHeading";
import { useT } from "@/i18n";

const ICONS = [Timer, ShieldCheck, FileImage];
const TONES = [HUES.indigo, HUES.green, HUES.violet];

export function WhySection() {
    const t = useT();
    const [ref, inView] = useInView<HTMLElement>();
    return (
        <section id="features" ref={ref} data-inview={inView} aria-labelledby="why-title" className="scroll-mt-20 py-20 md:py-24">
            <div className="page-container">
                <SectionHeading
                    id="why-title"
                    badge={t.why.badge}
                    title={t.why.title}
                    description={t.why.description}
                />
                <div className="mt-12 grid gap-4 md:mt-14 md:grid-cols-3 lg:gap-5">
                    {t.why.items.map(({ title, description }, index) => {
                        const Icon = ICONS[index] ?? Timer;
                        return (
                        <div key={title} className="reveal card p-7 sm:p-8" style={{ "--i": index + 3, "--accent": TONES[index] } as CSSProperties}>
                            <span className="flex size-11 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]">
                                <Icon className="size-5.5" aria-hidden />
                            </span>
                            <h3 className="mt-6 text-xl font-semibold text-primary">{title}</h3>
                            <p className="mt-2 text-[0.9375rem] leading-relaxed text-tertiary">{description}</p>
                        </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
