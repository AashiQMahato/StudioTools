import { CloudUpload, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { type DropFeature, type GuideStep, type Notice, PanelBody, PanelIntro, StudioActions, StudioCanvas, StudioDropzone, StudioNotice } from "@/components/studio/StudioParts";
import { useStudio } from "@/components/studio/StudioShell";
import { BottomSheet } from "@/components/studio/BottomSheet";
import { Button } from "@/components/ui/base/buttons/button";
import type { DocumentToolKey } from "@/lib/constants/navigation";
import { cn } from "@/lib/utils/cn";
import { errorMessage, useT } from "@/i18n";
import { DocumentStudio } from "./DocumentStudio";
import { JobProgress, JobResult, PrivacyNote } from "./DocumentStates";
import type { useDocumentJob } from "./useDocumentJob";

interface DocumentToolLayoutProps {
    tool: DocumentToolKey;
    accept: string;
    onFiles: (files: File[]) => void;
    /** Takes several files (Merge, Images to PDF): the upload button stays, as "Add more". */
    many?: boolean;
    /** No files yet: the drop zone. */
    empty: boolean;
    drop: { title: string; hint: string; limits: string; headline?: { lead: string; accent: string; tail?: string }; features?: readonly DropFeature[] };
    /** How the tool works (the panel before there are files): plain steps, or titled ones with formats, a tip and a picture. */
    intro: readonly GuideStep[];
    guide?: { art?: ReactNode; formats?: readonly string[]; tip?: string };
    job: ReturnType<typeof useDocumentJob>;
    runningTitle: string;
    doneTitle?: string;
    /** Shown above the result's file list (e.g. a preview). */
    result?: ReactNode;
    /** Replaces the standard result (file list) entirely — for results you work with, like extracted text. */
    resultView?: ReactNode;
    onStartOver: () => void;
    /** The tool's settings (right panel). */
    options?: ReactNode;
    /** The most used settings, in the toolbar (compact selects). */
    quickSettings?: ReactNode;
    /** Above the workspace (e.g. page actions). */
    toolbar?: ReactNode;
    action: { label: string; icon: LucideIcon; onPress: () => void; disabled?: boolean };
    /** Buttons beside the main action (e.g. Reset). */
    secondary?: ReactNode;
    notice?: Notice | null;
    /** The workspace: files or pages. */
    children: ReactNode;
    /** Phones and tablets: the options open as a sheet (the tool's own button opens it) instead of stacking under the page. */
    sheet?: { open: boolean; onClose: () => void; title: string };
}

/**
 * The frame every document tool shares: a toolbar (add files, quick settings, the main action), then
 * drop zone → workspace with options → progress → result, with failures reported in words (never raw
 * server errors) and the work kept for another try.
 */
export function DocumentToolLayout({ tool, accept, onFiles, many = false, empty, drop, intro, guide, job, runningTitle, doneTitle, result, resultView, onStartOver, options, quickSettings, toolbar, action, secondary, notice, children, sheet }: DocumentToolLayoutProps) {
    const t = useT();
    const running = job.phase === "uploading" || job.phase === "processing" || job.phase === "finalizing";
    const done = job.phase === "completed" && job.job;
    const working = !running && !done;
    const failure: Notice | null = job.phase === "failed" ? { tone: "error", text: errorMessage(t, job.error) } : null;
    const shown = failure ?? notice ?? null;
    const pdf = accept.includes("pdf");
    const uploadLabel = pdf ? (many ? t.documents.uploadPdfs : t.documents.uploadPdf) : t.documents.uploadImages;

    return (
        <DocumentStudio
            tool={tool}
            accept={accept}
            onFiles={onFiles}
            dirty={!empty && !done}
            mobilePanel={sheet && !empty && !running && !done ? "none" : "stack"}
            panelLabel={t.nav.toolItems[tool].title}
            panel={
                <PanelBody>
                    {empty ? <PanelIntro title={t.studio.howItWorks} steps={intro} art={guide?.art} formats={guide?.formats} tip={guide?.tip} /> : options}
                    <PrivacyNote />
                </PanelBody>
            }
        >
            {working && (
                <CommandBar
                    // Single-file tools: once a file is open, picking another would replace the work — that's
                    // the header's New button (which asks first). Multi-file tools keep adding.
                    upload={empty || many ? (empty ? uploadLabel : t.documents.addMore) : null}
                    // On phones the empty drop zone has its own big button; the toolbar's would only repeat it.
                    uploadOnPhones={!empty}
                    settings={quickSettings}
                    secondary={empty ? undefined : secondary}
                    action={action}
                    actionDisabled={empty || action.disabled}
                />
            )}
            {!empty && working && toolbar}
            <StudioCanvas className={cn(empty && "max-lg:h-auto")}>
                {empty ? (
                    <StudioDropzone title={drop.title} hint={drop.hint} limits={drop.limits} kind={pdf ? "pdf" : "image"} headline={drop.headline} features={drop.features} actionLabel={uploadLabel} many={many} />
                ) : running ? (
                    <div className="flex flex-1 items-center justify-center overflow-y-auto">
                        <JobProgress state={job} title={runningTitle} onCancel={job.cancel} />
                    </div>
                ) : done ? (
                    <div className="min-h-0 flex-1 overflow-y-auto px-3 sm:px-6">
                        {resultView ?? (
                            <JobResult job={job.job!} title={doneTitle} tool={tool} onStartOver={onStartOver}>
                                {result}
                            </JobResult>
                        )}
                    </div>
                ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5">{children}</div>
                )}
            </StudioCanvas>
            {shown && !running && <StudioNotice notice={shown} />}
            {sheet && (
                <BottomSheet open={sheet.open && !empty && !running && !done} onClose={sheet.onClose} title={sheet.title} closeLabel={t.documents.done}>
                    {options}
                </BottomSheet>
            )}
            {/* Phones and tablets: the main action at the bottom, in reach of the thumb (desktop has it in the toolbar). */}
            {!empty && working && (
                <div className="lg:hidden">
                    <StudioActions>
                        {secondary}
                        <Button size="lg" color="primary" iconLeading={action.icon} onPress={action.onPress} isDisabled={action.disabled} className="press-scale pointer-coarse:min-h-12">
                            {action.label}
                        </Button>
                    </StudioActions>
                </div>
            )}
        </DocumentStudio>
    );
}

/**
 * The toolbar: add files on the left, the quick settings, and the main action on the right. On phones
 * the action lives at the bottom instead, so a toolbar with nothing else isn't shown there.
 */
function CommandBar({ upload, uploadOnPhones, settings, secondary, action, actionDisabled }: { upload: string | null; uploadOnPhones: boolean; settings?: ReactNode; secondary?: ReactNode; action: DocumentToolLayoutProps["action"]; actionDisabled?: boolean }) {
    const { openPicker } = useStudio();
    const Icon = action.icon;
    const phones = (upload && uploadOnPhones) || settings;
    return (
        <div className={cn("flex-wrap items-center gap-2", phones ? "flex" : "hidden lg:flex")}>
            {upload && (
                <button
                    type="button"
                    onClick={openPicker}
                    className={cn(uploadOnPhones ? "flex" : "hidden sm:flex", "studio-nav-item h-12 cursor-pointer items-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--brand)_30%,transparent)] bg-[var(--brand-soft)] px-4 text-sm font-semibold text-[var(--brand)] outline-focus-ring hover:bg-[color-mix(in_srgb,var(--brand)_14%,transparent)] focus-visible:outline-2")}
                >
                    <CloudUpload className="size-[1.125rem]" aria-hidden />
                    {upload}
                </button>
            )}
            {settings && (
                <>
                    {upload && <span aria-hidden className="mx-1 hidden h-7 w-px bg-[var(--card-line)] sm:block" />}
                    <div className="grid flex-1 grid-cols-2 gap-2 sm:flex sm:flex-none sm:flex-wrap sm:items-center">{settings}</div>
                </>
            )}
            <div className="ml-auto hidden items-center gap-2 lg:flex">
                {secondary}
                <button type="button" onClick={action.onPress} disabled={actionDisabled} className="studio-cta flex h-12 cursor-pointer items-center gap-2 rounded-xl px-6 text-sm font-semibold text-white outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2">
                    <Icon className="size-[1.125rem]" aria-hidden />
                    {action.label}
                </button>
            </div>
        </div>
    );
}
