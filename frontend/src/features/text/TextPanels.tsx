import { Check, Copy, FileCode2, FileDown, FileText, LoaderCircle, Printer } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/base/buttons/button";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";
import { CASE_MODES, type CaseMode, convertCase } from "./caseConvert";
import { CLEAN_RULES, type CleanCounts, type CleanRule } from "./cleaner";
import type { TextStats } from "./stats";

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-primary">{title}</h3>
            {children}
        </section>
    );
}

/** What to clean, a preview of the result, and applying it (one undo step). */
export function CleanPanel({ rules, onRules, counts, previewing, onPreview, onApply, onCancel }: { rules: ReadonlySet<CleanRule>; onRules: (rules: Set<CleanRule>) => void; counts: CleanCounts | null; previewing: boolean; onPreview: () => void; onApply: () => void; onCancel: () => void }) {
    const copy = useT().text.clean;
    const total = counts ? Object.values(counts).reduce((sum, count) => sum + count, 0) : 0;
    return (
        <>
            <Section title={copy.title}>
                <ul className="flex flex-col gap-2.5">
                    {CLEAN_RULES.map((rule) => (
                        <li key={rule}>
                            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-secondary">
                                <input
                                    type="checkbox"
                                    checked={rules.has(rule)}
                                    onChange={(event) => {
                                        const next = new Set(rules);
                                        if (event.target.checked) next.add(rule);
                                        else next.delete(rule);
                                        onRules(next);
                                    }}
                                    className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center justify-between gap-2">
                                        {copy.rules[rule].title}
                                        {previewing && counts && <span className={cn("text-xs tabular-nums", counts[rule] ? "font-semibold text-[var(--brand)]" : "text-quaternary")}>{counts[rule]}</span>}
                                    </span>
                                </span>
                            </label>
                        </li>
                    ))}
                </ul>
            </Section>
            {previewing ? (
                <div className="flex flex-col gap-2">
                    <p className="text-sm text-secondary" role="status">
                        {total ? copy.found(total) : copy.nothing}
                    </p>
                    <div className="flex gap-2">
                        <Button size="md" color="secondary" onPress={onCancel} className="flex-1">
                            {copy.cancel}
                        </Button>
                        <Button size="md" color="primary" iconLeading={Check} onPress={onApply} isDisabled={!total} className="flex-1">
                            {copy.apply}
                        </Button>
                    </div>
                </div>
            ) : (
                <Button size="lg" color="primary" onPress={onPreview} isDisabled={!rules.size}>
                    {copy.preview}
                </Button>
            )}
            <p className="text-xs text-tertiary">{copy.keeps}</p>
        </>
    );
}

/** Case changes for the selection (or everything), each shown on your own text first. */
export function CasePanel({ sample, target, onApply }: { sample: string; target: "selection" | "document"; onApply: (mode: CaseMode) => void }) {
    const t = useT();
    const copy = t.text.case;
    return (
        <Section title={copy.title}>
            <p className="text-xs text-tertiary">{target === "selection" ? copy.selection : copy.document}</p>
            <ul className="flex flex-col gap-2">
                {CASE_MODES.map((mode) => (
                    <li key={mode}>
                        <button
                            type="button"
                            onClick={() => onApply(mode)}
                            className="flex w-full cursor-pointer flex-col gap-0.5 rounded-xl border border-[var(--card-line)] px-3 py-2 text-left outline-focus-ring transition-colors duration-150 hover:border-[var(--brand)] hover:bg-[var(--brand-soft)] focus-visible:outline-2"
                        >
                            <span className="text-sm font-semibold text-primary">{copy.modes[mode]}</span>
                            <span className="truncate text-xs text-tertiary">{convertCase(sample || copy.sample, mode, t.meta.lang)}</span>
                        </button>
                    </li>
                ))}
            </ul>
            <p className="text-xs text-tertiary">{copy.note}</p>
        </Section>
    );
}

/** Counts for the document, and for the selection when there is one. */
export function StatsPanel({ stats, selection }: { stats: TextStats; selection: TextStats | null }) {
    const copy = useT().text.stats;
    const rows = (value: TextStats) =>
        [
            ["words", value.words],
            ["characters", value.characters],
            ["charactersNoSpaces", value.charactersNoSpaces],
            ["sentences", value.sentences],
            ["paragraphs", value.paragraphs],
            ["lines", value.lines],
        ] as const;
    const grid = (value: TextStats) => (
        <dl className="grid grid-cols-2 gap-2">
            {rows(value).map(([key, number]) => (
                <div key={key} className="rounded-xl bg-secondary px-3 py-2">
                    <dt className="text-xs text-tertiary">{copy[key]}</dt>
                    <dd className="text-lg font-semibold text-primary tabular-nums">{number.toLocaleString()}</dd>
                </div>
            ))}
            <div className="col-span-2 rounded-xl bg-secondary px-3 py-2">
                <dt className="text-xs text-tertiary">{copy.reading}</dt>
                <dd className="text-lg font-semibold text-primary tabular-nums">{copy.minutes(value.readingMinutes)}</dd>
            </div>
        </dl>
    );
    return (
        <>
            <Section title={copy.document}>{grid(stats)}</Section>
            {selection && <Section title={copy.selection}>{grid(selection)}</Section>}
            <p className="text-xs text-tertiary">{copy.note}</p>
        </>
    );
}

export type TextExport = "copy" | "txt" | "docx" | "pdf" | "html";

export function ExportList({ busy, onExport }: { busy: TextExport | null; onExport: (kind: TextExport) => void }) {
    const copy = useT().text.export;
    const items: [TextExport, typeof Copy, string, string][] = [
        ["copy", Copy, copy.copy, ""],
        ["txt", FileText, copy.txt, ".txt"],
        ["docx", FileDown, copy.docx, ".docx"],
        ["pdf", Printer, copy.pdf, ".pdf"],
        ["html", FileCode2, copy.html, ".html"],
    ];
    return (
        <Section title={copy.title}>
            <ul className="flex flex-col gap-2">
                {items.map(([kind, Icon, label, hint]) => (
                    <li key={kind}>
                        <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => onExport(kind)}
                            className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl border border-[var(--card-line)] px-3 py-2 text-left outline-focus-ring transition-colors duration-150 hover:bg-primary_hover focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-secondary">{busy === kind ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Icon className="size-4" aria-hidden />}</span>
                            <span className="min-w-0">
                                <span className="block text-sm font-semibold text-primary">{label}</span>
                                {hint && <span className="block text-xs text-tertiary">{hint}</span>}
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </Section>
    );
}
