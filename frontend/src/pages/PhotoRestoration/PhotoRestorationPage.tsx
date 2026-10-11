import { Check, Download, History, LoaderCircle, RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageProcessingPreview, useSettled } from "@/components/studio/ImageProcessingPreview";
import { CompareView, Fitted, type Notice, PanelBody, PanelIntro, PanelTabs, StudioActions, StudioCanvas, StudioDropzone, StudioError, StudioNotice } from "@/components/studio/StudioParts";
import { StudioShell } from "@/components/studio/StudioShell";
import { ToolUnavailable } from "@/components/studio/ToolUnavailable";
import { Button } from "@/components/ui/base/buttons/button";
import { baseName, formatDimensions } from "@/features/image-processing/format";
import { useProcessingJob } from "@/features/image-processing/useProcessingJob";
import { defaultSelection, engineName, isMonochrome, OPERATIONS, parseSteps } from "@/features/photo-restoration/operations";
import { SEPARATE_AI_SERVER } from "@/lib/api/apiClient";
import { getRestoreCapabilities, type RestoreCapability, type RestoreOperation, type RestoreStep, restorePhoto } from "@/lib/api/restoreApi";
import { cn } from "@/lib/utils/cn";
import { downloadFile } from "@/lib/utils/download";
import { useToolImage } from "@/store/useImageStore";
import type { ImageFile } from "@/types/image";
import { type AppErrorInfo, errorMessage, useT } from "@/i18n";

type Capabilities = { status: "loading" } | { status: "ready"; list: RestoreCapability[] } | { status: "failed"; error: AppErrorInfo };

/**
 * What this server can do, asked up front so unavailable steps are marked before anyone uploads. While
 * the image service is still starting, it asks again every few seconds until it's up.
 */
function useCapabilities(): Capabilities {
    const [state, setState] = useState<Capabilities>({ status: "loading" });
    useEffect(() => {
        const controller = new AbortController();
        let timer = 0;
        let attempts = 0;
        const load = () =>
            getRestoreCapabilities(controller.signal)
                .then((list) => {
                    setState({ status: "ready", list });
                    if (list.some((capability) => capability.reason === "starting") && ++attempts < 40) timer = window.setTimeout(load, 3000);
                })
                .catch(() => !controller.signal.aborted && setState({ status: "failed", error: { code: SEPARATE_AI_SERVER ? "AI_SERVER_OFFLINE" : "NETWORK" } }));
        void load();
        return () => {
            controller.abort();
            window.clearTimeout(timer);
        };
    }, []);
    return state;
}

/** Samples the photo small to tell black-and-white (or sepia) from colour, so Colorize can be suggested. */
function useMonochrome(image: ImageFile | null): boolean | null {
    const [result, setResult] = useState<{ id: string; monochrome: boolean } | null>(null);
    useEffect(() => {
        if (!image) return;
        let cancelled = false;
        const element = new Image();
        element.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = 64;
            canvas.height = 64;
            const context = canvas.getContext("2d", { willReadFrequently: true });
            if (!context || cancelled) return;
            context.drawImage(element, 0, 0, 64, 64);
            setResult({ id: image.id, monochrome: isMonochrome(context.getImageData(0, 0, 64, 64).data) });
        };
        element.src = image.previewUrl;
        return () => {
            cancelled = true;
        };
    }, [image]);
    return image && result?.id === image.id ? result.monochrome : null;
}

export function PhotoRestorationPage() {
    const capabilities = useCapabilities();
    // Run on a separate AI server that can't be reached: say so plainly instead of offering the tool.
    if (capabilities.status === "failed" && capabilities.error.code === "AI_SERVER_OFFLINE") return <ToolUnavailable tool="photoRestoration" error={capabilities.error} />;
    return <RestorationStudio capabilities={capabilities} />;
}

function RestorationStudio({ capabilities }: { capabilities: Capabilities }) {
    const t = useT();
    const copy = t.restoration;
    const { image: original } = useToolImage();
    const monochrome = useMonochrome(original);

    const [selected, setSelected] = useState<RestoreOperation[] | null>(null);
    // A new photo starts from the defaults for that photo (colorize joins for black-and-white ones).
    useEffect(() => setSelected(null), [original?.id]);
    const chosen = selected ?? defaultSelection(monochrome === true);

    const byId = useMemo(() => new Map(capabilities.status === "ready" ? capabilities.list.map((capability) => [capability.id, capability]) : []), [capabilities]);
    const runnable = chosen.filter((id) => byId.get(id)?.available);

    const fileNameFor = useCallback((image: ImageFile) => `${baseName(image.name)}-restored.png`, []);
    const job = useProcessingJob(original, fileNameFor);
    const [steps, setSteps] = useState<RestoreStep[]>([]);
    const busy = job.status === "uploading" || job.status === "processing";
    const done = job.status === "success" && Boolean(job.result);
    const settled = useSettled(done);

    const run = () => {
        if (!runnable.length || busy) return;
        setSteps([]);
        void job.run((file, options) =>
            restorePhoto(file, runnable, options).then((result) => {
                setSteps(parseSteps(result.header("X-Restore-Steps")));
                return result;
            }),
        );
    };
    const toggle = (id: RestoreOperation) => setSelected(chosen.includes(id) ? chosen.filter((value) => value !== id) : [...chosen, id]);
    const resetSettings = () => setSelected(null);
    const download = () => job.result && downloadFile(job.result.url, job.result.fileName);

    const errorText = job.error?.code === "PROCESSING_TIMEOUT" ? copy.timeout : errorMessage(t, job.error);
    const notice: Notice | null = !original
        ? null
        : busy
          ? { tone: "info", text: copy.restoring }
          : done && job.result
            ? { tone: "success", text: copy.done(formatDimensions(job.result.dimensions)) }
            : job.status === "error"
              ? null
              : capabilities.status === "loading"
                ? { tone: "info", text: copy.loadingCapabilities }
                : runnable.length
                  ? { tone: "info", text: copy.ready }
                  : { tone: "error", text: copy.noneSelected };

    // ------------------------------------------------------------------ panel
    const operationList = (
        <fieldset disabled={busy} className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-semibold text-primary">{copy.chooseTitle}</legend>
            <p className="mb-2 text-xs leading-relaxed text-tertiary">{copy.chooseHint}</p>
            {monochrome && selected === null && (
                <p className="mb-1 flex items-start gap-2 rounded-xl bg-[var(--brand-soft)] p-2.5 text-xs text-[var(--brand)]">
                    <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {copy.monochromeHint}
                </p>
            )}
            {OPERATIONS.map(({ id, icon: Icon }) => {
                const capability = byId.get(id);
                const available = Boolean(capability?.available);
                const checked = chosen.includes(id) && available;
                const words = copy.operations[id]!;
                return (
                    <label
                        key={id}
                        className={cn(
                            "group flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors duration-150 has-focus-visible:outline-2 has-focus-visible:outline-focus-ring",
                            checked ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--card-line)] hover:bg-primary_hover",
                            !available && "cursor-not-allowed opacity-60 hover:bg-transparent",
                        )}
                    >
                        <input type="checkbox" className="sr-only" checked={checked} disabled={!available} onChange={() => toggle(id)} aria-describedby={`restore-${id}-hint`} />
                        <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg border", checked ? "border-transparent bg-[var(--brand)] text-white" : "border-secondary bg-primary text-secondary")}>
                            {checked ? <Check className="size-4" aria-hidden /> : <Icon className="size-4" aria-hidden />}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="text-sm font-medium text-primary">{words.label}</span>
                                {capability && (
                                    <span className="rounded-md border border-[var(--card-line)] px-1.5 py-px text-[0.6875rem] font-medium text-tertiary">
                                        {copy.kind[capability.kind]} · {engineName(capability.engine)}
                                    </span>
                                )}
                            </span>
                            <span id={`restore-${id}-hint`} className="text-xs leading-relaxed text-tertiary">
                                {capability && !available ? (copy.reasons[capability.reason ?? "disabled"] ?? copy.reasons.disabled) : words.hint}
                            </span>
                        </span>
                    </label>
                );
            })}
            {capabilities.status === "loading" && (
                <p className="flex items-center gap-2 text-xs text-tertiary">
                    <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                    {copy.loadingCapabilities}
                </p>
            )}
            <div className="mt-1 flex items-center justify-between text-xs text-tertiary">
                <span aria-live="polite">{copy.selectedCount(runnable.length)}</span>
                <button type="button" onClick={resetSettings} disabled={selected === null} className="cursor-pointer rounded-md px-1.5 py-1 font-medium text-secondary outline-focus-ring hover:text-primary focus-visible:outline-2 disabled:cursor-default disabled:opacity-40">
                    {copy.resetSettings}
                </button>
            </div>
        </fieldset>
    );

    const summary = done && steps.length > 0 && (
        <section aria-labelledby="restore-summary" className="border-t border-[var(--card-line)] pt-5">
            <h3 id="restore-summary" className="mb-2 text-sm font-semibold text-primary">
                {copy.resultTitle}
            </h3>
            <ul className="flex flex-col gap-2">
                {steps.map((step) => (
                    <li key={step.id} className="flex items-start gap-2 text-xs">
                        <span aria-hidden className={cn("mt-1 size-2 shrink-0 rounded-full", step.skipped ? "bg-[var(--card-line)]" : "bg-success-solid")} />
                        <span className="flex flex-col">
                            <span className="font-medium text-primary">{copy.operations[step.id]?.label ?? step.id}</span>
                            <span className="text-tertiary">
                                {step.skipped ? (copy.skipped[step.skipped] ?? copy.skippedOther) : step.faces ? `${copy.faces(step.faces.restored, step.faces.skipped)} · ${engineName(step.engine)}` : copy.stepRan(engineName(step.engine))}
                            </span>
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );

    const panel = (
        <>
            <PanelTabs label={copy.controlsLabel} value="restore" onChange={() => undefined} tabs={[{ id: "restore", label: copy.tab, icon: <History className="size-4" aria-hidden /> }]} />
            <PanelBody>
                {original ? (
                    <>
                        {operationList}
                        {summary}
                    </>
                ) : (
                    <>
                        <PanelIntro title={t.studio.howItWorks} steps={t.studio.intros.photoRestoration.steps} />
                        <p className="rounded-xl bg-secondary p-3 text-xs text-tertiary">{t.studio.panelEmpty}</p>
                    </>
                )}
            </PanelBody>
        </>
    );

    // ------------------------------------------------------------------ canvas
    return (
        <StudioShell
            tool="photoRestoration"
            panel={panel}
            panelLabel={copy.controlsLabel}
            exportSlot={
                done && (
                    <Button size="md" color="primary" iconLeading={Download} onPress={download} className="press-scale">
                        <span className="sr-only sm:not-sr-only">{copy.download}</span>
                    </Button>
                )
            }
        >
            <StudioCanvas>
                {!original ? (
                    <StudioDropzone title={t.studio.dropTitle} hint={t.studio.intros.photoRestoration.hint} />
                ) : job.status === "error" ? (
                    <StudioError title={t.studio.errorTitle} message={errorText} onRetry={run} />
                ) : done && settled && job.result ? (
                    <Fitted dimensions={original.dimensions}>
                        {(size) => (
                            <CompareView
                                size={size}
                                before={{ src: original.previewUrl, alt: `${t.common.original}: ${original.name}` }}
                                after={{ src: job.result!.url, alt: copy.resultAlt }}
                                beforeLabel={t.common.original}
                                afterLabel={copy.restored}
                            />
                        )}
                    </Fitted>
                ) : (
                    <Fitted dimensions={original.dimensions}>
                        {(size) =>
                            busy || done ? (
                                <ImageProcessingPreview
                                    src={original.previewUrl}
                                    alt={t.workspace.selectedAlt(original.name)}
                                    size={size}
                                    status={done ? "finishing" : "processing"}
                                    label={copy.restoring}
                                    uploading={job.status === "uploading"}
                                    uploadProgress={job.uploadProgress}
                                    startedAt={job.startedAt}
                                    onCancel={busy ? job.cancel : undefined}
                                />
                            ) : (
                                <figure className="animate-enter relative overflow-hidden rounded-lg [--i:-1]" style={size}>
                                    <img src={original.previewUrl} alt={t.workspace.selectedAlt(original.name)} className="size-full object-contain" draggable={false} />
                                </figure>
                            )
                        }
                    </Fitted>
                )}
            </StudioCanvas>

            {notice && <StudioNotice notice={notice} />}

            {original && !busy && (
                <StudioActions>
                    {done ? (
                        <>
                            <Button size="lg" color="secondary" iconLeading={SlidersHorizontal} onPress={job.reset} className="press-scale pointer-coarse:min-h-12">
                                {copy.changeSettings}
                            </Button>
                            <Button size="lg" color="secondary" iconLeading={RotateCcw} onPress={run} className="press-scale pointer-coarse:min-h-12">
                                {copy.retry}
                            </Button>
                            <Button size="lg" color="primary" iconLeading={Download} onPress={download} className="press-scale pointer-coarse:min-h-12">
                                {copy.downloadImage}
                            </Button>
                        </>
                    ) : (
                        <Button size="lg" color="primary" iconLeading={History} onPress={run} isDisabled={!runnable.length} className="press-scale pointer-coarse:min-h-12">
                            {copy.restorePhoto}
                        </Button>
                    )}
                </StudioActions>
            )}
        </StudioShell>
    );
}
