import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Crosshair, Download, LayoutGrid, LoaderCircle, Minus, Move, Plus, RotateCcw, ScanLine } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Segmented } from "@/components/common/Segmented";
import { ExportPopover } from "@/components/studio/ExportPopover";
import { type Notice, PanelBody, PanelIntro, PanelTabs, StudioActions, StudioCanvas, StudioDropzone, StudioError, StudioNotice } from "@/components/studio/StudioParts";
import { StudioShell } from "@/components/studio/StudioShell";
import { Button } from "@/components/ui/base/buttons/button";
import { useSprings } from "@/features/editor/spring";
import { type ExportFormat, formatOf } from "@/features/image-processing/exportFormat";
import { baseName, formatBytes } from "@/features/image-processing/format";
import { FormatPicker } from "@/features/image-processing/FormatPicker";
import { type Align, alignView, centreView, clampView, clampZoom, cropWarning, type FitMode, type Size, upscaleWarning, type View, ZOOM_MAX } from "@/features/social-resizer/frame";
import { FrameStage } from "@/features/social-resizer/FrameStage";
import { PresetGallery } from "@/features/social-resizer/PresetGallery";
import { type CustomError, exportName, MAX_SIDE, type Platform, PLATFORM_NAMES, PLATFORMS, type Preset, presetById, presetsFor, ratioLabel, validateCustom } from "@/features/social-resizer/presets";
import { type Background, canEncodeWebp, renderFrame } from "@/features/social-resizer/render";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { cn } from "@/lib/utils/cn";
import { downloadBlob } from "@/lib/utils/download";
import { useToolImage } from "@/store/useImageStore";
import { useT } from "@/i18n";

type Tab = "size" | "layout";
type Status = { kind: "idle" } | { kind: "exporting" } | { kind: "success"; name: string; size: number } | { kind: "error" };

const DEFAULT_PRESET = "instagram-portrait";
const SWATCHES = ["#ffffff", "#f4f4f5", "#18181b", "#000000", "#eef2ff", "#1e1b4b"] as const;
const number = (value: number) => value.toLocaleString("en-US");

/** Decode once with EXIF orientation, so pixel sizes match what's on screen. */
function useBitmap(file: File | undefined) {
    const [state, setState] = useState<{ file: File; bitmap: ImageBitmap } | { file: File; error: true } | null>(null);
    useEffect(() => {
        if (!file) return;
        let cancelled = false;
        let made: ImageBitmap | null = null;
        createImageBitmap(file, { imageOrientation: "from-image" })
            .then((bitmap) => {
                made = bitmap;
                if (cancelled) bitmap.close();
                else setState({ file, bitmap });
            })
            .catch(() => !cancelled && setState({ file, error: true }));
        return () => {
            cancelled = true;
            made?.close();
        };
    }, [file]);
    // A result for an older file doesn't count.
    return state && state.file === file ? state : null;
}

/** Social Media Resizer: fit a photo to each platform's exact frame and export it, all in the browser. */
export function SocialResizerPage() {
    const t = useT();
    const copy = t.socialResizer;
    const studio = t.studio;
    const original = useToolImage().image;
    const decoded = useBitmap(original?.file);
    const bitmap = decoded && "bitmap" in decoded ? decoded.bitmap : null;
    const image: Size | null = bitmap ? { width: bitmap.width, height: bitmap.height } : null;

    const [tab, setTab] = useState<Tab>("size");
    const [platform, setPlatform] = useState<Platform | "custom">("instagram");
    const [presetId, setPresetId] = useState(DEFAULT_PRESET);
    const [custom, setCustom] = useState<Size>({ width: 1200, height: 1200 });
    const [customText, setCustomText] = useState({ width: "1200", height: "1200" });
    const [customError, setCustomError] = useState<CustomError | null>(null);
    const [mode, setMode] = useState<FitMode>("fill");
    const [background, setBackground] = useState<Background>({ kind: "color", color: "#ffffff" });
    const [showSafe, setShowSafe] = useState(true);
    const [format, setFormat] = useState<ExportFormat>("jpeg");
    const [quality, setQuality] = useState(92);
    const [status, setStatus] = useState<Status>({ kind: "idle" });
    const webp = useMemo(() => canEncodeWebp(), []);

    const preset: Preset | undefined = presetId === "custom" ? undefined : presetById(presetId);
    const target: Size = preset ? { width: preset.width, height: preset.height } : custom;

    const reduceMotion = usePrefersReducedMotion();
    const springs = useSprings({ fx: 0, fy: 0, zoom: 1 }, reduceMotion);
    const { jump, set } = springs;
    const view: View = springs.values;
    const goal: View = springs.targets;

    // A new photo starts centred.
    useEffect(() => {
        if (bitmap) jump(centreView(bitmap));
    }, [bitmap, jump]);

    /** Move to a new frame or mode keeping the same point of the photo centred (and the zoom). */
    const retarget = (nextTarget: Size, nextMode: FitMode, from: View = goal) => {
        setStatus({ kind: "idle" });
        if (image) set(clampView(from, image, nextTarget, nextMode));
    };
    const reset = () => image && set(clampView(centreView(image), image, target, mode));

    const choosePreset = (next: Preset) => {
        setPresetId(next.id);
        retarget({ width: next.width, height: next.height }, mode);
    };
    const choosePlatform = (next: Platform | "custom") => {
        setPlatform(next);
        if (next === "custom") {
            setPresetId("custom");
            return retarget(custom, mode);
        }
        const first = presetsFor(next)[0];
        if (first && preset?.platform !== next) choosePreset(first);
    };
    const applyCustom = () => {
        const result = validateCustom(customText.width, customText.height);
        if ("error" in result) return setCustomError(result.error);
        setCustomError(null);
        setCustom(result);
        setPresetId("custom");
        retarget(result, mode);
    };
    const chooseMode = (next: FitMode) => {
        setMode(next);
        retarget(target, next, { ...goal, zoom: 1 });
    };
    const align = (where: Align) => image && set(clampView(alignView(goal, where, image, target, mode), image, target, mode));
    const zoomTo = (zoom: number) => image && set(clampView({ ...goal, zoom: clampZoom(zoom) }, image, target, mode));

    const crop = image ? cropWarning(goal, image, target, mode) : null;
    const upscale = image ? upscaleWarning(goal, image, target, mode) : null;
    const extension = formatOf(format).extension;
    const fileName = original ? exportName(baseName(original.name), preset?.id ?? "custom", target.width, target.height, extension) : "";
    const exporting = status.kind === "exporting";

    const save = async () => {
        if (!bitmap || !image) return;
        setStatus({ kind: "exporting" });
        try {
            // Let the spinner paint before the heavy synchronous drawing.
            await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
            const blob = await renderFrame(bitmap, clampView(goal, image, target, mode), target, mode, background, format, quality / 100);
            downloadBlob(blob, fileName);
            setStatus({ kind: "success", name: fileName, size: blob.size });
        } catch {
            setStatus({ kind: "error" });
        }
    };

    const sizeText = `${number(target.width)} × ${number(target.height)}`;
    const notice: Notice | null =
        status.kind === "exporting"
            ? { tone: "info", text: copy.exporting }
            : status.kind === "success"
              ? { tone: "success", text: copy.saved(status.name, formatBytes(status.size)) }
              : status.kind === "error"
                ? { tone: "error", text: copy.exportFailed }
                : image
                  ? { tone: "info", text: copy.ready(target.width, target.height) }
                  : null;

    const downloadButton = (close?: () => void) => (
        <Button
            size="lg"
            color="primary"
            iconLeading={exporting ? undefined : Download}
            onPress={() => {
                void save();
                close?.();
            }}
            isDisabled={!bitmap || exporting}
            className="press-scale w-full pointer-coarse:min-h-12"
        >
            {exporting ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-label={copy.exporting} /> : `${copy.download} · ${sizeText} ${t.workspace.formatNames[format]}`}
        </Button>
    );

    const exportSlot = (
        <ExportPopover label={studio.export} title={studio.exportTitle} disabled={!bitmap}>
            {(close) => (
                <div className="flex flex-col gap-4">
                    <FormatPicker value={format} onChange={setFormat} unavailable={webp ? undefined : { webp: copy.webpUnsupported }} note={webp ? undefined : copy.webpUnsupported} />
                    {format !== "png" && (
                        <label className="block">
                            <span className="flex justify-between text-sm text-secondary">
                                {copy.quality} <span className="text-tertiary tabular-nums">{quality}</span>
                            </span>
                            <input type="range" min={50} max={100} value={quality} onChange={(event) => setQuality(Number(event.target.value))} className="mt-2 w-full accent-[var(--brand)] pointer-coarse:h-8" />
                        </label>
                    )}
                    <p className="truncate text-xs text-tertiary tabular-nums" title={fileName}>
                        {copy.output}: {sizeText} px · {fileName}
                    </p>
                    {downloadButton(close)}
                </div>
            )}
        </ExportPopover>
    );

    const sectionTitle = "mb-2 text-label text-quaternary";
    const chip = "grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-[var(--card-line)] text-secondary transition-[background-color,scale] duration-150 outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 active:scale-95 lg:size-10 pointer-coarse:size-11";

    const sizeTab = (
        <>
            <section>
                <h3 className={sectionTitle}>{copy.platform}</h3>
                <Segmented
                    label={copy.platform}
                    size="sm"
                    scrollable
                    value={platform}
                    onChange={choosePlatform}
                    options={[...PLATFORMS.map((value) => ({ value, label: PLATFORM_NAMES[value] })), { value: "custom" as const, label: copy.custom }]}
                />
            </section>
            {platform === "custom" ? (
                <section>
                    <h3 className={sectionTitle}>{copy.customTitle}</h3>
                    <form
                        className="flex items-end gap-2"
                        onSubmit={(event) => {
                            event.preventDefault();
                            applyCustom();
                        }}
                    >
                        {(["width", "height"] as const).map((side) => (
                            <label key={side} className="min-w-0 flex-1">
                                <span className="text-xs text-tertiary">{copy[side]}</span>
                                <input
                                    type="number"
                                    inputMode="numeric"
                                    min={16}
                                    max={MAX_SIDE}
                                    step={1}
                                    value={customText[side]}
                                    aria-invalid={customError ? true : undefined}
                                    onChange={(event) => setCustomText((current) => ({ ...current, [side]: event.target.value }))}
                                    className="mt-1 h-10 w-full rounded-lg border border-[var(--card-line)] bg-primary px-3 text-sm text-primary tabular-nums outline-focus-ring focus-visible:outline-2 pointer-coarse:h-11"
                                />
                            </label>
                        ))}
                        <Button type="submit" size="md" color="secondary" className="press-scale pointer-coarse:min-h-11">
                            {copy.useSize}
                        </Button>
                    </form>
                    <p role={customError ? "alert" : undefined} className={cn("mt-2 text-xs", customError ? "text-error-primary" : "text-tertiary tabular-nums")}>
                        {customError ? (customError === "tooLarge" ? copy.customErrors.tooLarge(MAX_SIDE) : copy.customErrors[customError]) : `${number(custom.width)} × ${number(custom.height)} · ${ratioLabel(custom.width, custom.height)}`}
                    </p>
                </section>
            ) : (
                <section>
                    <h3 className={sectionTitle}>{copy.sizesFor(PLATFORM_NAMES[platform])}</h3>
                    <PresetGallery presets={presetsFor(platform)} value={presetId} onChange={choosePreset} label={copy.sizesFor(PLATFORM_NAMES[platform])} />
                </section>
            )}
            {(preset?.safe || preset?.circle) && (
                <label className="flex min-h-11 cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={showSafe} onChange={(event) => setShowSafe(event.target.checked)} className="mt-0.5 size-4 accent-[var(--brand)]" />
                    <span>
                        <span className="block text-sm font-medium text-primary">{copy.safeArea}</span>
                        <span className="block text-xs text-tertiary">{preset.circle ? copy.circleHint : copy.safeAreaHint}</span>
                    </span>
                </label>
            )}
        </>
    );

    const aligns: Array<{ id: Align; icon: typeof ArrowUp }> = [
        { id: "left", icon: ArrowLeft },
        { id: "top", icon: ArrowUp },
        { id: "center", icon: Crosshair },
        { id: "bottom", icon: ArrowDown },
        { id: "right", icon: ArrowRight },
    ];

    const layoutTab = (
        <>
            <section>
                <h3 className={sectionTitle}>{copy.mode}</h3>
                <Segmented
                    label={copy.mode}
                    value={mode}
                    onChange={chooseMode}
                    className="w-full [&>button]:flex-1"
                    options={[
                        { value: "fill" as const, label: copy.fill },
                        { value: "fit" as const, label: copy.fit },
                    ]}
                />
                <p className="mt-2 text-xs text-tertiary">{mode === "fill" ? copy.fillHint : copy.fitHint}</p>
            </section>
            {mode === "fit" && (
                <section>
                    <h3 className={sectionTitle}>{copy.padding}</h3>
                    <div role="radiogroup" aria-label={copy.padding} className="flex flex-wrap items-center gap-2">
                        {SWATCHES.map((color) => {
                            const selected = background.kind === "color" && background.color === color;
                            return (
                                <button
                                    key={color}
                                    type="button"
                                    role="radio"
                                    aria-checked={selected}
                                    aria-label={copy.colorSwatch(color)}
                                    onClick={() => setBackground({ kind: "color", color })}
                                    className={cn("size-9 cursor-pointer rounded-full border border-[var(--card-line)] outline-focus-ring focus-visible:outline-2 pointer-coarse:size-11", selected && "ring-2 ring-[var(--brand)] ring-offset-2 ring-offset-[var(--color-bg-primary)]")}
                                    style={{ background: color }}
                                />
                            );
                        })}
                        <button
                            type="button"
                            role="radio"
                            aria-checked={background.kind === "blur"}
                            onClick={() => setBackground({ kind: "blur" })}
                            className={cn("h-9 cursor-pointer rounded-full border border-[var(--card-line)] px-3 text-xs font-medium text-secondary outline-focus-ring focus-visible:outline-2 pointer-coarse:h-11", background.kind === "blur" && "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]")}
                        >
                            {copy.blurred}
                        </button>
                        <label className="relative grid size-9 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed border-fg-quaternary pointer-coarse:size-11" title={copy.customColor}>
                            <Plus className="size-4 text-tertiary" aria-hidden />
                            <input
                                type="color"
                                aria-label={copy.customColor}
                                value={background.kind === "color" ? background.color : "#ffffff"}
                                onChange={(event) => setBackground({ kind: "color", color: event.target.value })}
                                className="absolute inset-0 size-full cursor-pointer opacity-0"
                            />
                        </label>
                    </div>
                </section>
            )}
            <section>
                <h3 className={sectionTitle}>{copy.zoom}</h3>
                <div className="flex items-center gap-2">
                    <button type="button" className={chip} aria-label={copy.zoomOut} onClick={() => zoomTo(goal.zoom / 1.2)} disabled={goal.zoom <= 1}>
                        <Minus className="size-4" aria-hidden />
                    </button>
                    <input
                        type="range"
                        aria-label={copy.zoom}
                        min={1}
                        max={ZOOM_MAX}
                        step={0.01}
                        value={goal.zoom}
                        onChange={(event) => image && jump(clampView({ ...goal, zoom: Number(event.target.value) }, image, target, mode))}
                        className="min-w-0 flex-1 accent-[var(--brand)] pointer-coarse:h-11"
                    />
                    <button type="button" className={chip} aria-label={copy.zoomIn} onClick={() => zoomTo(goal.zoom * 1.2)} disabled={goal.zoom >= ZOOM_MAX}>
                        <Plus className="size-4" aria-hidden />
                    </button>
                    <span className="w-12 text-right text-sm text-tertiary tabular-nums">{Math.round(goal.zoom * 100)}%</span>
                </div>
            </section>
            <section>
                <h3 className={sectionTitle}>{copy.position}</h3>
                <div className="flex gap-2">
                    {aligns.map(({ id, icon: Icon }) => (
                        <button key={id} type="button" className={chip} aria-label={copy.align[id]} title={copy.align[id]} onClick={() => align(id)}>
                            <Icon className="size-4" aria-hidden />
                        </button>
                    ))}
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-tertiary">
                    <Move className="size-3.5 shrink-0" aria-hidden />
                    {copy.stageHelp}
                </p>
            </section>
        </>
    );

    const panel = original ? (
        <>
            <PanelTabs
                label={studio.settings}
                value={tab}
                onChange={setTab}
                tabs={[
                    { id: "size" as Tab, label: copy.tabs.size, icon: <LayoutGrid className="size-4" aria-hidden /> },
                    { id: "layout" as Tab, label: copy.tabs.layout, icon: <ScanLine className="size-4" aria-hidden /> },
                ]}
            />
            <PanelBody id={tab}>{tab === "size" ? sizeTab : layoutTab}</PanelBody>
        </>
    ) : (
        <PanelBody>
            <PanelIntro title={studio.howItWorks} steps={studio.intros.socialResizer.steps} formats={["PNG", "JPG", "WebP"]} />
        </PanelBody>
    );

    const warning = (text: string, action?: { label: string; onPress: () => void }) => (
        <p role="status" className="animate-enter flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-transparent bg-warning-primary px-3.5 py-2 text-sm text-warning-primary [--i:-1]">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">{text}</span>
            {action && (
                <button type="button" onClick={action.onPress} className="h-9 cursor-pointer rounded-lg px-2 font-semibold underline-offset-2 outline-focus-ring hover:underline focus-visible:outline-2 pointer-coarse:h-11">
                    {action.label}
                </button>
            )}
        </p>
    );

    return (
        <StudioShell tool="socialResizer" exportSlot={exportSlot} panel={panel} panelLabel={studio.settings}>
            <StudioCanvas>
                {!original ? (
                    <StudioDropzone title={studio.dropTitle} hint={studio.intros.socialResizer.hint} />
                ) : decoded && "error" in decoded ? (
                    <StudioError title={studio.errorTitle} message={t.editor.openFailed} />
                ) : bitmap && image ? (
                    <FrameStage
                        src={original.previewUrl}
                        image={image}
                        target={target}
                        mode={mode}
                        background={background}
                        view={view}
                        goal={goal}
                        jump={jump}
                        animate={set}
                        onReset={reset}
                        safe={preset?.safe}
                        circle={preset?.circle}
                        showSafe={showSafe}
                    />
                ) : (
                    <div className="grid flex-1 place-items-center">
                        <LoaderCircle className="size-6 animate-spin text-tertiary motion-reduce:animate-none" aria-hidden />
                    </div>
                )}
            </StudioCanvas>

            {image && crop !== null && mode === "fill" && warning(copy.cropWarning(crop), { label: copy.fitInstead, onPress: () => chooseMode("fit") })}
            {image && upscale !== null && warning(copy.upscaleWarning(upscale))}
            {notice && <StudioNotice notice={notice} />}

            {bitmap && (
                <StudioActions>
                    <Button size="lg" color="secondary" iconLeading={RotateCcw} onPress={reset} className="press-scale pointer-coarse:min-h-12">
                        {copy.reset}
                    </Button>
                    {downloadButton()}
                </StudioActions>
            )}
        </StudioShell>
    );
}
