import { Check, Download, GitCompareArrows, Info, LoaderCircle, Redo2, RotateCcw, ScanSearch, Stamp, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Segmented } from "@/components/common/Segmented";
import { BottomSheet } from "@/components/studio/BottomSheet";
import { useSettled } from "@/components/studio/ImageProcessingPreview";
import { type Notice, PanelBody, PanelIntro, StudioActions, StudioCanvas, StudioDropzone, StudioNotice } from "@/components/studio/StudioParts";
import { StudioShell } from "@/components/studio/StudioShell";
import { studioExportButton } from "@/components/studio/styles";
import { Button } from "@/components/ui/base/buttons/button";
import { useDocHistory } from "@/features/background-removal/editor/document";
import { baseName, formatBytes, formatDimensions } from "@/features/image-processing/format";
import { useProcessingJob } from "@/features/image-processing/useProcessingJob";
import { type CompareMode, CompareControls, ComparisonLayer, SideBySide } from "@/features/retouch/BeforeAfterComparison";
import { BrushSettings } from "@/features/retouch/BrushSettings";
import { type FrameSize, ImageCanvas } from "@/features/retouch/ImageCanvas";
import type { BrushOptions, RetouchTool } from "@/features/retouch/modes";
import { ProcessingOverlay } from "@/features/retouch/ProcessingOverlay";
import { RetouchToolbar } from "@/features/retouch/RetouchToolbar";
import { type SelectionStroke, useSelectionMask } from "@/features/retouch/useSelectionMask";
import { AnalyzingOverlay } from "@/features/watermark/AnalyzingOverlay";
import { DetectionList, DetectionOverlay } from "@/features/watermark/Detections";
import { detectionStroke, PRESELECT } from "@/features/watermark/selection";
import { detectWatermarks, type RemovalWarning, removeWatermark, type WatermarkDetection } from "@/lib/api/watermarkApi";
import { cn } from "@/lib/utils/cn";
import { downloadFile } from "@/lib/utils/download";
import { usePublishOutput, useToolImage } from "@/store/useImageStore";
import type { ImageFile, ProcessedImage } from "@/types/image";
import { type AppErrorInfo, type Dictionary, useT } from "@/i18n";

/** What undo/redo steps through: the kept version, the painted selection, and which detections are ticked. */
interface Session {
    /** Index into the kept versions; 0 is the upload. */
    version: number;
    strokes: readonly SelectionStroke[];
    selected: readonly string[];
}

interface Detection {
    status: "running" | "done" | "failed";
    list: WatermarkDetection[];
}

const INITIAL: Session = { version: 0, strokes: [], selected: [] };
const ALL_TOOLS: readonly RetouchTool[] = ["paint", "rect", "lasso", "erase", "move"];
const TOOL_BY_KEY: Record<string, RetouchTool> = { b: "paint", e: "erase", m: "rect", l: "lasso", h: "move" };

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Codes whose own sentence says it best; anything else gets the one calm, general message. */
const EXPLAINED = new Set(["FILE_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "INVALID_IMAGE", "IMAGE_TOO_LARGE", "INVALID_MASK", "RATE_LIMITED", "SERVER_BUSY", "NETWORK", "PROCESSING_TIMEOUT", "RETOUCH_UNAVAILABLE"]);
function removalError(t: Dictionary, error: AppErrorInfo | null): string {
    const code = error?.code;
    if (code === "EMPTY_MASK") return t.watermark.emptySelection;
    return (code && EXPLAINED.has(code) && t.errors[code]) || t.watermark.failed;
}

export function WatermarkRemoverPage() {
    const { image, session } = useToolImage();
    return image ? <WatermarkStudio key={image.id} original={image} session={session} /> : <EmptyStudio />;
}

function EmptyStudio() {
    const t = useT();
    const intro = t.studio.intros.watermarkRemover;
    return (
        <StudioShell
            tool="watermarkRemover"
            panel={
                <PanelBody>
                    <PanelIntro title={t.studio.howItWorks} steps={intro.steps} />
                    <PermissionNote />
                </PanelBody>
            }
            panelLabel={t.watermark.controlsLabel}
        >
            <StudioCanvas>
                <StudioDropzone title={t.studio.dropTitle} hint={intro.hint} />
            </StudioCanvas>
        </StudioShell>
    );
}

function PermissionNote() {
    const t = useT();
    return (
        <p className="flex gap-2 rounded-xl bg-secondary p-3 text-xs text-tertiary">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            {t.watermark.permission}
        </p>
    );
}

function WatermarkStudio({ original, session: imageSession }: { original: ImageFile; session: string }) {
    const t = useT();
    const copy = t.watermark;
    const shared = t.retouch;
    const { width, height } = original.dimensions;
    const shortSide = Math.min(width, height);

    // ------------------------------------------------------------------ versions & history
    /** Original → removal 1 → removal 2…: every kept result, so undo can step back through them. */
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
    usePublishOutput({ image: original, session: imageSession }, output, "watermarkRemover");

    // ------------------------------------------------------------------ detection
    const [detections, setDetections] = useState<Record<number, Detection>>({});
    const current = detections[session.version] ?? null;
    const detectController = useRef<AbortController | null>(null);
    const detect = useCallback(
        async (version: number, image: ProcessedImage) => {
            detectController.current?.abort();
            const controller = new AbortController();
            detectController.current = controller;
            setDetections((all) => ({ ...all, [version]: { status: "running", list: all[version]?.list ?? [] } }));
            try {
                const { detections: list } = await detectWatermarks(image.blob, original.name, controller.signal);
                if (controller.signal.aborted) return;
                setDetections((all) => ({ ...all, [version]: { status: "done", list } }));
                // Likely ones start ticked — still only a suggestion: nothing is removed until asked.
                commit((doc) => (doc.version === version ? { ...doc, selected: list.filter((item) => item.confidence >= PRESELECT).map((item) => item.id) } : doc));
            } catch {
                if (!controller.signal.aborted) setDetections((all) => ({ ...all, [version]: { status: "failed", list: [] } }));
            }
        },
        [commit, original.name],
    );
    // Looking is harmless, so the original is analysed as soon as it opens. Leaving cancels it — and
    // React's development re-mount then simply starts it again, rather than leaving it cancelled.
    useEffect(() => {
        void detect(0, versions.current[0]!);
        return () => detectController.current?.abort();
    }, [detect]);
    const detecting = current?.status === "running";
    const list = useMemo(() => current?.list ?? [], [current]);

    // ------------------------------------------------------------------ selection
    const mask = useSelectionMask(width, height);
    const { sync, inspect, revision } = mask;
    /** One shape per detection, kept stable so the mask only rebuilds when the ticks change. */
    const detectionStrokes = useMemo(() => new Map(list.map((item) => [item.id, detectionStroke(item)])), [list]);
    const strokes = useMemo(() => [...session.selected.flatMap((id) => detectionStrokes.get(id) ?? []), ...session.strokes], [session.selected, session.strokes, detectionStrokes]);
    useEffect(() => sync(strokes), [sync, strokes]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const selection = useMemo(() => inspect(), [inspect, revision]);

    const [tool, setTool] = useState<RetouchTool>("paint");
    const [brush, setBrush] = useState<BrushOptions>(() => ({ size: Math.max(6, Math.round(shortSide * 0.03)), softness: 0.3, opacity: 1 }));
    const maxBrush = Math.max(40, Math.round(shortSide * 0.3));

    // ------------------------------------------------------------------ removal
    const warnings = useRef<RemovalWarning[]>([]);
    const fileNameFor = useCallback((image: ImageFile) => `${baseName(image.name)}-cleaned.png`, []);
    const job = useProcessingJob(original, fileNameFor);
    const pending = job.status === "success" ? job.result : null;
    const busy = job.status === "uploading" || job.status === "processing";
    const settled = useSettled(Boolean(pending), 500);
    const finishing = Boolean(pending) && !settled;
    const [preparing, setPreparing] = useState(false);
    const [compareOn, setCompareOn] = useState(false);
    const [compare, setCompare] = useState<CompareMode>("slider");
    const [showBefore, setShowBefore] = useState(false);
    const [notice, setNotice] = useState<Notice | null>(null);
    const [sheetOpen, setSheetOpen] = useState(false);
    const closeSheet = useCallback(() => setSheetOpen(false), []);
    const [downloaded, setDownloaded] = useState(false);

    // The result is in and the processing effect has faded: open into the comparison, and say how it went.
    useEffect(() => {
        if (!settled) return;
        setCompareOn(true);
        setShowBefore(false);
        const warning = warnings.current[0];
        setNotice(warning ? { tone: "error", text: warning === "UNCHANGED" ? copy.unchanged : copy.rough } : { tone: "success", text: copy.done });
    }, [settled, copy.done, copy.rough, copy.unchanged]);

    const comparePair = pending ? { before: base, after: pending, beforeLabel: shared.before } : session.version > 0 ? { before: versions.current[0]!, after: base, beforeLabel: shared.original } : null;
    const comparing = Boolean(comparePair && compareOn && (!pending || settled));
    const paintable = !busy && !pending && !preparing && !comparing;

    /** `again`: replace the result on screen with a fresh attempt (Try again). */
    const run = async (again = false) => {
        if (busy || preparing || (pending && !again)) return;
        if (selection.empty) {
            setNotice({ tone: "error", text: copy.emptySelection });
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
        setNotice(null);
        const image = base.blob;
        void job.run(async (_file, options) => {
            const result = await removeWatermark({ image, fileName: original.name, mask: maskPng }, options);
            warnings.current = result.warnings;
            return result;
        });
    };

    const accept = () => {
        if (!pending) return;
        // The job owns (and will revoke) the result's URL; the kept version gets its own.
        versions.current.push({ ...pending, url: URL.createObjectURL(pending.blob) });
        commit(() => ({ version: versions.current.length - 1, strokes: [], selected: [] }));
        job.reset();
        setCompareOn(false);
        setNotice({ tone: "success", text: copy.kept });
    };
    const discard = () => {
        job.reset();
        setCompareOn(false);
        setNotice({ tone: "info", text: copy.discarded });
    };
    const tryAgain = () => {
        setCompareOn(false);
        void run(true);
    };

    const forgetFailure = () => {
        if (job.status === "error") job.reset();
    };
    const onStroke = (stroke: SelectionStroke) => {
        commit((doc) => ({ ...doc, strokes: [...doc.strokes, stroke] }));
        forgetFailure();
        setNotice({ tone: "info", text: copy.selected });
    };
    const setSelected = (selected: string[]) => {
        commit((doc) => ({ ...doc, selected }));
        forgetFailure();
    };

    const canUndo = !busy && (Boolean(pending) || history.canUndo);
    const canRedo = !busy && !pending && history.canRedo;
    const undo = () => {
        if (busy) return;
        if (pending) return discard();
        if (!history.canUndo) return;
        history.undo();
        forgetFailure();
        setCompareOn(false);
        setNotice({ tone: "info", text: shared.notices.undone });
    };
    const redo = () => {
        if (busy || pending || !history.canRedo) return;
        history.redo();
        forgetFailure();
        setCompareOn(false);
        setNotice({ tone: "info", text: shared.notices.redone });
    };
    const resetAll = () => {
        job.reset();
        commit(() => ({ ...INITIAL, selected: (detections[0]?.list ?? []).filter((item) => item.confidence >= PRESELECT).map((item) => item.id) }));
        setCompareOn(false);
        setNotice({ tone: "info", text: shared.notices.reset });
    };
    const clearSelection = () => {
        commit((doc) => ({ ...doc, strokes: [], selected: [] }));
        forgetFailure();
        setNotice({ tone: "info", text: copy.cleared });
    };
    const autoDetect = () => void detect(session.version, base);

    // ------------------------------------------------------------------ download
    const downloadable = pending ?? (session.version > 0 ? base : null);
    useEffect(() => {
        if (!downloaded) return;
        const timer = window.setTimeout(() => setDownloaded(false), 2200);
        return () => window.clearTimeout(timer);
    }, [downloaded]);
    const download = () => {
        if (!downloadable) return;
        downloadFile(downloadable.url, downloadable.fileName);
        setDownloaded(true);
        setNotice({ tone: "success", text: copy.downloaded(downloadable.fileName) });
    };

    // ------------------------------------------------------------------ keyboard
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
            const next = TOOL_BY_KEY[key];
            if (next) setTool(next);
            else if (key === "enter" && !(event.target instanceof HTMLButtonElement)) void handlers.current.run(false);
            else if (key === "[" || key === "]") {
                setBrush((currentBrush) => {
                    const step = Math.max(1, Math.round(currentBrush.size * 0.15));
                    return { ...currentBrush, size: Math.min(maxBrush, Math.max(2, currentBrush.size + (key === "]" ? step : -step))) };
                });
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [maxBrush]);

    // ------------------------------------------------------------------ status line
    const shownNotice: Notice | null = job.status === "error" ? { tone: "error", text: removalError(t, job.error) } : busy ? { tone: "info", text: copy.removing } : notice;
    const rough = Boolean(pending && settled && warnings.current.length);

    // ------------------------------------------------------------------ pieces
    const iconButton =
        "grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-secondary transition-colors duration-150 outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-35 pointer-coarse:size-11";
    const actions = (
        <>
            <button type="button" className={iconButton} onClick={undo} disabled={!canUndo} aria-label={shared.undo} title={`${shared.undo} (⌘Z)`}>
                <Undo2 className="size-[1.125rem]" aria-hidden />
            </button>
            <button type="button" className={iconButton} onClick={redo} disabled={!canRedo} aria-label={shared.redo} title={`${shared.redo} (⇧⌘Z)`}>
                <Redo2 className="size-[1.125rem]" aria-hidden />
            </button>
            <button type="button" className={cn(iconButton, "hidden sm:grid")} onClick={resetAll} disabled={busy || (session.version === 0 && session.strokes.length === 0 && !pending)} aria-label={shared.resetAll} title={shared.resetAll}>
                <RotateCcw className="size-[1.125rem]" aria-hidden />
            </button>
            <button
                type="button"
                className={cn(iconButton, compareOn && comparePair && "bg-[var(--brand-soft)] text-[var(--brand)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand)]")}
                onClick={() => setCompareOn((value) => !value)}
                disabled={!comparePair || busy || finishing}
                aria-pressed={compareOn}
                aria-label={shared.compare}
                title={shared.compare}
            >
                <GitCompareArrows className="size-[1.125rem]" aria-hidden />
            </button>
        </>
    );
    const exportSlot = (
        <button type="button" onClick={download} disabled={!downloadable} className={studioExportButton}>
            {downloaded ? <Check className="size-4" aria-hidden /> : <Download className="size-4" aria-hidden />}
            <span className="sr-only sm:not-sr-only">{copy.download}</span>
        </button>
    );
    const detectButton = (compact: boolean) =>
        compact ? (
            <button
                type="button"
                onClick={autoDetect}
                disabled={!paintable || detecting}
                title={copy.autoDetectHint}
                className="flex min-h-12 min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[0.6875rem] font-medium text-tertiary outline-focus-ring hover:text-primary focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-35"
            >
                <ScanSearch className={cn("size-[1.125rem]", detecting && "animate-pulse motion-reduce:animate-none")} aria-hidden />
                <span className="truncate">{copy.autoDetect}</span>
            </button>
        ) : (
            <Button size="sm" color="secondary" iconLeading={ScanSearch} onPress={autoDetect} isDisabled={!paintable || detecting} className="press-scale pointer-coarse:min-h-11">
                {detecting ? copy.detecting : copy.autoDetect}
            </Button>
        );

    const controls = (
        <>
            {pending && settled && (
                <section className="animate-enter flex flex-col gap-3 rounded-xl border border-[var(--brand-line)] bg-[var(--brand-soft)] p-4 [--i:-1]">
                    <p className="text-sm font-semibold text-primary">{rough ? copy.rough : copy.done}</p>
                    <Segmented
                        size="sm"
                        label={shared.compareLabel}
                        value={compare}
                        onChange={(next) => {
                            setCompare(next);
                            setCompareOn(true);
                        }}
                        className="w-full bg-primary [&>button]:flex-1"
                        options={(["slider", "split", "toggle"] as const).map((value) => ({ value, label: shared.compareModes[value] }))}
                    />
                    <div className="grid grid-cols-2 gap-2">
                        <Button size="md" color="secondary" iconLeading={X} onPress={discard} className="press-scale pointer-coarse:min-h-11">
                            {rough ? copy.adjust : copy.discard}
                        </Button>
                        <Button size="md" color="primary" iconLeading={Check} onPress={accept} className="press-scale pointer-coarse:min-h-11">
                            {copy.keep}
                        </Button>
                    </div>
                    {rough && (
                        <Button size="sm" color="tertiary" iconLeading={RotateCcw} onPress={tryAgain} className="press-scale self-start pointer-coarse:min-h-11">
                            {copy.tryAgain}
                        </Button>
                    )}
                </section>
            )}
            <div className="flex flex-col gap-3">
                <DetectionList detections={current?.status === "done" ? list : null} selected={session.selected} onChange={setSelected} detecting={detecting} failed={current?.status === "failed"} disabled={!paintable} />
                <div className="flex items-center justify-between gap-2">
                    {detectButton(false)}
                    {session.version > 0 && <span className="text-xs text-tertiary">{copy.history(session.version)}</span>}
                </div>
            </div>
            <div className="border-t border-[var(--card-line)] pt-5">
                <BrushSettings
                    tool={tool}
                    onToolChange={setTool}
                    tools={ALL_TOOLS}
                    hideToolsOnDesktop
                    brush={brush}
                    onBrushChange={(next) => {
                        setBrush(next);
                        if (tool === "move") setTool("paint");
                    }}
                    maxSize={maxBrush}
                    coverage={selection.empty ? null : shared.selectionSize(`${Math.max(1, Math.round(selection.coverage * 100))}%`)}
                    onClear={clearSelection}
                    disabled={!paintable}
                />
                <p className="mt-3 text-xs text-quaternary">{copy.shortcuts}</p>
            </div>
            <PermissionNote />
        </>
    );

    const removeButton = (compact: boolean) => (
        <Button size={compact ? "md" : "lg"} color="primary" onPress={() => void run()} isDisabled={preparing || !paintable} className={cn("press-scale", compact ? "min-h-12 px-3.5" : "pointer-coarse:min-h-12")}>
            <span className="flex items-center justify-center gap-2">
                {preparing ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Stamp className="size-4" aria-hidden />}
                {compact ? copy.removeShort : copy.removeSelected}
            </span>
        </Button>
    );

    // ------------------------------------------------------------------ canvas
    const before = comparePair && { src: comparePair.before.url, alt: `${comparePair.beforeLabel}: ${original.name}`, label: comparePair.beforeLabel };
    const after = comparePair && { src: comparePair.after.url, alt: copy.resultAlt, label: shared.after };
    const split = comparing && compare === "split";
    const overlay = (frame: FrameSize) => (
        <>
            {detecting && !pending && !busy && <AnalyzingOverlay src={original.previewUrl} alt={original.name} frame={frame} />}
            {paintable && !detecting && list.length > 0 && <DetectionOverlay detections={list} selected={session.selected} width={width} height={height} onToggle={(id) => setSelected(session.selected.includes(id) ? session.selected.filter((entry) => entry !== id) : [...session.selected, id])} />}
            {pending && !comparing && <img src={pending.url} alt={copy.resultAlt} draggable={false} className="retouch-reveal absolute inset-0 size-full" />}
            {(busy || finishing) && (
                <ProcessingOverlay
                    frame={frame}
                    mask={mask.canvas}
                    bounds={selection.bounds}
                    status={finishing ? "finishing" : job.status === "uploading" ? "uploading" : "processing"}
                    uploadProgress={job.uploadProgress}
                    startedAt={job.startedAt}
                    onCancel={busy ? job.cancel : undefined}
                    stages={copy.removeStages}
                />
            )}
            {comparing && before && after && compare !== "split" && <ComparisonLayer key={`${after.src}-${compare}`} mode={compare} before={before} after={after} showBefore={showBefore} />}
        </>
    );

    return (
        <StudioShell tool="watermarkRemover" actions={actions} exportSlot={exportSlot} panel={<PanelBody>{controls}</PanelBody>} panelLabel={copy.controlsLabel} dirty={session !== INITIAL || Boolean(pending)} mobilePanel="none">
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
                        tools={ALL_TOOLS}
                        brush={brush}
                        paintable={paintable}
                        showMask={paintable || preparing}
                        overlayInteractive={comparing && compare === "slider"}
                        overlay={overlay}
                        top={comparing ? <CompareControls mode={compare} onModeChange={setCompare} showBefore={showBefore} onShowBeforeChange={setShowBefore} /> : undefined}
                        info={`${formatDimensions(base.dimensions)} · ${formatBytes(base.blob.size)}`}
                        onStroke={onStroke}
                    />
                )}
            </StudioCanvas>

            {shownNotice && <StudioNotice notice={shownNotice} />}

            <div className="hidden lg:block">
                {!busy && !finishing && (
                    <StudioActions>
                        {pending ? (
                            <>
                                <Button size="lg" color="secondary" iconLeading={X} onPress={discard} className="press-scale">
                                    {rough ? copy.adjust : copy.discard}
                                </Button>
                                <Button size="lg" color="primary" iconLeading={Check} onPress={accept} className="press-scale">
                                    {copy.keep}
                                </Button>
                            </>
                        ) : (
                            <>
                                {downloadable && (
                                    <Button size="lg" color="secondary" iconLeading={downloaded ? Check : Download} onPress={download} className="press-scale">
                                        {copy.download}
                                    </Button>
                                )}
                                {removeButton(false)}
                            </>
                        )}
                    </StudioActions>
                )}
            </div>

            <RetouchToolbar
                tool={tool}
                onToolChange={setTool}
                tools={["paint", "erase"]}
                extra={detectButton(true)}
                paintable={paintable}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={undo}
                onRedo={redo}
                onOpenSettings={() => setSheetOpen(true)}
                action={
                    pending && settled ? (
                        <Button size="md" color="primary" iconLeading={Check} onPress={accept} className="press-scale min-h-12 px-3.5">
                            {copy.keep}
                        </Button>
                    ) : (
                        removeButton(true)
                    )
                }
            />

            <BottomSheet open={sheetOpen} onClose={closeSheet} title={copy.controlsLabel} closeLabel={shared.closeSettings}>
                {controls}
            </BottomSheet>
        </StudioShell>
    );
}
