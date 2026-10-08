import { Eraser, Image as ImageIcon, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Segmented } from "@/components/common/Segmented";
import { Button } from "@/components/ui/base/buttons/button";
import { ImageProcessingPreview, useSettled } from "@/components/studio/ImageProcessingPreview";
import { ClearImageButton, PanelBody, PanelIntro, PanelTabs, StudioActions, StudioCanvas, StudioDropzone, StudioError, StudioNotice, Fitted } from "@/components/studio/StudioParts";
import { ToolUnavailable } from "@/components/studio/ToolUnavailable";
import { useToolOffOnServer } from "@/hooks/useToolOffOnServer";
import { StudioShell } from "@/components/studio/StudioShell";
import { BackgroundRemovalEditor } from "@/features/background-removal/editor/BackgroundRemovalEditor";
import { INITIAL_DOC } from "@/features/background-removal/editor/document";
import { backgroundSessionFor, rememberRemoval, rememberResult } from "@/features/background-removal/resume";
import { baseName } from "@/features/image-processing/format";
import { useProcessingJob } from "@/features/image-processing/useProcessingJob";
import { type BackgroundRemovalStatus, getBackgroundRemovalStatus, type RemovalMode, removeBackground } from "@/lib/api/backgroundRemovalApi";
import { useImageStore, useToolImage } from "@/store/useImageStore";
import type { ImageFile } from "@/types/image";
import { errorMessage, useT } from "@/i18n";

const fileNameFor = (image: ImageFile) => `${baseName(image.name)}-no-background.png`;

export function RemoveBackgroundPage() {
    const tool = useToolImage();
    const off = useToolOffOnServer("backgroundRemoval");
    if (off) return <ToolUnavailable tool="removeBackground" error={off} />;
    // Each image gets its own studio; a result published from inside it doesn't count as a new image.
    return <RemoveBackgroundStudio key={tool.image?.id ?? "none"} original={tool.image} session={tool.session} />;
}

function RemoveBackgroundStudio({ original, session }: { original: ImageFile | null; session: string }) {
    const publish = useImageStore((state) => state.publish);
    /** Back at an image this studio already made (or at its photo): reopen it exactly as left — no processing. */
    const [resumed] = useState(() => backgroundSessionFor(original));
    const job = useProcessingJob(resumed ? null : original, fileNameFor);
    /** A background-removal result this visit no longer remembers (restored after a reload). */
    const alreadyEdited = !resumed && original?.editedBy === "removeBackground";
    /** Removal was started and then stopped, for the status line. */
    const [cancelled, setCancelled] = useState(false);
    const [mode, setMode] = useState<RemovalMode>("quality");
    const status = useRemovalStatus(Boolean(original) && !resumed);

    // The moment the cut-out arrives it's the shared image, and the studio remembers it — so leaving
    // straight away (or coming back later) never means removing the background again.
    const result = job.status === "success" ? job.result : null;
    useEffect(() => {
        if (!original || !result) return;
        const background = rememberRemoval(original, result);
        const image = publish(session, { blob: result.blob, name: result.fileName, dimensions: result.dimensions }, "removeBackground");
        rememberResult(background, INITIAL_DOC, image?.id ?? null);
    }, [original, result, publish, session]);

    // With the cut-out in hand, the studio gains its background, refine and export tools — once the
    // processing effect has faded, so the photo doesn't snap from one view to the next.
    const done = Boolean(original && result);
    const settled = useSettled(done);
    const background = resumed ?? (done && settled ? backgroundSessionFor(original) : null);
    if (background) {
        return <BackgroundRemovalEditor key={background.cutout.url} background={background} session={session} />;
    }
    return (
        <WaitingStudio
            original={original}
            job={job}
            mode={mode}
            onMode={setMode}
            status={status}
            finishing={done}
            cancelled={cancelled}
            alreadyEdited={alreadyEdited}
            onCancel={() => {
                job.cancel();
                setCancelled(true);
            }}
            onStart={() => {
                setCancelled(false);
                void job.run((file, options) => removeBackground(file, options, mode));
            }}
        />
    );
}

/**
 * The same studio before the cut-out exists: upload, then the image waiting for "Remove background"
 * (nothing is sent anywhere until it's pressed), the upload and processing states, and errors.
 */
interface WaitingStudioProps {
    original: ImageFile | null;
    job: ReturnType<typeof useProcessingJob>;
    mode: RemovalMode;
    onMode: (mode: RemovalMode) => void;
    status: BackgroundRemovalStatus | null;
    finishing: boolean;
    cancelled: boolean;
    alreadyEdited: boolean;
    onCancel: () => void;
    onStart: () => void;
}

function WaitingStudio({ original, job, mode, onMode, status, finishing, cancelled, alreadyEdited, onCancel, onStart }: WaitingStudioProps) {
    const t = useT();
    const copy = t.studio;
    const intro = copy.intros.removeBackground;
    const busy = finishing || job.status === "uploading" || job.status === "processing";
    const stage = useStage(job.status === "processing", finishing, job.status === "uploading", status?.typicalSecondsByMode?.[mode] ?? status?.typicalSeconds ?? null);
    // The modes this server offers (ultra only where it's stable; fast only where it's actually faster).
    const modes = (["fast", "quality", "ultra"] as const).filter((value) => value === "quality" || Boolean(status?.modes?.[value]));
    const stageLabel = t.bgStages[stage];
    const ready = job.status === "selected";
    const failed = job.status === "error" || job.status === "unsupported";

    const panel = (
        <>
            <PanelTabs
                label={t.bgEditor.controlsLabel}
                value="background"
                onChange={() => undefined}
                tabs={[
                    { id: "background", label: t.bgEditor.tabs.background, icon: <ImageIcon className="size-4" aria-hidden /> },
                    { id: "refine", label: t.bgEditor.tabs.refine, icon: <Wand2 className="size-4" aria-hidden />, disabled: true },
                ]}
            />
            <PanelBody>
                {original ? (
                    <section className="flex flex-col gap-2.5">
                        <h3 className="text-sm font-semibold text-primary">{t.bgStages.modeLabel}</h3>
                        <Segmented label={t.bgStages.modeLabel} value={mode} onChange={busy ? undefined : onMode} options={modes.map((value) => ({ value, label: t.bgStages.modes[value] }))} />
                    </section>
                ) : (
                    <>
                        <PanelIntro title={copy.howItWorks} steps={intro.steps} />
                        <p className="rounded-xl bg-secondary p-3 text-xs text-tertiary">{copy.panelEmpty}</p>
                    </>
                )}
            </PanelBody>
        </>
    );

    return (
        <StudioShell tool="removeBackground" panel={panel} panelLabel={t.bgEditor.controlsLabel}>
            <StudioCanvas>
                {!original ? (
                    <StudioDropzone title={copy.dropTitle} hint={intro.hint} />
                ) : failed ? (
                    <StudioError title={copy.errorTitle} message={errorMessage(t, job.error)} onRetry={job.status === "error" ? onStart : undefined} />
                ) : (
                    <Fitted dimensions={original.dimensions}>
                        {(size) => (
                            busy ? (
                                <ImageProcessingPreview
                                    src={original.previewUrl}
                                    alt={t.workspace.selectedAlt(original.name)}
                                    size={size}
                                    status={finishing ? "finishing" : "processing"}
                                    label={stageLabel}
                                    uploading={job.status === "uploading"}
                                    uploadProgress={job.uploadProgress}
                                    startedAt={job.startedAt}
                                    onCancel={job.status === "uploading" || job.status === "processing" ? onCancel : undefined}
                                />
                            ) : (
                            <figure className="animate-enter relative overflow-hidden rounded-lg [--i:-1]" style={size}>
                                <img src={original.previewUrl} alt={t.workspace.selectedAlt(original.name)} className="size-full object-contain" draggable={false} />
                            </figure>
                            )
                        )}
                    </Fitted>
                )}
            </StudioCanvas>
            {original && !failed && (
                <StudioNotice
                    notice={
                        finishing
                            ? { tone: "success", text: t.bgEditor.removedSuccess }
                            : busy
                              ? { tone: "info", text: t.bgStages.notice }
                              : { tone: "info", text: cancelled ? copy.cancelled : alreadyEdited ? copy.alreadyRemoved : copy.readyToRemove }
                    }
                />
            )}
            {original && !busy && (
                <StudioActions>
                    <ClearImageButton />
                    {ready && (
                        <Button size="lg" color="primary" iconLeading={Eraser} onPress={onStart} className="press-scale pointer-coarse:min-h-12">
                            {t.pages.removeBackground.action}
                        </Button>
                    )}
                </StudioActions>
            )}
        </StudioShell>
    );
}

type Stage = "uploading" | "analyzing" | "removing" | "refining" | "finishing";

/**
 * Which step the cut-out is on. The upload and the finish are known exactly; in between the server works
 * in one go, so the steps follow how long cut-outs have actually been taking on it (its own measured
 * median, from /remove-bg/status) — never a fixed animation.
 */
/** The server's background-removal status (modes on offer, typical times), fetched once an image is in. */
function useRemovalStatus(enabled: boolean): BackgroundRemovalStatus | null {
    const [status, setStatus] = useState<BackgroundRemovalStatus | null>(null);
    useEffect(() => {
        if (!enabled) return;
        const controller = new AbortController();
        getBackgroundRemovalStatus(controller.signal)
            .then(setStatus)
            .catch(() => undefined);
        return () => controller.abort();
    }, [enabled]);
    return status;
}

function useStage(processing: boolean, finishing: boolean, uploading: boolean, typical: number | null): Stage {
    /** Seconds since the upload finished and the server started working. */
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        if (!processing) return;
        const since = Date.now();
        const timer = window.setInterval(() => setElapsed((Date.now() - since) / 1000), 250);
        return () => {
            window.clearInterval(timer);
            setElapsed(0);
        };
    }, [processing]);
    if (finishing) return "finishing";
    if (uploading || !processing) return "uploading";
    const share = elapsed / (typical ?? 4);
    return share < 0.15 ? "analyzing" : share < 0.8 ? "removing" : "refining";
}
