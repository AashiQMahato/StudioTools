import { Copy, FileDown, FilePenLine, FileText, FileType2, ImageDown, Info, LoaderCircle, Printer } from "lucide-react";
import type { ReactNode } from "react";
import { Segmented } from "@/components/common/Segmented";
import { Range } from "@/features/background-removal/editor/RefinePanel";
import type { OcrDocument, OcrLanguage } from "@/lib/api/ocrApi";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";
import type { EditorMode } from "./convert";
import type { ReadSettings, RegionTool } from "./settings";

function PanelSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
    return (
        <section className={cn("flex flex-col gap-3", className)}>
            <h3 className="text-sm font-semibold text-primary">{title}</h3>
            {children}
        </section>
    );
}

function Checkbox({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string }) {
    return (
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-secondary">
            <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" />
            <span>
                {label}
                {hint && <span className="mt-0.5 block text-xs text-tertiary">{hint}</span>}
            </span>
        </label>
    );
}

/** Language, the area to read, and layout detection — before the first reading and for reading again. */
export function ReadSettingsPanel({ settings, onChange, disabled }: { settings: ReadSettings; onChange: (settings: ReadSettings) => void; disabled?: boolean }) {
    const copy = useT().ocr;
    const set = (patch: Partial<ReadSettings>) => onChange({ ...settings, ...patch });
    return (
        <>
            <PanelSection title={copy.languageLabel}>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={copy.languageLabel}>
                    {(Object.keys(copy.languages) as OcrLanguage[]).map((language) => {
                        const selected = settings.language === language;
                        return (
                            <button
                                key={language}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                disabled={disabled}
                                onClick={() => set({ language })}
                                className={cn(
                                    "min-h-11 cursor-pointer rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors duration-150 outline-focus-ring focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50",
                                    selected ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]" : "border-[var(--card-line)] text-secondary hover:bg-primary_hover hover:text-primary",
                                )}
                            >
                                {copy.languages[language]}
                            </button>
                        );
                    })}
                </div>
                <p className="text-xs text-tertiary">{copy.languageHint}</p>
            </PanelSection>

            <PanelSection title={copy.regionLabel}>
                <Segmented
                    label={copy.regionLabel}
                    value={settings.tool}
                    onChange={(tool) => set({ tool, region: tool === settings.tool ? settings.region : null })}
                    options={(Object.keys(copy.regions) as RegionTool[]).map((tool) => ({ value: tool, label: copy.regions[tool], disabled }))}
                    scrollable
                />
                <p className="text-xs text-tertiary">{settings.tool !== "full" && settings.region ? copy.regionSet : copy.regionHints[settings.tool]}</p>
                {settings.tool !== "full" && settings.region && (
                    <button type="button" onClick={() => set({ region: null })} className="self-start text-sm font-medium text-[var(--brand)] underline-offset-4 outline-focus-ring hover:underline focus-visible:outline-2">
                        {copy.clearRegion}
                    </button>
                )}
            </PanelSection>

            <Checkbox checked={settings.detectLayout} onChange={(detectLayout) => set({ detectLayout })} label={copy.detectLayout} hint={copy.detectLayoutHint} />
        </>
    );
}

/** How the text is shown and checked. */
export function EditPanel({
    mode,
    onMode,
    overlay,
    onOverlay,
    showUncertain,
    onShowUncertain,
    uncertainCount,
    onNextUncertain,
    spellcheck,
    onSpellcheck,
    result,
}: {
    mode: EditorMode;
    onMode: (mode: EditorMode) => void;
    overlay: number | null;
    onOverlay: (value: number | null) => void;
    showUncertain: boolean;
    onShowUncertain: (value: boolean) => void;
    uncertainCount: number;
    onNextUncertain: () => void;
    spellcheck: boolean;
    onSpellcheck: (value: boolean) => void;
    result: OcrDocument;
}) {
    const copy = useT().ocr;
    const { stats } = result;
    return (
        <>
            <PanelSection title={copy.modeLabel}>
                <Segmented label={copy.modeLabel} value={mode} onChange={onMode} options={(["document", "layout"] as const).map((value) => ({ value, label: copy.modes[value] }))} />
                <p className="text-xs text-tertiary">{copy.modeHints[mode]}</p>
                {mode === "layout" && (
                    <div className="animate-enter flex flex-col gap-3 [--i:-1]">
                        <Checkbox checked={overlay !== null} onChange={(on) => onOverlay(on ? 0.5 : null)} label={copy.overlay} />
                        {overlay !== null && <Range label={copy.overlayOpacity} value={Math.round(overlay * 100)} min={10} max={100} onChange={(value) => onOverlay(value / 100)} format={(value) => `${value}%`} />}
                    </div>
                )}
            </PanelSection>

            <PanelSection title={copy.uncertain.count(uncertainCount)}>
                <Checkbox checked={showUncertain} onChange={onShowUncertain} label={copy.uncertain.toggle} hint={copy.uncertain.hint} />
                {uncertainCount > 0 && (
                    <button type="button" onClick={onNextUncertain} className="h-10 cursor-pointer self-start rounded-lg border border-[var(--card-line)] px-3 text-sm font-medium text-secondary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 pointer-coarse:h-11">
                        {copy.uncertain.next}
                    </button>
                )}
                <Checkbox checked={spellcheck} onChange={onSpellcheck} label={copy.spellcheck} hint={copy.spellcheckHint} />
            </PanelSection>

            <PanelSection title={copy.stats.title}>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-secondary p-3 text-sm">
                    <Stat label={copy.stats.language} value={copy.detected[result.language] ?? result.language} />
                    <Stat label={copy.stats.confidence} value={`${Math.round(stats.averageConfidence * 100)}%`} />
                    <Stat label={copy.stats.blocks} value={String(stats.blocks)} />
                    <Stat label={copy.stats.words} value={String(stats.words)} />
                    <Stat label={copy.stats.layout} value={result.engine.layout === "model" ? copy.stats.layoutModel : copy.stats.layoutGeometry} />
                </dl>
                <p className="flex gap-2 text-xs text-tertiary">
                    <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                    {copy.estimated}
                </p>
            </PanelSection>
        </>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0">
            <dt className="text-xs text-tertiary">{label}</dt>
            <dd className="truncate font-medium text-primary tabular-nums">{value}</dd>
        </div>
    );
}

export type ExportKind = "copy" | "txt" | "docx" | "pdf" | "png" | "jpeg" | "webp" | "editor";

/** Every way out: copy, text, Word, PDF, and the edited text drawn onto the image. */
export function ExportPanel({ busy, onExport, scope, onScope }: { busy: ExportKind | null; onExport: (kind: ExportKind) => void; scope: "page" | "all" | null; onScope: (scope: "page" | "all") => void }) {
    const t = useT();
    const copy = t.ocr.export;
    const item = (kind: ExportKind, icon: ReactNode, label: string, hint?: string) => (
        <button
            key={kind}
            type="button"
            disabled={busy !== null}
            onClick={() => onExport(kind)}
            className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl border border-[var(--card-line)] px-3 py-2 text-left outline-focus-ring transition-colors duration-150 hover:bg-primary_hover focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-secondary">{busy === kind ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : icon}</span>
            <span className="min-w-0">
                <span className="block text-sm font-semibold text-primary">{label}</span>
                {hint && <span className="block text-xs text-tertiary">{hint}</span>}
            </span>
        </button>
    );
    return (
        <PanelSection title={copy.title}>
            {scope && (
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-secondary">{t.ocr.pdf.scope}</span>
                    <Segmented label={t.ocr.pdf.scope} value={scope} onChange={onScope} options={(["page", "all"] as const).map((value) => ({ value, label: t.ocr.pdf.scopes[value] }))} />
                </div>
            )}
            {item("editor", <FilePenLine className="size-4" aria-hidden />, copy.editor, copy.editorHint)}
            {item("copy", <Copy className="size-4" aria-hidden />, copy.copy)}
            <div className="grid grid-cols-3 gap-2">
                {(
                    [
                        ["txt", FileText, copy.txt, ".txt"],
                        ["docx", FileType2, copy.docx, ".docx"],
                        ["pdf", Printer, copy.pdf, ".pdf"],
                    ] as const
                ).map(([kind, Icon, label, extension]) => (
                    <button
                        key={kind}
                        type="button"
                        disabled={busy !== null}
                        onClick={() => onExport(kind)}
                        title={kind === "pdf" ? copy.pdfHint : undefined}
                        className="flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-[var(--card-line)] px-2 py-2 outline-focus-ring transition-colors duration-150 hover:bg-primary_hover focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {busy === kind ? <LoaderCircle className="size-4 animate-spin text-secondary motion-reduce:animate-none" aria-hidden /> : <Icon className="size-4 text-secondary" aria-hidden />}
                        <span className="text-sm font-semibold text-primary">{label}</span>
                        <span className="text-[0.6875rem] text-quaternary">{extension}</span>
                    </button>
                ))}
            </div>
            <p className="text-xs text-tertiary">{copy.pdfHint}</p>
            {item("png", <ImageDown className="size-4" aria-hidden />, copy.png, copy.imageHint)}
            {item("jpeg", <FileDown className="size-4" aria-hidden />, copy.jpeg)}
        </PanelSection>
    );
}
