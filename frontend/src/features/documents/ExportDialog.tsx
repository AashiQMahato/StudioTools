import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Segmented } from "@/components/common/Segmented";
import { Button } from "@/components/ui/base/buttons/button";
import { Range } from "@/features/background-removal/editor/RefinePanel";
import { cn } from "@/lib/utils/cn";
import { cleanFileName } from "@/lib/utils/fileName";
import { useT } from "@/i18n";
import { PageRangeInput } from "./PageRangeInput";
import { parsePageRanges } from "./pageRanges";

export interface ExportFormat<F extends string> {
    value: F;
    label: string;
    extension: string;
    hint?: string;
    /** The format has a quality setting (JPG, WebP). */
    quality?: boolean;
    /** Printing, not a download (the browser's Save as PDF). */
    prints?: boolean;
}

export interface ExportRequest<F extends string> {
    format: F;
    /** The file name, extension included — cleaned of characters file systems refuse. */
    fileName: string;
    /** The name without its extension (a printed PDF's title). */
    baseName: string;
    /** 0–1, for formats with a quality setting. */
    quality: number;
    /** 1-based pages to include, or null for all. */
    pages: number[] | null;
}

interface ExportDialogProps<F extends string> {
    open: boolean;
    onClose: () => void;
    title: string;
    formats: readonly ExportFormat<F>[];
    initialFormat?: F;
    /** The suggested name, without extension. */
    name: string;
    /** Offer a page range (documents with more than one page). */
    pageCount?: number;
    /** Resolves when done; a thrown error is shown in the dialog. */
    onExport: (request: ExportRequest<F>) => Promise<void> | void;
    /** Extra options for this export. */
    children?: ReactNode;
}


/**
 * One way to export everywhere: the format, its quality where it has one, which pages, and the file
 * name — then the download (or, for PDF from text, the print dialog's Save as PDF).
 */
export function ExportDialog<F extends string>(props: ExportDialogProps<F>) {
    const { open, onClose } = props;
    const dialog = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    const busy = useRef(false);

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        if (open && !element.open) element.showModal();
        else if (!open && element.open) element.close();
    }, [open]);

    return (
        <dialog
            ref={dialog}
            aria-labelledby={titleId}
            onClose={onClose}
            onClick={(event) => event.target === dialog.current && !busy.current && onClose()}
            className="studio-dialog glass-strong m-auto w-[min(30rem,calc(100vw-1.5rem))] rounded-[1.375rem] p-0 text-primary backdrop:bg-[rgb(17_19_24/0.32)] backdrop:backdrop-blur-[2px]"
        >
            {/* Mounted afresh for each opening: it starts from what the caller suggests. */}
            {open && <ExportForm {...props} titleId={titleId} busyRef={busy} />}
        </dialog>
    );
}

function ExportForm<F extends string>({ onClose, title, formats, initialFormat, name, pageCount = 1, onExport, children, titleId, busyRef }: ExportDialogProps<F> & { titleId: string; busyRef: { current: boolean } }) {
    const t = useT();
    const copy = t.documents.exportDialog;
    const nameId = useId();
    const [format, setFormat] = useState<F>(initialFormat ?? formats[0]!.value);
    const [baseName, setBaseName] = useState(name);
    const [quality, setQuality] = useState(90);
    const [scope, setScope] = useState<"all" | "range">("all");
    const [range, setRange] = useState("");
    const [busy, setBusyState] = useState(false);
    const [failed, setFailed] = useState<string | null>(null);
    const setBusy = (value: boolean) => {
        busyRef.current = value;
        setBusyState(value);
    };

    const chosen = formats.find((item) => item.value === format) ?? formats[0]!;
    const parsed = scope === "range" ? parsePageRanges(range, pageCount) : null;
    const invalid = parsed !== null && !parsed.ok;
    const clean = cleanFileName(baseName);

    const submit = async () => {
        if (invalid || busy) return;
        setBusy(true);
        setFailed(null);
        try {
            await onExport({ format, fileName: `${clean}.${chosen.extension}`, baseName: clean, quality: quality / 100, pages: parsed?.ok ? parsed.pages : null });
            onClose();
        } catch (error) {
            setFailed(error instanceof Error && error.message ? error.message : t.ocr.export.failed);
        } finally {
            setBusy(false);
        }
    };

    return (
        <form
            method="dialog"
            className="flex flex-col gap-5 p-4 sm:p-5"
            onSubmit={(event) => {
                event.preventDefault();
                void submit();
            }}
        >
            <div className="flex items-center justify-between gap-3">
                <h2 id={titleId} className="text-md font-semibold text-primary">
                    {title}
                </h2>
                <button type="button" onClick={onClose} aria-label={copy.close} className="grid size-9 cursor-pointer place-items-center rounded-lg text-tertiary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2">
                    <X className="size-4" aria-hidden />
                </button>
            </div>

            {formats.length > 1 && (
                <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-xs font-medium text-secondary">{copy.format}</legend>
                    <div role="radiogroup" aria-label={copy.format} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {formats.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                role="radio"
                                aria-checked={format === item.value}
                                onClick={() => setFormat(item.value)}
                                className={cn(
                                    "flex min-h-14 cursor-pointer flex-col items-start justify-center rounded-xl border px-3 py-2 text-left outline-focus-ring transition-colors duration-150 focus-visible:outline-2",
                                    format === item.value ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--card-line)] hover:bg-primary_hover",
                                )}
                            >
                                <span className={cn("text-sm font-semibold", format === item.value ? "text-[var(--brand)]" : "text-primary")}>{item.label}</span>
                                <span className="text-xs text-tertiary">.{item.extension}</span>
                            </button>
                        ))}
                    </div>
                    {chosen.hint && <p className="text-xs text-tertiary">{chosen.hint}</p>}
                </fieldset>
            )}

            {chosen.quality && <Range label={copy.quality} value={quality} min={40} max={100} onChange={setQuality} format={(value) => `${value}%`} />}

            {pageCount > 1 && (
                <div className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-secondary">{copy.pages}</span>
                    <Segmented
                        label={copy.pages}
                        value={scope}
                        onChange={setScope}
                        options={[
                            { value: "all", label: copy.allPages(pageCount) },
                            { value: "range", label: copy.somePages },
                        ]}
                    />
                    {scope === "range" && <PageRangeInput value={range} onChange={setRange} count={pageCount} label={copy.whichPages} />}
                </div>
            )}

            {children}

            <div className="flex flex-col gap-1.5">
                <label htmlFor={nameId} className="text-xs font-medium text-secondary">
                    {copy.fileName}
                </label>
                <div className="flex items-center rounded-lg border border-[var(--card-line)] bg-primary outline-focus-ring focus-within:outline-2">
                    <input
                        id={nameId}
                        value={baseName}
                        maxLength={120}
                        spellCheck={false}
                        onChange={(event) => setBaseName(event.target.value)}
                        onFocus={(event) => event.target.select()}
                        className="h-10 min-w-0 flex-1 rounded-l-lg bg-transparent px-3 text-sm text-primary outline-none pointer-coarse:h-11"
                    />
                    <span className="shrink-0 pr-3 text-sm text-tertiary">.{chosen.extension}</span>
                </div>
                {clean !== baseName.trim() && baseName.trim() && <p className="text-xs text-tertiary">{copy.savedAs(`${clean}.${chosen.extension}`)}</p>}
            </div>

            {failed && (
                <p role="alert" className="text-xs text-error-primary">
                    {failed}
                </p>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button size="md" color="secondary" onPress={onClose} isDisabled={busy}>
                    {t.common.cancel}
                </Button>
                <Button type="submit" size="md" color="primary" isDisabled={invalid} isLoading={busy} showTextWhileLoading>
                    {chosen.prints ? copy.print : copy.download}
                </Button>
            </div>
        </form>
    );
}
