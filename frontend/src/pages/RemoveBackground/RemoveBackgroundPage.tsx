import { Eraser, Image as ImageIcon, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import { removeBackground } from "@/lib/api/backgroundRemovalApi";
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
            finishing={done}
            cancelled={cancelled}
            alreadyEdited={alreadyEdited}
            onCancel={() => {
                job.cancel();
                setCancelled(true);
            }}
            onStart={() => {
                setCancelled(false);
                void job.run(removeBackground);
            }}
        />
    );
}

/**
 * The same studio before the cut-out exists: upload, then the image waiting for "Remove background"
 * (nothing is sent anywhere until it's pressed), the upload and processing states, and errors.
 */
function WaitingStudio({ original, job, finishing, cancelled, alreadyEdited, onCancel, onStart }: { original: ImageFile | null; job: ReturnType<typeof useProcessingJob>; finishing: boolean; cancelled: boolean; alreadyEdited: boolean; onCancel: () => void; onStart: () => void }) {
    const t = useT();
    const copy = t.studio;
    const intro = copy.intros.removeBackground;
    const busy = finishing || job.status === "uploading" || job.status === "processing";
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
                <PanelIntro title={copy.howItWorks} steps={intro.steps} />
                <p className="rounded-xl bg-secondary p-3 text-xs text-tertiary">{busy && original ? copy.removingBackground : copy.panelEmpty}</p>
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
                                    label={t.studio.processing}
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
                              ? { tone: "info", text: copy.removingBackground }
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
