import { Check, ChevronDown, Download, GitCompareArrows, LoaderCircle, Redo2, RotateCcw, Undo2, WandSparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Notice, PanelBody, PanelIntro, PanelTabs, StudioActions, StudioCanvas, StudioDropzone, StudioNotice } from "@/components/studio/StudioParts";
import { useSettled } from "@/components/studio/ImageProcessingPreview";
import { BottomSheet } from "@/components/studio/BottomSheet";
import { StudioShell } from "@/components/studio/StudioShell";
import { studioExportButton } from "@/components/studio/styles";
import { usePopover } from "@/components/studio/usePopover";
import { Button } from "@/components/ui/base/buttons/button";
import { useDocHistory } from "@/features/background-removal/editor/document";
import type { ExportFormat } from "@/features/image-processing/exportFormat";
import { baseName, formatBytes, formatDimensions } from "@/features/image-processing/format";
import { useProcessingJob } from "@/features/image-processing/useProcessingJob";
import { useReencode } from "@/features/image-processing/useReencode";
import { ComparisonLayer, type CompareMode, CompareControls, SideBySide } from "@/features/retouch/BeforeAfterComparison";
import { BrushSettings } from "@/features/retouch/BrushSettings";
import { type FrameSize, ImageCanvas } from "@/features/retouch/ImageCanvas";
import { type BrushOptions, modeConfig, type RetouchTool } from "@/features/retouch/modes";
import { ProcessingOverlay } from "@/features/retouch/ProcessingOverlay";
import { RetouchModeSelector } from "@/features/retouch/RetouchModeSelector";
import { ExportControls, RetouchResultPanel } from "@/features/retouch/RetouchResultPanel";
import { RetouchToolbar } from "@/features/retouch/RetouchToolbar";
import { type SelectionStroke, useSelectionMask } from "@/features/retouch/useSelectionMask";
import { type RetouchMode, retouchImage } from "@/lib/api/retouchApi";
import { cn } from "@/lib/utils/cn";
import { downloadFile } from "@/lib/utils/download";
import { usePublishOutput, useToolImage } from "@/store/useImageStore";
import type { ImageFile, ProcessedImage } from "@/types/image";
import { type AppErrorInfo, type Dictionary, useT } from "@/i18n";

type Tab = "retouch";

/** What undo/redo steps through: which kept version is the base, and the selection painted over it. */
interface Session {
    /** Index into the kept versions; 0 is the upload. */
    version: number;
    strokes: readonly SelectionStroke[];
}

const INITIAL: Session = { version: 0, strokes: [] };

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const formatFromMime = (type: string): ExportFormat => (type === "image/jpeg" ? "jpeg" : type === "image/webp" ? "webp" : "png");

/** Codes whose own translated message says it best; anything else gets the one friendly line. */
const EXPLAINED = new Set(["FILE_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "INVALID_IMAGE", "IMAGE_TOO_LARGE", "INVALID_MASK", "RATE_LIMITED", "SERVER_BUSY", "NETWORK", "RETOUCH_UNAVAILABLE"]);

/** Never the server's raw wording: a known situation gets its own sentence, everything else the same calm one. */
function retouchError(t: Dictionary, error: AppErrorInfo | null): string {
    const code = error?.code;
    if (code === "EMPTY_MASK") return t.retouch.notices.emptySelection;
    if (code === "PROCESSING_TIMEOUT") return t.retouch.timeout;
    if (code && EXPLAINED.has(code)) return t.errors[code] ?? t.retouch.failed;
    return t.retouch.failed;
}

export function RetouchPage() {
    const { image, session } = useToolImage();
    // A new image starts a fresh session: selection, history and kept results all belong to one image.
    return image ? <RetouchStudio key={image.id} original={image} session={session} /> : <EmptyStudio />;
}

function EmptyStudio() {
    const t = useT();
    const copy = t.retouch;
    const intro = t.studio.intros.retouch;
    const panel = (
        <>
            <PanelTabs
                label={copy.controlsLabel}
                value="retouch"
                onChange={() => undefined}
                tabs={[
                    { id: "retouch", label: copy.tabs.retouch, icon: <WandSparkles className="size-4" aria-hidden /> },
                ]}
            />
            <PanelBody>
                <PanelIntro title={t.studio.howItWorks} steps={intro.steps} />
                <p className="rounded-xl bg-secondary p-3 text-xs text-tertiary">{t.studio.panelEmpty}</p>
            </PanelBody>
        </>
    );
    return (
        <StudioShell tool="retouch" panel={panel} panelLabel={copy.controlsLabel}>
            <StudioCanvas>
                <StudioDropzone title={t.studio.dropTitle} hint={intro.hint} />
            </StudioCanvas>
        </StudioShell>
    );
}

function RetouchStudio({ original, session: imageSession }: { original: ImageFile; session: string }) {
    const t = useT();
    const copy = t.retouch;
    const { width, height } = original.dimensions;
    const shortSide = Math.min(width, height);

    // ------------------------------------------------------------------ versions & history
    /**
     * Every kept result, oldest first; 0 is the upload. History entries point into this list, so undo
     * can step back through kept results instantly. Their object URLs live as long as the session.
     */
    const versions = useRef<ProcessedImage[]>([{ blob: original.file, url: original.previewUrl, fileName: original.name, dimensions: original.dimensions }]);
    useEffect(() => {
        const kept = versions.current;
        return () => kept.slice(1).forEach((version) => URL.revokeObjectURL(version.url));
    }, []);

    const history = useDocHistory<Session>(INITIAL);
    const session = history.doc;
    const commit = history.commit;
    const base = versions.current[session.version] ?? versions.current[0]!;
    // Kept results are the working image everywhere else; undoing back to the upload restores it.
    const output = useMemo(() => (session.version > 0 ? { blob: base.blob, name: base.fileName, dimensions: base.dimensions } : null), [session.version, base]);
    usePublishOutput({ image: original, session: imageSession }, output, "retouch");

    // ------------------------------------------------------------------ selection
    const mask = useSelectionMask(width, height);
    const { sync, inspect, revision } = mask;
    useEffect(() => sync(session.strokes), [sync, session.strokes]);
    // A 256-px look at the mask — cheap, and redone only when its pixels change (`revision`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const selection = useMemo(() => inspect(), [inspect, revision]);

    const [mode, setMode] = useState<RetouchMode>("remove");
    const config = modeConfig(mode);
    const [strength, setStrength] = useState(0.5);
    const [texture, setTexture] = useState(0.6);
    const [tool, setTool] = useState<RetouchTool>("paint");
    const [brush, setBrush] = useState<BrushOptions>(() => ({ size: Math.max(4, Math.round(shortSide * config.brush.size)), softness: config.brush.softness, opacity: 1 }));
    const maxBrush = Math.max(40, Math.round(shortSide * 0.4));

    // ------------------------------------------------------------------ processing
    const fileNameFor = useCallback((image: ImageFile) => `${baseName(image.name)}-retouched.png`, []);
    const job = useProcessingJob(original, fileNameFor);
    const pending = job.status === "success" ? job.result : null;
    const busy = job.status === "uploading" || job.status === "processing";
    const settled = useSettled(Boolean(pending), 500);
    const finishing = Boolean(pending) && !settled;
    const [preparing, setPreparing] = useState(false);

    const [compareOn, setCompareOn] = useState(false);
    const [compare, setCompare] = useState<CompareMode>("slider");
    const [showBefore, setShowBefore] = useState(false);
    const [notice, setNotice] = useState<Notice>({ tone: "info", text: copy.notices.start });
    const [tab, setTab] = useState<Tab>("retouch");
    const [sheetOpen, setSheetOpen] = useState(false);
    const closeSheet = useCallback(() => setSheetOpen(false), []);

    // The result is in and the processing effect has faded: open straight into the comparison.
    useEffect(() => {
        if (!settled) return;
        setCompareOn(true);
        setShowBefore(false);
        setNotice({ tone: "success", text: copy.notices.done });
    }, [settled, copy.notices.done]);

    /** What the comparison shows: a waiting result against its base, or everything kept against the upload. */
    const comparePair = pending ? { before: base, after: pending, beforeLabel: copy.before } : session.version > 0 ? { before: versions.current[0]!, after: base, beforeLabel: copy.original } : null;
    const comparing = Boolean(comparePair && compareOn && (!pending || settled));
    const paintable = !busy && !pending && !preparing && !comparing;
    const hasSelection = !selection.empty;

    const run = async () => {
        if (busy || preparing || pending) return;
        if (!hasSelection) {
            setNotice({ tone: "error", text: copy.notices.emptySelection });
            return;
        }
        setPreparing(true);
        setCompareOn(false);
        let maskPng: Blob;
        try {
            // The selection leaves as its own PNG; the image is sent untouched beside it.
            maskPng = await mask.exportPng();
        } catch {
            setNotice({ tone: "error", text: copy.failed });
            return;
        } finally {
            setPreparing(false);
        }
        setSheetOpen(false);
        setNotice({ tone: "info", text: `${copy.modes[mode].label}…` });
        const request = { image: base.blob, fileName: original.name, mask: maskPng, mode, strength, texture: config.texture ? texture : undefined };
        void job.run((_file, options) => retouchImage(request, options));
    };

    const cancel = () => {
        job.cancel();
        setNotice({ tone: "info", text: t.studio.cancelled });
    };

    const accept = () => {
        if (!pending) return;
        // The job owns (and will revoke) the result's URL; the kept version gets its own.
        versions.current.push({ ...pending, url: URL.createObjectURL(pending.blob) });
        commit(() => ({ version: versions.current.length - 1, strokes: [] }));
        job.reset();
        setCompareOn(false);
        setTool("paint");
        setNotice({ tone: "success", text: copy.notices.accepted });
    };

    const discard = () => {
        job.reset();
        setCompareOn(false);
        setNotice({ tone: "info", text: copy.notices.discarded });
    };

    /** A failed attempt is forgotten as soon as the selection changes. */
    const forgetFailure = () => {
        if (job.status === "error") job.reset();
    };

    const onStroke = (stroke: SelectionStroke) => {
        commit((current) => ({ ...current, strokes: [...current.strokes, stroke] }));
        forgetFailure();
        setNotice({ tone: "info", text: copy.notices.selected });
    };

    const canUndo = !busy && (Boolean(pending) || history.canUndo);
    const canRedo = !busy && !pending && history.canRedo;
    const undo = () => {
        if (busy) return;
        // While a result waits, undo means "not this one".
        if (pending) return discard();
        if (!history.canUndo) return;
        history.undo();
        forgetFailure();
        setCompareOn(false);
        setNotice({ tone: "info", text: copy.notices.undone });
    };
    const redo = () => {
        if (busy || pending || !history.canRedo) return;
        history.redo();
        forgetFailure();
        setCompareOn(false);
        setNotice({ tone: "info", text: copy.notices.redone });
    };
    const resetAll = () => {
        job.reset();
        commit(() => INITIAL);
        setCompareOn(false);
        setNotice({ tone: "info", text: copy.notices.reset });
    };
    const clearSelection = () => {
        commit((current) => ({ ...current, strokes: [] }));
        forgetFailure();
        setNotice({ tone: "info", text: copy.notices.cleared });
    };

    const changeMode = (next: RetouchMode) => {
        setMode(next);
        // Before anything is painted, each mode starts with the brush that suits it.
        if (session.strokes.length === 0) {
            const suggested = modeConfig(next).brush;
            setBrush((current) => ({ ...current, size: Math.max(4, Math.round(shortSide * suggested.size)), softness: suggested.softness }));
        }
        if (tool === "move") setTool("paint");
    };
    const changeBrush = (next: BrushOptions) => {
        setBrush(next);
        if (tool === "move") setTool("paint");
    };

    // ------------------------------------------------------------------ export
    const downloadable = pending ?? (session.version > 0 ? base : null);
    const sourceFormat = formatFromMime(downloadable?.blob.type ?? original.mimeType);
    const [format, setFormat] = useState<ExportFormat>(() => formatFromMime(original.mimeType));
    const { encoded, working } = useReencode(downloadable, format, sourceFormat, "retouched", original.name);
    const shown = encoded ?? downloadable;
    const [downloaded, setDownloaded] = useState(false);
    useEffect(() => {
        if (!downloaded) return;
        const timer = window.setTimeout(() => setDownloaded(false), 2200);
        return () => window.clearTimeout(timer);
    }, [downloaded]);
    const { open: exportOpen, setOpen: setExportOpen, wrap: exportWrap, trigger: exportTrigger } = usePopover();

    const download = () => {
        if (!shown || working) return;
        downloadFile(shown.url, shown.fileName);
        setDownloaded(true);
        setExportOpen(false);
        setNotice({ tone: "success", text: copy.notices.downloaded(shown.fileName) });
    };

    // ------------------------------------------------------------------ keyboard
    // The shortcuts call the latest handlers without re-subscribing on every render.
    const handlers = useRef({ run, undo, redo });
    useEffect(() => {
        handlers.current = { run, undo, redo };
    });
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const mod = event.metaKey || event.ctrlKey;
            if (mod && event.key.toLowerCase() === "z") {
                if (isTyping(event.target)) return;
                event.preventDefault();
                if (event.shiftKey) handlers.current.redo();
                else handlers.current.undo();
                return;
            }
            if (mod && event.key.toLowerCase() === "y") {
                event.preventDefault();
                handlers.current.redo();
                return;
            }
            if (mod || event.altKey || isTyping(event.target)) return;
            const key = event.key.toLowerCase();
            if (key === "b") setTool("paint");
            else if (key === "e") setTool("erase");
            else if (key === "h") setTool("move");
            else if (key === "enter" && !(event.target instanceof HTMLButtonElement)) void handlers.current.run();
            else if (key === "[" || key === "]") {
                setBrush((current) => {
                    const step = Math.max(1, Math.round(current.size * 0.15));
                    return { ...current, size: Math.min(maxBrush, Math.max(2, current.size + (key === "]" ? step : -step))) };
                });
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [maxBrush]);

    // ------------------------------------------------------------------ status line
    const shownNotice: Notice =
        job.status === "error" ? { tone: "error", text: retouchError(t, job.error) } : busy ? { tone: "info", text: `${copy.modes[mode].label}…` } : notice;
    const coverage = hasSelection ? copy.selectionSize(`${Math.max(1, Math.round(selection.coverage * 100))}%`) : null;

    // ------------------------------------------------------------------ pieces
    const iconButton =
        "grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-secondary transition-colors duration-150 outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-35 pointer-coarse:size-11";

    const actions = (
        <>
            <button type="button" className={iconButton} onClick={undo} disabled={!canUndo} aria-label={copy.undo} title={`${copy.undo} (⌘Z)`}>
                <Undo2 className="size-[1.125rem]" aria-hidden />
            </button>
            <button type="button" className={iconButton} onClick={redo} disabled={!canRedo} aria-label={copy.redo} title={`${copy.redo} (⇧⌘Z)`}>
                <Redo2 className="size-[1.125rem]" aria-hidden />
            </button>
            <button type="button" className={cn(iconButton, "hidden sm:grid")} onClick={resetAll} disabled={busy || (session === INITIAL && !pending)} aria-label={copy.resetAll} title={copy.resetAll}>
                <RotateCcw className="size-[1.125rem]" aria-hidden />
            </button>
            <button
                type="button"
                className={cn(iconButton, compareOn && comparePair && "bg-[var(--brand-soft)] text-[var(--brand)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand)]")}
                onClick={() => setCompareOn((value) => !value)}
                disabled={!comparePair || busy || finishing}
                aria-pressed={compareOn}
                aria-label={copy.compare}
                title={copy.compare}
            >
                <GitCompareArrows className="size-[1.125rem]" aria-hidden />
            </button>
        </>
    );

    const exportControls = <ExportControls image={shown} format={format} onFormatChange={setFormat} working={working} downloaded={downloaded} mayHaveAlpha={original.mimeType !== "image/jpeg"} onDownload={download} />;

    const exportSlot = (
        <div ref={exportWrap} className="relative">
            <button ref={exportTrigger} type="button" onClick={() => setExportOpen((open) => !open)} aria-expanded={exportOpen} aria-haspopup="dialog" disabled={!downloadable} className={studioExportButton}>
                {downloaded ? <Check className="size-4" aria-hidden /> : <Download className="size-4" aria-hidden />}
                <span className="sr-only sm:not-sr-only">{copy.download}</span>
                <ChevronDown className={cn("size-4 opacity-70 transition-transform duration-200", exportOpen && "rotate-180")} aria-hidden />
            </button>
            {exportOpen && (
                <div role="dialog" aria-label={copy.exportTitle} className="absolute top-full right-0 z-50 mt-2 w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-[var(--card-line)] bg-primary p-4 shadow-xl">
                    <p className="mb-4 text-sm font-semibold text-primary">{copy.exportTitle}</p>
                    {exportControls}
                </div>
            )}
        </div>
    );

    const controls = (
        <>
            {pending && settled && <RetouchResultPanel compare={compare} onCompareChange={(next) => {
                        setCompare(next);
                        setCompareOn(true);
                    }} onAccept={accept} onDiscard={discard} />}
            <RetouchModeSelector mode={mode} onModeChange={changeMode} strength={strength} onStrengthChange={setStrength} texture={texture} onTextureChange={setTexture} disabled={busy || Boolean(pending)} />
            <div className="border-t border-[var(--card-line)] pt-5">
                <BrushSettings tool={tool} onToolChange={setTool} brush={brush} onBrushChange={changeBrush} maxSize={maxBrush} coverage={coverage} onClear={clearSelection} disabled={!paintable} />
            </div>
        </>
    );

    const exportSection = (
        <section>
            <h3 className="mb-1 text-sm font-semibold text-primary">{copy.exportTitle}</h3>
            <p className="mb-4 text-xs text-tertiary">{copy.exportHint}</p>
            {exportControls}
        </section>
    );

    const panel = (
        <>
            <PanelTabs
                label={copy.controlsLabel}
                value={tab}
                onChange={setTab}
                tabs={[
                    { id: "retouch" as Tab, label: copy.tabs.retouch, icon: <WandSparkles className="size-4" aria-hidden /> },
                ]}
            />
            <PanelBody id={tab}>{controls}</PanelBody>
        </>
    );

    const retouchButton = (compact: boolean) => (
        <Button size={compact ? "md" : "lg"} color="primary" onPress={() => void run()} isDisabled={preparing || !paintable} className={cn("press-scale", compact ? "min-h-12 px-3.5" : "pointer-coarse:min-h-12")}>
            <span className="flex items-center justify-center gap-2">
                {preparing ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <WandSparkles className="size-4" aria-hidden />}
                {compact ? copy.retouch : preparing ? copy.preparing : copy.retouchImage}
            </span>
        </Button>
    );

    // ------------------------------------------------------------------ canvas content
    const before = comparePair && { src: comparePair.before.url, alt: `${comparePair.beforeLabel}: ${original.name}`, label: comparePair.beforeLabel };
    const after = comparePair && { src: comparePair.after.url, alt: copy.resultAlt, label: copy.after };
    const split = comparing && compare === "split";

    const overlay = (frame: FrameSize) => (
        <>
            {/* The result, revealed under the fading processing effect (and shown on its own if comparison is off). */}
            {pending && !comparing && <img src={pending.url} alt={copy.resultAlt} draggable={false} className="retouch-reveal absolute inset-0 size-full" />}
            {(busy || finishing) && (
                <ProcessingOverlay
                    frame={frame}
                    mask={mask.canvas}
                    bounds={selection.bounds}
                    status={finishing ? "finishing" : job.status === "uploading" ? "uploading" : "processing"}
                    uploadProgress={job.uploadProgress}
                    startedAt={job.startedAt}
                    onCancel={busy ? cancel : undefined}
                />
            )}
            {comparing && before && after && compare !== "split" && <ComparisonLayer key={`${after.src}-${compare}`} mode={compare} before={before} after={after} showBefore={showBefore} />}
        </>
    );

    const info = `${formatDimensions(base.dimensions)} · ${formatBytes(base.blob.size)}`;

    return (
        <StudioShell
            tool="retouch"
            actions={actions}
            exportSlot={exportSlot}
            panel={panel}
            panelLabel={copy.controlsLabel}
            dirty={session !== INITIAL || Boolean(pending)}
            mobilePanel="none"
        >
            <StudioCanvas className="h-[calc(100svh-14rem)] min-h-[18rem]">
                {split && before && after ? (
                    <>
                        <div className="flex justify-center pt-3">
                            <CompareControls mode={compare} onModeChange={setCompare} showBefore={showBefore} onShowBeforeChange={setShowBefore} />
                        </div>
                        <SideBySide before={before} after={after} dimensions={base.dimensions} />
                    </>
                ) : (
                    <ImageCanvas
                        src={base.url}
                        alt={copy.imageAlt(original.name)}
                        width={width}
                        height={height}
                        mask={mask}
                        tool={tool}
                        onToolChange={setTool}
                        brush={brush}
                        paintable={paintable}
                        showMask={paintable || preparing}
                        overlayInteractive={comparing && compare === "slider"}
                        overlay={overlay}
                        top={comparing ? <CompareControls mode={compare} onModeChange={setCompare} showBefore={showBefore} onShowBeforeChange={setShowBefore} /> : undefined}
                        info={info}
                        onStroke={onStroke}
                    />
                )}
            </StudioCanvas>

            <StudioNotice notice={shownNotice} />

            <div className="hidden lg:block">
                {!busy && !finishing && (
                    <StudioActions>
                        {pending ? (
                            <>
                                <Button size="lg" color="secondary" iconLeading={X} onPress={discard} className="press-scale">
                                    {copy.discard}
                                </Button>
                                <Button size="lg" color="primary" iconLeading={Check} onPress={accept} className="press-scale">
                                    {copy.accept}
                                </Button>
                            </>
                        ) : (
                            <>
                                {downloadable && (
                                    <Button size="lg" color="secondary" iconLeading={downloaded ? Check : Download} onPress={download} isDisabled={working} className="press-scale">
                                        {downloaded ? copy.downloaded : `${copy.download} · ${t.workspace.formatNames[format]}`}
                                    </Button>
                                )}
                                {retouchButton(false)}
                            </>
                        )}
                    </StudioActions>
                )}
            </div>

            <RetouchToolbar
                tool={tool}
                onToolChange={setTool}
                paintable={paintable}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={undo}
                onRedo={redo}
                onOpenSettings={() => setSheetOpen(true)}
                action={
                    pending && settled ? (
                        <Button size="md" color="primary" iconLeading={Check} onPress={accept} className="press-scale min-h-12 px-3.5">
                            {copy.accept}
                        </Button>
                    ) : (
                        retouchButton(true)
                    )
                }
            />

            <BottomSheet open={sheetOpen} onClose={closeSheet} title={copy.settings} closeLabel={copy.closeSettings}>
                {controls}
                {downloadable && <div className="border-t border-[var(--card-line)] pt-5">{exportSection}</div>}
            </BottomSheet>
        </StudioShell>
    );
}
