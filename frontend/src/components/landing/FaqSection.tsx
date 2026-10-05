import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { useInView } from "@/hooks/useInView";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";


export function FaqSection() {
    const t = useT();
    const [ref, inView] = useInView<HTMLElement>();
    const [open, setOpen] = useState<number | null>(0);
    return (
        <section ref={ref} data-inview={inView} id="faq" aria-labelledby="faq-title" className="scroll-mt-20 py-20 md:py-24">
            <div className="page-container">
                <div className="reveal card grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12 lg:p-10">
                    <div>
                        <p className="section-badge">{t.faq.badge}</p>
                        <h2 id="faq-title" className="mt-4 text-2xl font-semibold tracking-[-0.01em] text-balance text-primary">
                            {t.faq.title}
                        </h2>
                        <p className="mt-3 text-[0.9375rem] leading-relaxed text-tertiary">{t.faq.description}</p>
                    </div>
                    <div className="divide-y divide-[var(--card-line)]">
                        {t.faq.items.map((item, index) => (
                            <FaqItem key={item.q} question={item.q} answer={item.a} open={open === index} onToggle={() => setOpen(open === index ? null : index)} />
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}

function FaqItem({ question, answer, open, onToggle }: { question: string; answer: string; open: boolean; onToggle: () => void }) {
    const id = useId();
    return (
        <div>
            <h3>
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={id}
                    onClick={onToggle}
                    className="flex w-full cursor-pointer items-center justify-between gap-4 py-4 text-left text-md font-medium text-primary outline-focus-ring focus-visible:outline-2"
                >
                    {question}
                    <ChevronDown className={cn("size-4 shrink-0 text-quaternary transition-transform duration-300 ease-[var(--ease-out)]", open && "rotate-180")} aria-hidden />
                </button>
            </h3>
            {/* Height animates via grid rows, so the answer eases open and closed. */}
            <div id={id} role="region" className={cn("grid transition-[grid-template-rows,opacity] duration-400 ease-[var(--ease-out)]", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                <div className="overflow-hidden">
                    <p className="pb-5 text-[0.9375rem] leading-relaxed text-tertiary">{answer}</p>
                </div>
            </div>
        </div>
    );
}
