import { Check, Crop, Download, FileImage, IdCard, Printer, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { type Notice, PanelBody, PanelIntro, PanelTabs, StudioActions, StudioCanvas, StudioDropzone, StudioError, StudioNotice, Fitted } from "@/components/studio/StudioParts";
import { ToolUnavailable } from "@/components/studio/ToolUnavailable";
import { useToolOffOnServer } from "@/hooks/useToolOffOnServer";
import { StudioShell } from "@/components/studio/StudioShell";
import { Button } from "@/components/ui/base/buttons/button";
import { baseName, formatBytes, formatDimensions } from "@/features/image-processing/format";
import { AlignmentControl } from "@/features/photo-generator/AlignmentControl";
import { CropAdjuster } from "@/features/photo-generator/CropAdjuster";
import { photoError, presetName, sizeSlug } from "@/features/photo-generator/labels";
import { OutputSpecs, PresetSelector } from "@/features/photo-generator/PresetSelector";
import { PrintSheet } from "@/features/photo-generator/PrintSheet";
import { ProcessingView } from "@/features/photo-generator/ProcessingView";
import { QualityPanel, ResultView } from "@/features/photo-generator/ResultView";
import { downloadFromServer, useLocalCopies } from "@/features/photo-generator/useLocalCopies";
import { usePhotoJob } from "@/features/photo-generator/usePhotoJob";
import { apiUrl, type GeneratedPhoto, getPhotoPresets, type PhotoPreset } from "@/lib/api/photoGeneratorApi";
import { downloadFile } from "@/lib/utils/download";
import { clearDraftPhoto, loadDraftPhoto } from "@/lib/draft";
import { useToolImage } from "@/store/useImageStore";
import type { ImageFile } from "@/types/image";
import { useT } from "@/i18n";

type Tab = "photo" | "sheet";

export function PhotoGeneratorPage() {
    const { image } = useToolImage();
    const off = useToolOffOnServer("photoGenerator");
    // The photo types come from the server (sizes, DPI) — the page only displays them.
    const [presets, setPresets] = useState<PhotoPreset[] | null>(null);
    const [presetsFailed, setPresetsFailed] = useState(false);
    const [presetId, setPresetId] = useState("passport");
    useEffect(() => {
        const controller = new AbortController();
        getPhotoPresets(controller.signal)
            .then((list) => {
                setPresets(list);
                setPresetId((current) => (list.some((preset) => preset.id === current) ? current : (list[0]?.id ?? current)));
            })
            .catch(() => !controller.signal.aborted && setPresetsFailed(true));
        return () => controller.abort();
    }, []);

    if (off) return <ToolUnavailable tool="photoGenerator" error={off} />;
    // A new image starts afresh; the chosen photo type carries over.
    return <PhotoStudio key={image?.id ?? "none"} image={image} presets={presets} presetsFailed={presetsFailed} presetId={presetId} onPresetChange={setPresetId} />;
}

interface PhotoStudioProps {
    image: ImageFile | null;
    presets: PhotoPreset[] | null;
    presetsFailed: boolean;
    presetId: string;
    onPresetChange: (id: string) => void;
}

function PhotoStudio({ image, presets, presetsFailed, presetId, onPresetChange }: PhotoStudioProps) {
    const t = useT();
    const copy = t.photo;
    const job = usePhotoJob();
    const [tab, setTab] = useState<Tab>("photo");
    const [adjusting, setAdjusting] = useState(false);
    const [notice, setNotice] = useState<Notice | null>(null);
    const [downloaded, setDownloaded] = useState<"jpg" | "png" | null>(null);

    const preset = presets?.find((entry) => entry.id === presetId) ?? null;
    const result = job.status === "done" ? job.result : null;
    const running = job.status === "running";
    /** The photo on screen was made for a different type than the one now selected. */
    const stale = Boolean(result && result.preset.id !== presetId);
    const fileBase = image ? baseName(image.name) : "photo";
    const fileName = (extension: "jpg" | "png") => (result ? `${fileBase}-${result.preset.id}-${sizeSlug(result.size)}.${extension}` : `${fileBase}.${extension}`);
    // The finished files, copied into the browser as soon as they exist — downloads never depend on
    // the server still holding them.
    const copies = useLocalCopies(result, image?.id);

    // Back after a reload: the photo made from this image — crop adjustments included — as it was left.
    const { restore } = job;
    useEffect(() => {
        if (!image) return;
        let cancelled = false;
        loadDraftPhoto<GeneratedPhoto>(image.id).then((saved) => {
            if (cancelled || !saved) return;
            restore(saved.result);
            onPresetChange(saved.result.preset.id);
        });
        return () => {
            cancelled = true;
        };
    }, [image, restore, onPresetChange]);

    useEffect(() => {
        if (!downloaded) return;
        const timer = window.setTimeout(() => setDownloaded(null), 2200);
        return () => window.clearTimeout(timer);
    }, [downloaded]);

    const create = () => {
        if (!image || !preset) return;
        setNotice(null);
        setAdjusting(false);
        setTab("photo");
        void clearDraftPhoto();
        void job.run(image.file, preset.id);
    };
    const cancel = () => {
        job.cancel();
        setNotice({ tone: "info", text: copy.cancelled });
    };
    const startOver = () => {
        void clearDraftPhoto();
        job.reset();
        setAdjusting(false);
        setTab("photo");
        setNotice(null);
    };
    const download = async (kind: "jpg" | "png") => {
        if (!result) return;
        const name = fileName(kind);
        try {
            if (copies) downloadFile(copies[kind], name);
            else await downloadFromServer(kind === "jpg" ? result.imageUrl : result.pngUrl, name, downloadFile);
        } catch {
            setNotice({ tone: "error", text: copy.downloadFailed });
            return;
        }
        setDownloaded(kind);
        setNotice({ tone: "success", text: copy.downloaded(name) });
    };

    // ------------------------------------------------------------------ status line
    const firstFailed = result?.quality.checks.find((check) => !check.ok)?.id;
    const status: Notice | null =
        notice ??
        (!image || running || job.status === "error"
            ? null
            : result
              ? stale && preset
                  ? { tone: "info", text: copy.presetChanged(presetName(t, preset)) }
                  : result.quality.ready
                    ? { tone: "success", text: `${copy.created(presetName(t, result.preset))} · ${copy.ready}` }
                    : { tone: "info", text: firstFailed ? `${copy.needsAdjustment}: ${copy.fixes[firstFailed] ?? copy.checks[firstFailed]}` : copy.needsAdjustment }
              : { tone: "info", text: `${image.name} · ${formatDimensions(image.dimensions)} · ${formatBytes(image.size)}` });

    // ------------------------------------------------------------------ panel
    const panel = (
        <>
            <PanelTabs
                label={copy.controlsLabel}
                value={tab}
                onChange={setTab}
                tabs={[
                    { id: "photo" as Tab, label: copy.tabs.photo, icon: <IdCard className="size-4" aria-hidden /> },
                    { id: "sheet" as Tab, label: copy.tabs.sheet, icon: <Printer className="size-4" aria-hidden />, disabled: !result || stale },
                ]}
            />
            <PanelBody id={tab}>
                {tab === "sheet" && result && !stale ? (
                    <PrintSheet key={result.photoId} photoId={result.photoId} paper={presets?.find((entry) => entry.id === result.preset.id)?.sheet.paper ?? "A4"} maxCopies={presets?.find((entry) => entry.id === result.preset.id)?.sheet.maxCopies ?? 20} fileName={fileName("jpg")} />
                ) : (
                    <>
                        {presetsFailed ? (
                            <p role="alert" className="rounded-xl bg-error-primary p-3 text-sm text-error-primary">
                                {copy.presetsFailed}
                            </p>
                        ) : presets ? (
                            <PresetSelector
                                presets={presets}
                                value={presetId}
                                onChange={(id) => {
                                    setNotice(null);
                                    onPresetChange(id);
                                }}
                                disabled={running}
                            />
                        ) : null}
                        {result && !stale && result.alignment && <AlignmentControl result={result} onRotated={job.applyRotation} />}
                        {result && !stale ? <QualityPanel result={result} /> : preset && <OutputSpecs preset={preset} />}
                        {!image && <PanelIntro title={t.studio.howItWorks} steps={t.studio.intros.photoGenerator.steps} />}
                    </>
                )}
            </PanelBody>
        </>
    );

    // ------------------------------------------------------------------ actions
    const createButton = (
        <Button size="lg" color="primary" iconLeading={IdCard} onPress={create} isDisabled={!preset || running} className="press-scale pointer-coarse:min-h-12">
            {copy.create}
        </Button>
    );
    const actions = !image || running || adjusting ? null : result ? (
        <>
            <Button size="lg" color="tertiary" iconLeading={RotateCcw} onPress={startOver} className="press-scale pointer-coarse:min-h-12">
                {copy.startOver}
            </Button>
            {stale ? (
                createButton
            ) : (
                <>
                    <Button size="lg" color="secondary" iconLeading={Crop} onPress={() => setAdjusting(true)} className="press-scale pointer-coarse:min-h-12">
                        {copy.adjustCrop}
                    </Button>
                    <Button size="lg" color="secondary" iconLeading={downloaded === "png" ? Check : FileImage} onPress={() => void download("png")} className="press-scale pointer-coarse:min-h-12">
                        {copy.downloadPng}
                    </Button>
                    <Button size="lg" color="primary" iconLeading={downloaded === "jpg" ? Check : Download} onPress={() => void download("jpg")} className="press-scale pointer-coarse:min-h-12">
                        {copy.downloadJpg}
                    </Button>
                </>
            )}
        </>
    ) : (
        createButton
    );

    return (
        <StudioShell tool="photoGenerator" panel={panel} panelLabel={copy.controlsLabel}>
            <StudioCanvas className={adjusting ? "lg:bg-neutral-800" : undefined}>
                {!image ? (
                    <StudioDropzone title={t.studio.dropTitle} hint={t.studio.intros.photoGenerator.hint} />
                ) : running ? (
                    <ProcessingView steps={job.steps} previews={job.previews} crop={job.crop} warnings={job.warnings} startedAt={job.startedAt} convertedFrom={image.convertedFrom} onCancel={cancel} />
                ) : job.status === "error" ? (
                    <StudioError title={copy.failedTitle} message={photoError(t, job.error)} onRetry={create} />
                ) : result && adjusting ? (
                    <CropAdjuster
                        result={result}
                        onCancel={() => setAdjusting(false)}
                        onApplied={(photo) => {
                            job.applyRender(photo);
                            setAdjusting(false);
                            setNotice({ tone: "success", text: copy.crop.applied });
                        }}
                    />
                ) : result ? (
                    <ResultView result={result} previews={job.previews} src={copies?.jpg ?? apiUrl(result.imageUrl)} />
                ) : (
                    <Fitted dimensions={image.dimensions}>
                        {(size) => (
                            <figure className="animate-enter relative overflow-hidden rounded-lg [--i:-1]" style={size}>
                                <img src={image.previewUrl} alt={t.workspace.selectedAlt(image.name)} className="size-full object-contain" draggable={false} />
                            </figure>
                        )}
                    </Fitted>
                )}
            </StudioCanvas>

            {status && <StudioNotice notice={status} />}
            {actions && <StudioActions>{actions}</StudioActions>}
        </StudioShell>
    );
}
