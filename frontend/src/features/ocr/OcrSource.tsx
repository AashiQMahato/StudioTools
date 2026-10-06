import { ChevronLeft, ChevronRight, FileStack, LoaderCircle } from "lucide-react";
import { type ComponentProps, createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { StudioNotice } from "@/components/studio/StudioParts";
import { StudioShell } from "@/components/studio/StudioShell";
import { baseName } from "@/features/image-processing/format";
import { UPLOAD_ACCEPT } from "@/lib/constants/upload";
import type { OcrDocument } from "@/lib/api/ocrApi";
import { loadDraftOcr, loadDraftOcrIds, loadDraftPdf, saveDraftOcr, saveDraftPdf } from "@/lib/draft";
import { cn } from "@/lib/utils/cn";
import { useTextImageStore } from "@/store/useImageStore";
import type { ImageFile } from "@/types/image";
import { type Dictionary, errorMessage, useT } from "@/i18n";
import { fitFontSizes, toEditorContent } from "./convert";
import { closePdf, isPdf, MAX_PDF_PAGES, openPdf, PdfError, type PdfSource, pageId, pageOf, renderPage } from "./pdf";
import type { ReadSettings } from "./settings";
import { StageList } from "./StageList";
import { useOcrJob } from "./useOcrJob";

const OCR_ACCEPT = `${UPLOAD_ACCEPT},application/pdf,.pdf`;

interface Batch {
    page: number;
    total: number;
    image: ImageFile;
}

interface OcrSourceValue {
    /** The PDF the current image is a page of (null for a plain image). */
    pdf: PdfSource | null;
    page: number | null;
    /** Pages that already have text. */
    read: ReadonlySet<number>;
    goToPage: (page: number) => void;
    /** Reads every page that has no text yet, one after another. */
    readAll: (settings: ReadSettings) => void;
    /** A page's text was saved: its mark in the pager updates. */
    refreshRead: () => void;
    batch: Batch | null;
    job: ReturnType<typeof useOcrJob>;
    cancelBatch: () => void;
    intercept: (file: File) => boolean;
    status: string | null;
    problem: string | null;
}

const OcrSourceContext = createContext<OcrSourceValue | null>(null);
export function useOcrSource() {
    const value = useContext(OcrSourceContext);
    if (!value) throw new Error("useOcrSource outside OcrSourceProvider");
    return value;
}

const pageName = (t: Dictionary, pdf: Pick<PdfSource, "name">, page: number) => t.ocr.pdf.pageName(baseName(pdf.name), page);

function pdfProblem(t: Dictionary, error: unknown) {
    const problem = error instanceof PdfError ? error.problem : "unreadable";
    return t.ocr.pdf.problems[problem];
}

/**
 * What the OCR editor is reading: an image, or a PDF whose pages are rendered here (the PDF never
 * leaves the device) and read one by one. The current page is the section's image, so every tool
 * part works on a page exactly as on a photo.
 */
export function OcrSourceProvider({ image, children }: { image: ImageFile | null; children: ReactNode }) {
    const t = useT();
    const setOriginal = useTextImageStore((state) => state.setOriginal);
    const [pdf, setPdf] = useState<PdfSource | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [read, setRead] = useState<ReadonlySet<number>>(new Set());
    const [batch, setBatch] = useState<Batch | null>(null);
    /** A short-lived confirmation (e.g. after reading all pages). */
    const [done, setDone] = useState<string | null>(null);
    const job = useOcrJob();
    const stopped = useRef(false);

    // The PDF from the last visit, if the section's image is still one of its pages.
    useEffect(() => {
        void loadDraftPdf().then((draft) => {
            if (!draft) return;
            const file = draft.file instanceof File ? draft.file : new File([draft.file], draft.name, { type: "application/pdf" });
            setPdf((current) => current ?? { id: draft.id, file, name: draft.name, pageCount: draft.pageCount });
        });
    }, []);

    const location = image ? pageOf(image.id) : null;
    const active = pdf && location?.sourceId === pdf.id ? pdf : null;
    const page = active ? location!.page : null;

    const refreshRead = useCallback(() => {
        if (!active) return;
        void loadDraftOcrIds(active.id).then((ids) => setRead(new Set(ids.map((id) => pageOf(id)?.page ?? 0))));
    }, [active]);
    useEffect(refreshRead, [refreshRead, page]);

    const showPage = useCallback(
        async (source: PdfSource, number: number) => {
            setStatus(t.ocr.pdf.rendering(number));
            try {
                // Shown the way it was read (upright), if it has been read.
                const draft = await loadDraftOcr<OcrDocument, unknown>(pageId(source.id, number));
                const rendered = await renderPage(source, number, pageName(t, source, number), draft?.result.document.rotation ?? 0);
                setPdf(source);
                setOriginal(rendered);
                return rendered;
            } finally {
                setStatus(null);
            }
        },
        [setOriginal, t],
    );

    const openFile = useCallback(
        async (file: File) => {
            setProblem(null);
            setStatus(t.ocr.pdf.opening);
            try {
                const source = await openPdf(file);
                await showPage(source, 1);
                if (pdf && pdf.id !== source.id) closePdf(pdf.id);
                void saveDraftPdf({ id: source.id, file: source.file, name: source.name, pageCount: source.pageCount });
            } catch (error) {
                setProblem(pdfProblem(t, error));
            } finally {
                setStatus(null);
            }
        },
        [pdf, showPage, t],
    );

    const intercept = useCallback(
        (file: File) => {
            if (!isPdf(file)) return false;
            void openFile(file);
            return true;
        },
        [openFile],
    );

    const goToPage = useCallback(
        (number: number) => {
            if (!active || number < 1 || number > active.pageCount || number === page) return;
            void showPage(active, number).catch((error: unknown) => setProblem(pdfProblem(t, error)));
        },
        [active, page, showPage, t],
    );

    const readAll = useCallback(
        async (settings: ReadSettings) => {
            if (!active || batch) return;
            stopped.current = false;
            setProblem(null);
            const already = new Set((await loadDraftOcrIds(active.id)).map((id) => pageOf(id)?.page ?? 0));
            const failed: number[] = [];
            const previews: string[] = [];
            let count = 0;
            const back = page ?? 1;
            for (let number = 1; number <= active.pageCount && !stopped.current; number++) {
                if (already.has(number)) continue;
                const rendered = await renderPage(active, number, pageName(t, active, number)).catch(() => null);
                if (!rendered) {
                    failed.push(number);
                    continue;
                }
                previews.push(rendered.previewUrl);
                setBatch({ page: number, total: active.pageCount, image: rendered });
                const result = await job.run(rendered.file, rendered.file.name, { language: settings.language, region: null, preserveLayout: settings.detectLayout });
                if (stopped.current) break;
                if (!result) {
                    failed.push(number);
                    continue;
                }
                const fitted = await fitFontSizes(result);
                await saveDraftOcr({ imageId: pageId(active.id, number), sourceId: active.id, result: fitted, content: toEditorContent(fitted), settings: { ...settings, tool: "full", region: null } });
                count++;
            }
            setBatch(null);
            // Freed only now: each was on screen until the next page replaced it.
            window.setTimeout(() => previews.forEach((url) => URL.revokeObjectURL(url)), 1000);
            job.reset();
            // Back to the page you were on — now showing its text if it was read just now.
            await showPage(active, back).catch(() => undefined);
            refreshRead();
            if (stopped.current) return;
            if (failed.length) setProblem(t.ocr.pdf.readAllPartial(count, failed.join(", ")));
            else setDone(t.ocr.pdf.readAllDone(count));
        },
        [active, batch, job, page, refreshRead, showPage, t],
    );
    useEffect(() => {
        if (!done) return;
        const timer = window.setTimeout(() => setDone(null), 6000);
        return () => window.clearTimeout(timer);
    }, [done]);

    const cancelBatch = useCallback(() => {
        stopped.current = true;
        job.cancel();
    }, [job]);

    const value = useMemo<OcrSourceValue>(
        () => ({ pdf: active, page, read, goToPage, readAll: (settings) => void readAll(settings), refreshRead, batch, job, cancelBatch, intercept, status: status ?? done, problem: problem ?? (batch && job.status === "error" ? errorMessage(t, job.error) : null) }),
        [active, page, read, goToPage, readAll, refreshRead, batch, job, cancelBatch, intercept, status, done, problem, t],
    );
    return <OcrSourceContext.Provider value={value}>{children}</OcrSourceContext.Provider>;
}

/** The studio frame for the OCR editor: it also takes PDFs, and says what's happening to one. */
export function OcrShell({ children, ...props }: Omit<ComponentProps<typeof StudioShell>, "tool" | "interceptFile" | "accept">) {
    const source = useOcrSource();
    return (
        <StudioShell tool="ocr" interceptFile={source.intercept} accept={OCR_ACCEPT} hasWork={source.pdf ? true : undefined} {...props}>
            {children}
            {source.problem && <StudioNotice notice={{ tone: "error", text: source.problem }} />}
            {source.status && !source.problem && <StudioNotice notice={{ tone: "info", text: source.status }} />}
        </StudioShell>
    );
}

/** Moving between a PDF's pages, which of them have text, and reading them all at once. */
export function PdfPager({ settings, disabled }: { settings: ReadSettings; disabled?: boolean }) {
    const t = useT();
    const copy = t.ocr.pdf;
    const { pdf, page, read, goToPage, readAll, batch } = useOcrSource();
    if (!pdf || page === null) return null;
    const busy = disabled || Boolean(batch);
    const remaining = pdf.pageCount - read.size;
    const button =
        "grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-secondary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-35 pointer-coarse:size-11";
    return (
        <nav aria-label={copy.pages} className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--card-line)] bg-primary px-2 py-1.5">
            <div className="flex min-w-0 items-center gap-1">
                <FileStack className="mx-1 size-4 shrink-0 text-tertiary" aria-hidden />
                <button type="button" className={button} onClick={() => goToPage(page - 1)} disabled={busy || page <= 1} aria-label={copy.previous} title={copy.previous}>
                    <ChevronLeft className="size-4" aria-hidden />
                </button>
                <label className="flex items-center gap-1.5 text-sm text-secondary">
                    <span className="sr-only">{copy.pageLabel}</span>
                    <select
                        value={page}
                        disabled={busy}
                        onChange={(event) => goToPage(Number(event.target.value))}
                        className="h-9 cursor-pointer rounded-lg border border-[var(--card-line)] bg-primary px-2 text-sm text-primary tabular-nums outline-focus-ring focus-visible:outline-2 disabled:opacity-50 pointer-coarse:h-11"
                    >
                        {Array.from({ length: pdf.pageCount }, (_, index) => index + 1).map((number) => (
                            <option key={number} value={number}>
                                {read.has(number) ? `${copy.pageOption(number)} ✓` : copy.pageOption(number)}
                            </option>
                        ))}
                    </select>
                    <span className="tabular-nums">{copy.of(pdf.pageCount)}</span>
                </label>
                <button type="button" className={button} onClick={() => goToPage(page + 1)} disabled={busy || page >= pdf.pageCount} aria-label={copy.next} title={copy.next}>
                    <ChevronRight className="size-4" aria-hidden />
                </button>
            </div>
            {pdf.pageCount > 1 && (
                <button
                    type="button"
                    onClick={() => readAll(settings)}
                    disabled={busy || remaining === 0}
                    title={remaining === 0 ? copy.allRead : copy.readAllHint}
                    className={cn("flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--card-line)] px-3 text-sm font-medium text-secondary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:h-11")}
                >
                    {batch && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
                    {remaining === 0 ? copy.allRead : copy.readAll(remaining)}
                </button>
            )}
            {pdf.pageCount >= MAX_PDF_PAGES && <p className="w-full px-1 text-xs text-tertiary">{copy.truncated(MAX_PDF_PAGES)}</p>}
        </nav>
    );
}

/** "Read all pages" at work: the page being read, and its stages as the server reports them. */
export function BatchProgress() {
    const t = useT();
    const { batch, job, cancelBatch } = useOcrSource();
    if (!batch) return null;
    return (
        <div className="flex flex-col gap-2">
            <p className="px-1 text-sm font-medium text-primary" aria-live="polite">
                {t.ocr.pdf.readingPage(batch.page, batch.total)}
            </p>
            <StageList stages={job.stages} startedAt={job.startedAt} onCancel={cancelBatch} />
        </div>
    );
}
