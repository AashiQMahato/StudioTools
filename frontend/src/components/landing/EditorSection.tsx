import { Check } from "lucide-react";
import { useInView } from "@/hooks/useInView";
import { ROUTES } from "@/lib/constants/routes";
import { MiniEditor } from "./MiniEditor";
import { OutlineLink } from "./OutlineLink";
import { useT } from "@/i18n";


/** A split panel, like the reference's pricing card: the story on the left, the live tool on the right. */
export function EditorSection() {
    const t = useT();
    const [ref, inView] = useInView<HTMLElement>({ rootMargin: "0px 0px -20% 0px" });

    return (
        <section ref={ref} data-inview={inView} aria-labelledby="editor-title" className="py-20 md:py-24">
            <div className="page-container">
                <div className="reveal card grid items-center gap-10 bg-tertiary shadow-none p-6 sm:p-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12 lg:p-12">
                    <div>
                        <p className="section-badge">{t.editorSection.badge}</p>
                        <h2 id="editor-title" className="mt-4 text-section text-balance text-primary">
                            {t.editorSection.title}
                        </h2>
                        <p className="mt-4 text-lead text-tertiary">
                            {t.editorSection.description}
                        </p>
                        <ul className="card mt-7 grid gap-3 p-5 shadow-none sm:grid-cols-2">
                            {t.editorSection.features.map((feature) => (
                                <li key={feature} className="flex items-start gap-2.5 text-[0.9375rem] text-secondary">
                                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
                                        <Check className="size-3" strokeWidth={3} aria-hidden />
                                    </span>
                                    {feature}
                                </li>
                            ))}
                        </ul>
                        <div className="mt-7 flex flex-wrap gap-3">
                            <OutlineLink to={ROUTES.crop}>{t.editorSection.openCropper}</OutlineLink>
                            <OutlineLink to={ROUTES.editor}>{t.editorSection.openEditor}</OutlineLink>
                        </div>
                    </div>
                    <div className="min-w-0">
                        <MiniEditor play={inView} />
                    </div>
                </div>
            </div>
        </section>
    );
}
