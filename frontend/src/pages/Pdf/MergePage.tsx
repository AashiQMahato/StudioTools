import { Combine } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useOpenDocuments } from "@/store/useOpenDocuments";
import { DocumentToolLayout } from "@/features/documents/DocumentToolLayout";
import { MAX_FILES, MAX_PDF_MB, PDF_ACCEPT } from "@/features/documents/limits";
import { PdfCover } from "@/features/documents/PdfCover";
import { SortableCards } from "@/features/documents/SortableCards";
import { useDocumentJob } from "@/features/documents/useDocumentJob";
import { type PdfPreview, usePdfFile } from "@/features/documents/usePdfFile";
import { formatBytes } from "@/features/image-processing/format";
import { closePdfDocument, isPdfFile } from "@/lib/pdf/pdfjs";
import { useT } from "@/i18n";

interface Entry {
    id: string;
    file: File;
}

/** Each PDF's preview, reported up so the page can count pages and spot unreadable files. */
function PreviewProbe({ entry, onPreview }: { entry: Entry; onPreview: (id: string, preview: PdfPreview | null) => void }) {
    const preview = usePdfFile(entry.file);
    useEffect(() => onPreview(entry.id, preview), [entry.id, preview, onPreview]);
    return null;
}

export function MergePage() {
    const t = useT();
    const copy = t.documents.merge;
    const job = useDocumentJob();
    const [entries, setEntries] = useState<Entry[]>([]);
    const [previews, setPreviews] = useState<Record<string, PdfPreview | null>>({});
    const [notice, setNotice] = useState<string | null>(null);

    const onPreview = useCallback((id: string, preview: PdfPreview | null) => setPreviews((current) => (current[id] === preview ? current : { ...current, [id]: preview })), []);

    // Known to Organize PDF's mode bar, so switching mode keeps them open.
    useEffect(() => {
        useOpenDocuments.getState().set(entries.map((entry) => entry.file));
        return () => useOpenDocuments.getState().set([]);
    }, [entries]);

    const receive = (files: File[]) => {
        const pdfs = files.filter(isPdfFile);
        const tooBig = pdfs.filter((file) => file.size > MAX_PDF_MB * 1024 * 1024);
        const room = MAX_FILES - entries.length;
        const accepted = pdfs.filter((file) => !tooBig.includes(file)).slice(0, Math.max(0, room));
        setEntries((current) => [...current, ...accepted.map((file) => ({ id: crypto.randomUUID(), file }))]);
        setNotice(pdfs.length < files.length ? t.documents.errors.notPdf : tooBig.length ? t.documents.errors.tooLarge(MAX_PDF_MB) : accepted.length < pdfs.length ? t.documents.tooMany(MAX_FILES) : null);
    };
    const remove = (entry: Entry) => {
        closePdfDocument(entry.file);
        setEntries((current) => current.filter((item) => item.id !== entry.id));
    };
    const startOver = () => {
        job.reset();
        entries.forEach((entry) => closePdfDocument(entry.file));
        setEntries([]);
        setNotice(null);
    };

    const problemOf = (entry: Entry) => {
        const preview = previews[entry.id];
        return preview?.status === "error" ? t.documents.errors[preview.problem] : null;
    };
    const pages = entries.reduce((sum, entry) => {
        const preview = previews[entry.id];
        return sum + (preview?.status === "ready" ? preview.sizes.length : 0);
    }, 0);
    const blocked = entries.some((entry) => problemOf(entry));

    const merge = () => {
        const form = new FormData();
        for (const entry of entries) form.append("files", entry.file, entry.file.name);
        void job.run("/pdf/merge", form);
    };

    return (
        <DocumentToolLayout
            tool="pdfMerge"
            accept={PDF_ACCEPT}
            onFiles={receive}
            empty={entries.length === 0}
            drop={{ title: t.documents.dropPdfs, hint: copy.hint, limits: t.documents.pdfLimits(MAX_PDF_MB) }}
            intro={copy.steps}
            job={job}
            runningTitle={copy.running}
            doneTitle={copy.done}
            onStartOver={startOver}
            notice={notice ? { tone: "error", text: notice } : entries.length === 1 ? { tone: "info", text: copy.needTwo } : blocked ? { tone: "error", text: copy.removeProblem } : null}
            options={
                <section className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold text-primary">{copy.summaryTitle}</h3>
                    <p className="text-sm text-secondary tabular-nums">{copy.summary(entries.length, pages)}</p>
                    <p className="text-xs text-tertiary">{copy.orderHint}</p>
                </section>
            }
            many
            action={{ label: copy.action, icon: Combine, onPress: merge, disabled: entries.length < 2 || blocked }}
        >
            {entries.map((entry) => (
                <PreviewProbe key={entry.id} entry={entry} onPreview={onPreview} />
            ))}
            <SortableCards
                items={entries}
                getId={(entry) => entry.id}
                onReorder={setEntries}
                onRemove={remove}
                label={copy.listLabel}
                name={(entry) => entry.file.name}
                problem={problemOf}
                meta={(entry) => {
                    const preview = previews[entry.id];
                    return preview?.status === "ready" ? `${t.documents.result.pages(preview.sizes.length)} · ${formatBytes(entry.file.size)}` : formatBytes(entry.file.size);
                }}
                thumbnail={(entry) => <PdfCover preview={previews[entry.id] ?? null} label={entry.file.name} />}
            />
        </DocumentToolLayout>
    );
}
