import { Archive, Check, Download, FilePen, FileImage, FileText, LoaderCircle, RotateCcw, ShieldCheck, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/base/buttons/button";
import { formatBytes } from "@/features/image-processing/format";
import { saveBlob } from "@/features/pdf-canvas/fileActions";
import { fetchJobArchive, fetchJobFile, type Job, jobArchiveUrl, jobFileUrl } from "@/lib/api/jobsApi";
import type { ToolKey } from "@/lib/constants/navigation";
import { cn } from "@/lib/utils/cn";
import { downloadBlob, downloadFile } from "@/lib/utils/download";
import { useT } from "@/i18n";
import { ContinueWith } from "./ContinueWith";
import { jobFiles, jobHandoffKind } from "./handoff";
import { ExportDialog } from "./ExportDialog";
import type { DocumentJobState, JobPhase } from "./useDocumentJob";

const STEPS: readonly Exclude<JobPhase, "idle" | "failed">[] = ["uploading", "processing", "finalizing", "completed"];

/** Only what's really happening: the upload's real bytes, then the server's own count of pages or files. */
function fraction({ phase, upload, job }: DocumentJobState) {
    if (phase === "uploading") return upload * 0.3;
    if (phase === "processing") return job?.progress.total ? 0.3 + 0.6 * (job.progress.done / job.progress.total) : null;
    if (phase === "finalizing") return 0.95;
    return phase === "completed" ? 1 : 0;
}

/** The work in progress: the stage, a real progress bar where there's a real measure, and Cancel. */
export function JobProgress({ state, title, onCancel }: { state: DocumentJobState; title: string; onCancel: () => void }) {
    const t = useT();
    const copy = t.documents.progress;
    const value = fraction(state);
    const progress = state.job?.progress;
    const detail =
        state.phase === "uploading"
            ? copy.uploading(Math.round(state.upload * 100))
            : state.phase === "finalizing"
              ? copy.finalizing
              : progress && progress.total && copy.steps[progress.step as keyof typeof copy.steps]
                ? (copy.steps[progress.step as keyof typeof copy.steps] as (done: number, total: number) => string)(Math.min(progress.total, progress.done + 1), progress.total)
                : progress?.step === "queued"
                  ? copy.queued
                  : (progress && copy.plain[progress.step as keyof typeof copy.plain]) || copy.processing;
    const current = STEPS.indexOf(state.phase as (typeof STEPS)[number]);

    return (
        <div role="status" aria-live="polite" className="animate-enter mx-auto flex w-full max-w-md flex-col items-center px-4 py-10 text-center [--i:-1]">
            <span className="doc-processing relative grid h-20 w-16 place-items-center rounded-lg border border-[var(--card-line)] bg-primary shadow-sm" aria-hidden>
                <FileText className="size-7 text-tertiary" strokeWidth={1.6} />
                <span className="doc-scan absolute inset-x-1.5 h-0.5 rounded-full bg-[var(--brand)]" />
            </span>
            <h2 className="mt-6 text-lg font-semibold text-primary">{title}</h2>
            <p className="mt-1 text-sm text-tertiary tabular-nums">{detail}</p>
            <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--seg-track)]" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(value * 100)}>
                {value === null ? (
                    <span className="doc-indeterminate block h-full w-1/3 rounded-full bg-[var(--brand)]" />
                ) : (
                    <span className="block h-full rounded-full bg-[var(--brand)] transition-[width] duration-300 ease-[var(--ease-out)]" style={{ width: `${Math.max(3, value * 100)}%` }} />
                )}
            </div>
            <ol className="mt-4 flex w-full justify-between gap-2 text-xs">
                {STEPS.map((step, index) => (
                    <li key={step} className={cn("flex items-center gap-1.5", index < current ? "text-secondary" : index === current ? "font-medium text-primary" : "text-quaternary")}>
                        {index < current ? <Check className="size-3.5 text-success-primary" aria-hidden /> : index === current ? <LoaderCircle className="size-3.5 animate-spin text-[var(--brand)] motion-reduce:animate-none" aria-hidden /> : <span className="size-1.5 rounded-full bg-[var(--card-line)]" aria-hidden />}
                        {copy.phases[step]}
                    </li>
                ))}
            </ol>
            <Button size="md" color="tertiary" iconLeading={X} onPress={onCancel} className="mt-6">
                {t.common.cancel}
            </Button>
        </div>
    );
}

/** Finished: the files, each downloadable, all of them as a ZIP, and a way to start again. */
export function JobResult({ job, title, tool, onStartOver, children }: { job: Job; title?: string; tool?: ToolKey; onStartOver: () => void; children?: ReactNode }) {
    const t = useT();
    const copy = t.documents.result;
    const [savingAs, setSavingAs] = useState(false);
    const single = job.files.length === 1 ? job.files[0]! : null;
    /*
     * Fetch, then save from memory — as Save as does. Handing the browser the file's address instead
     * leaves the download to its download manager, which can refuse some files (an encrypted PDF it
     * can't scan) and, with the API on another domain, ignores the file name. If the fetch fails, the
     * address is still worth a try.
     */
    const download = async (file: Job["files"][number] | null) => {
        const name = file ? file.name : `${job.operation === "to-images" ? "pages" : "documents"}.zip`;
        try {
            downloadBlob(file ? await fetchJobFile(job.id, file.id) : await fetchJobArchive(job.id), name);
        } catch {
            downloadFile(file ? jobFileUrl(job.id, file.id) : jobArchiveUrl(job.id), name);
        }
    };
    const extension = single ? (single.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "pdf") : "zip";
    const suggested = single ? single.name.replace(/\.[a-z0-9]+$/i, "") : "documents";
    const handoff = jobHandoffKind(job);
    const total = job.files.reduce((sum, file) => sum + file.size, 0);
    // How long the server keeps these files, as of when they were ready.
    const [minutes] = useState(() => Math.max(1, Math.round((new Date(job.expiresAt).getTime() - Date.now()) / 60_000)));
    return (
        <div className="animate-enter mx-auto flex w-full max-w-2xl flex-col gap-5 px-1 py-4 [--i:-1] sm:py-8">
            <div className="flex flex-col items-center text-center">
                <span className="grid size-12 place-items-center rounded-full bg-success-primary text-success-primary">
                    <Check className="size-6" strokeWidth={2.5} aria-hidden />
                </span>
                <h2 className="mt-4 text-lg font-semibold text-primary">{title ?? copy.ready}</h2>
                <p className="mt-1 text-sm text-tertiary">{copy.summary(job.files.length, formatBytes(total))}</p>
            </div>
            {children}
            <ul className="flex max-h-80 flex-col divide-y divide-[var(--card-line)] overflow-y-auto rounded-xl border border-[var(--card-line)] bg-primary">
                {job.files.map((file) => {
                    const Icon = file.mimeType === "application/pdf" ? FileText : FileImage;
                    return (
                        <li key={file.id} className="flex items-center gap-3 px-3 py-2.5">
                            <Icon className="size-5 shrink-0 text-tertiary" aria-hidden />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-primary">{file.name}</span>
                                <span className="block text-xs text-tertiary tabular-nums">
                                    {formatBytes(file.size)}
                                    {file.pages ? ` · ${copy.pages(file.pages)}` : ""}
                                </span>
                            </span>
                            {job.files.length > 1 && (
                            <button
                                type="button"
                                onClick={() => void download(file)}
                                className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--card-line)] px-3 text-sm font-medium text-secondary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 pointer-coarse:h-11"
                                aria-label={copy.downloadFile(file.name)}
                            >
                                <Download className="size-4" aria-hidden />
                                <span className="hidden sm:inline">{copy.download}</span>
                            </button>
                            )}
                        </li>
                    );
                })}
            </ul>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
                <Button size="lg" color="tertiary" iconLeading={RotateCcw} onPress={onStartOver}>
                    {copy.startOver}
                </Button>
                <Button size="lg" color="secondary" iconLeading={FilePen} onPress={() => setSavingAs(true)}>
                    {copy.saveAs}
                </Button>
                {job.files.length > 1 ? (
                    <Button size="lg" color="primary" iconLeading={Archive} onPress={() => void download(null)}>
                        {copy.downloadAll}
                    </Button>
                ) : (
                    job.files[0] && (
                        <Button size="lg" color="primary" iconLeading={Download} onPress={() => void download(job.files[0]!)}>
                            {copy.download}
                        </Button>
                    )
                )}
            </div>
            {handoff && tool && <ContinueWith kind={handoff} current={tool} files={jobFiles(job)} className="border-t border-[var(--card-line)] pt-5" />}
            <p className="text-center text-xs text-quaternary">{copy.expires(minutes)}</p>
            <ExportDialog
                open={savingAs}
                onClose={() => setSavingAs(false)}
                title={copy.saveAs}
                formats={[{ value: extension, label: extension.toUpperCase(), extension }]}
                name={suggested}
                onExport={async ({ fileName }) => saveBlob(single ? await fetchJobFile(job.id, single.id) : await fetchJobArchive(job.id), fileName)}
            />
        </div>
    );
}

/** Says what really happens to uploads — the server deletes them (see services/files and jobs). */
export function PrivacyNote() {
    const t = useT();
    return (
        <p className="flex gap-2 rounded-xl bg-secondary p-3 text-xs leading-relaxed text-tertiary">
            <ShieldCheck className="mt-px size-3.5 shrink-0 text-success-primary" aria-hidden />
            {t.documents.privacy}
        </p>
    );
}
