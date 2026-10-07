import { ChevronDown, Download, LoaderCircle, RotateCcw, ZoomIn } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/base/buttons/button";
import { CompareView, Fitted, type Notice, PanelBody, PanelIntro, PanelTabs, StudioActions, StudioCanvas, StudioDropzone, StudioError, StudioNotice } from "@/components/studio/StudioParts";
import { ToolUnavailable } from "@/components/studio/ToolUnavailable";
import { useToolOffOnServer } from "@/hooks/useToolOffOnServer";
import { ImageProcessingPreview, useSettled } from "@/components/studio/ImageProcessingPreview";
import { StudioShell } from "@/components/studio/StudioShell";
import { studioExportButton } from "@/components/studio/styles";
import { usePopover } from "@/components/studio/usePopover";
import type { ExportFormat } from "@/features/image-processing/exportFormat";
import { baseName, formatBytes, formatDimensions } from "@/features/image-processing/format";
import { FormatPicker } from "@/features/image-processing/FormatPicker";
import { useProcessingJob } from "@/features/image-processing/useProcessingJob";
import { useReencode } from "@/features/image-processing/useReencode";
import { ScaleCards } from "@/features/upscaler/ScaleCards";
import { megapixels, targetSize } from "@/features/upscaler/scale";
import { getProcessorHealth } from "@/lib/api/processorsApi";
import { upscaleImage } from "@/lib/api/upscaleApi";
import { cn } from "@/lib/utils/cn";
import { downloadFile } from "@/lib/utils/download";
import { useImageStore, usePublishOutput, useToolImage } from "@/store/useImageStore";
import type { ImageFile, UpscaleFactor } from "@/types/image";
import { type AppErrorInfo, errorMessage, useT } from "@/i18n";

/** Mirrors the API's default output limit, so impossible choices are disabled up front. */
const MAX_OUTPUT_PIXELS = 40_000_000;

type Tab = "upscale";

/** The upscaler, or — when it runs on its own server and that's offline — a plain note saying so. */
export function UpscalerPage() {
    const off = useToolOffOnServer("upscaling");
    return off ? <ToolUnavailable tool="upscaler" error={off} /> : <UpscalerStudio />;
}

function UpscalerStudio() {
    const t = useT();
    const copy = t.studio;
    const up = t.pages.upscale;
    const tool = useToolImage();
    const original = tool.image;
    const scale = useImageStore((state) => state.selectedScale);
    const setScale = useImageStore((state) => state.setSelectedScale);
    // The scale the current result was made at — the picker may have moved on since.
    const [resultScale, setResultScale] = useState<UpscaleFactor>(scale);
    const fileNameFor = useCallback((image: ImageFile) => `${baseName(image.name)}-upscaled-${resultScale}x.png`, [resultScale]);
    const job = useProcessingJob(original, fileNameFor);

    const [unsupported, setUnsupported] = useState<AppErrorInfo | null>(null);
    const [serverScales, setServerScales] = useState<UpscaleFactor[] | undefined>(undefined);
    const [engineOk, setEngineOk] = useState<boolean | null>(null);
    // Ask the API up front whether this server can upscale, instead of letting someone wait for a failure.
    useEffect(() => {
        const controller = new AbortController();
        getProcessorHealth(controller.signal)
            .then((health) => {
                setUnsupported(health.upscaling.available ? null : { code: "UPSCALING_UNAVAILABLE", message: health.upscaling.message ?? undefined });
                setEngineOk(health.upscaling.available);
                setServerScales(health.upscaling.scales.filter((value): value is UpscaleFactor => value === 2 || value === 4));
            })
            .catch(() => undefined);
        return () => controller.abort();
    }, []);

    const pixels = original ? original.dimensions.width * original.dimensions.height : 0;
    const tooLarge = useMemo(() => ([2, 4] as UpscaleFactor[]).filter((option) => pixels * option * option > MAX_OUTPUT_PIXELS), [pixels]);
    useEffect(() => {
        if (tooLarge.includes(scale) && !tooLarge.includes(2)) setScale(2);
    }, [tooLarge, scale, setScale]);

    // The API always returns PNG; anything else is converted here, on this device.
    const [format, setFormat] = useState<ExportFormat>("png");
    const { encoded, working } = useReencode(job.result, format, "png", `upscaled-${resultScale}x`, original?.name);
    const shown = encoded ?? job.result;
    const mayHaveAlpha = original?.mimeType !== "image/jpeg";

    const [tab, setTab] = useState<Tab>("upscale");
    const { open: exportOpen, setOpen: setExportOpen, wrap: exportWrap, trigger: exportTrigger } = usePopover();

    // The upscaled image becomes the working image for every other tool (and survives a reload).
    const result = job.status === "success" ? job.result : null;
    const output = useMemo(() => (result ? { blob: result.blob, name: result.fileName, dimensions: result.dimensions } : null), [result]);
    usePublishOutput(tool, output, "upscaler");

    const status = job.status;
    const busy = status === "uploading" || status === "processing";
    const done = status === "success" && Boolean(shown);
    // The processing effect fades out before the comparison takes its place.
    const settled = useSettled(done);
    const blocked = Boolean(unsupported) || (tooLarge.includes(2) && tooLarge.includes(4));
    const target = original ? targetSize(original.dimensions, scale) : null;

    const run = () => {
        setResultScale(scale);
        setTab("upscale");
        void job.run((file, options) => upscaleImage(file, scale, options));
    };
    const download = () => {
        if (!shown) return;
        downloadFile(shown.url, shown.fileName);
        setExportOpen(false);
    };

    const notice: Notice | null = !original
        ? null
        : (unsupported && !done) || status === "error"
          ? null // the canvas already says what went wrong
          : busy
              ? { tone: "info", text: copy.upscaling(resultScale) }
              : done && shown
                ? { tone: "success", text: copy.upscaledNotice(resultScale, `${formatDimensions(shown.dimensions)} · ${formatBytes(shown.blob.size)}`) }
                : target
                  ? { tone: "info", text: copy.readyToUpscale(formatDimensions(original.dimensions), formatDimensions(target)) }
                  : null;

    const exportOptions = (
        <div className="flex flex-col gap-4">
            <FormatPicker value={format} onChange={setFormat} note={format === "jpeg" && mayHaveAlpha ? t.workspace.flattensAlpha : undefined} />
            {shown && (
                <p className="flex items-center gap-2 text-xs text-tertiary tabular-nums">
                    {working ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
                    {working ? up.converting : `${formatDimensions(shown.dimensions)} · ${t.workspace.formatNames[format]} · ${formatBytes(shown.blob.size)}`}
                </p>
            )}
            <Button size="lg" color="primary" iconLeading={Download} onPress={download} isDisabled={!done || working} className="press-scale w-full pointer-coarse:min-h-12">
                {copy.downloadImage}
            </Button>
        </div>
    );

    const exportSlot = (
        <div ref={exportWrap} className="relative">
            <button ref={exportTrigger} type="button" onClick={() => setExportOpen((open) => !open)} aria-expanded={exportOpen} aria-haspopup="dialog" disabled={!done} className={studioExportButton}>
                <Download className="size-4" aria-hidden />
                <span className="sr-only sm:not-sr-only">{copy.export}</span>
                <ChevronDown className={cn("size-4 opacity-70 transition-transform duration-200", exportOpen && "rotate-180")} aria-hidden />
            </button>
            {exportOpen && (
                <div role="dialog" aria-label={copy.exportTitle} className="absolute top-full right-0 z-50 mt-2 w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-[var(--card-line)] bg-primary p-4 shadow-xl">
                    <p className="mb-4 text-sm font-semibold text-primary">{copy.exportTitle}</p>
                    {exportOptions}
                </div>
            )}
        </div>
    );

    const panel = (
        <>
            <PanelTabs
                label={copy.settings}
                value={tab}
                onChange={setTab}
                tabs={[
                    { id: "upscale" as Tab, label: copy.tabs.upscale, icon: <ZoomIn className="size-4" aria-hidden /> },
                ]}
            />
            <PanelBody id={tab}>
                <>
                    {engineOk !== null && (
                        <p className="flex items-center gap-2 text-xs font-medium text-tertiary">
                            <span aria-hidden className={cn("size-2 rounded-full", engineOk ? "bg-success-solid" : "bg-warning-solid")} />
                            {engineOk ? up.engineReady : up.engineDown}
                        </p>
                    )}
                    {original ? (
                        <>
                            <section>
                                <ScaleCards disabledScales={tooLarge} availableScales={serverScales} dimensions={original.dimensions} />
                                <p className="mt-2 text-xs text-tertiary">{up.configNote}</p>
                            </section>
                            <section>
                                <h3 className="mb-2 text-sm font-semibold text-primary">{up.outputLabel}</h3>
                                <dl className="divide-y divide-[var(--card-line)] rounded-xl border border-[var(--card-line)] px-3 text-sm">
                                    <div className="flex justify-between py-2.5">
                                        <dt className="text-tertiary">{up.inputSpec}</dt>
                                        <dd className="text-secondary tabular-nums">{formatDimensions(original.dimensions)}</dd>
                                    </div>
                                    <div className="flex justify-between py-2.5">
                                        <dt className="text-tertiary">{up.targetSpec}</dt>
                                        <dd className="font-semibold text-primary tabular-nums">{target ? `${formatDimensions(target)} · ${up.megapixels(megapixels(target))}` : "—"}</dd>
                                    </div>
                                </dl>
                            </section>
                        </>
                    ) : (
                        <PanelIntro title={copy.howItWorks} steps={copy.intros.upscaler.steps} />
                    )}
                </>

            </PanelBody>
        </>
    );

    return (
        <StudioShell tool="upscaler" exportSlot={exportSlot} panel={panel} panelLabel={copy.settings}>
            <StudioCanvas>
                {!original ? (
                    <StudioDropzone title={copy.dropTitle} hint={copy.intros.upscaler.hint} />
                ) : unsupported && !done ? (
                    <StudioError title={copy.unavailableTitle} message={errorMessage(t, unsupported)} />
                ) : status === "error" ? (
                    <StudioError title={copy.errorTitle} message={errorMessage(t, job.error)} onRetry={run} />
                ) : done && settled && shown ? (
                    <Fitted dimensions={original.dimensions}>
                        {(size) => (
                            <CompareView
                                size={size}
                                before={{ src: original.previewUrl, alt: `${t.common.original}: ${original.name}` }}
                                after={{ src: shown.url, alt: `${t.workspace.upscaled}: ${shown.fileName}` }}
                                beforeLabel={t.common.original}
                                afterLabel={`${t.workspace.upscaled} ${resultScale}×`}
                                transparentBefore={mayHaveAlpha}
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
                                    label={copy.upscaling(resultScale)}
                                    uploading={status === "uploading"}
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
                            <Button size="lg" color="secondary" iconLeading={RotateCcw} onPress={job.reset} className="press-scale pointer-coarse:min-h-12">
                                {copy.changeScale}
                            </Button>
                            <Button size="lg" color="primary" iconLeading={Download} onPress={download} isDisabled={working} className="press-scale pointer-coarse:min-h-12">
                                {`${copy.downloadImage} · ${t.workspace.formatNames[format]}`}
                            </Button>
                        </>
                    ) : (
                        <Button size="lg" color="primary" iconLeading={ZoomIn} onPress={run} isDisabled={blocked} className="press-scale pointer-coarse:min-h-12">
                            {up.action(scale)}
                        </Button>
                    )}
                </StudioActions>
            )}
        </StudioShell>
    );
}
