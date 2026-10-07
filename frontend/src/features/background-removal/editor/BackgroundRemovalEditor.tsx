import { ChevronDown, Download, Image as ImageIcon, LoaderCircle, PencilLine, Redo2, RotateCcw, Undo2, Wand2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Segmented } from "@/components/common/Segmented";
import { ClearImageButton, type Notice, PanelBody, PanelTabs, StudioActions, StudioCanvas, StudioNotice } from "@/components/studio/StudioParts";
import { StudioShell } from "@/components/studio/StudioShell";
import { studioExportButton } from "@/components/studio/styles";
import { usePopover } from "@/components/studio/usePopover";
import { Button } from "@/components/ui/base/buttons/button";
import { type ExportFormat, formatOf, QUALITY } from "@/features/image-processing/exportFormat";
import { baseName } from "@/features/image-processing/format";
import { ROUTES } from "@/lib/constants/routes";
import { downloadFile } from "@/lib/utils/download";
import { cn } from "@/lib/utils/cn";
import { useImageStore } from "@/store/useImageStore";
import { useT } from "@/i18n";
import { type BackgroundSession, rememberResult } from "../resume";
import { BackgroundControls, type UploadedBackground } from "./BackgroundControls";
import { isTransparent } from "./backgrounds";
import { exportComposition } from "./composition";
import { type EditorDoc, INITIAL_DOC, type Stroke, useDocHistory } from "./document";
import { type BrushSettings, type CanvasTool, type CanvasView, EditorCanvas } from "./EditorCanvas";
import { ExportPanel } from "./ExportPanel";
import { RefineCard, RefinePanel } from "./RefinePanel";
import { useMaskEngine } from "./useMaskEngine";

type Tab = "background" | "refine";

interface BackgroundRemovalEditorProps {
    /** The photo, the model's cut-out and the edits so far — reopened exactly as they were left. */
    background: BackgroundSession;
    /** The shared image's session, for publishing the result back to it. */
    session: string;
}

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Decoded photo backgrounds, by URL, kept for the session so undo never has to wait for a decode. */
function usePhotoBitmaps(url: string | null) {
    const [bitmaps, setBitmaps] = useState<Record<string, ImageBitmap>>({});
    const all = useRef(bitmaps);
    useEffect(() => {
        all.current = bitmaps;
    }, [bitmaps]);
    useEffect(() => {
        if (!url || bitmaps[url]) return;
        let cancelled = false;
        fetch(url)
            .then((response) => response.blob())
            .then((blob) => createImageBitmap(blob))
            .then((bitmap) => {
                if (cancelled) return bitmap.close();
                setBitmaps((current) => ({ ...current, [url]: bitmap }));
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [url, bitmaps]);
    useEffect(() => () => Object.values(all.current).forEach((bitmap) => bitmap.close()), []);
    return { photo: url ? (bitmaps[url] ?? null) : null, loading: Boolean(url && !bitmaps[url]) };
}

/**
 * The background studio: the cut-out on a large canvas, the tools for it beside it, and the export a
 * click away. Everything after the server's cut-out happens on this device.
 */
export function BackgroundRemovalEditor({ background, session }: BackgroundRemovalEditorProps) {
    const { source: original, cutout } = background;
    const t = useT();
    const copy = t.bgEditor;
    const navigate = useNavigate();
    const setOriginal = useImageStore((state) => state.setOriginal);

    const history = useDocHistory(background.doc);
    const { doc } = history;
    const engine = useMaskEngine(original.previewUrl, cutout.url);
    const { sync } = engine;

    const [tab, setTab] = useState<Tab>("background");
    const [tool, setTool] = useState<CanvasTool>("move");
    const [view, setView] = useState<CanvasView>("after");
    const [brushState, setBrushState] = useState<BrushSettings>({ mode: "erase", size: 0, softness: 0.5, opacity: 1 });
    const shortSide = Math.min(engine.width, engine.height) || 1000;
    const brush: BrushSettings = { ...brushState, size: brushState.size || Math.max(8, Math.round(shortSide * 0.04)) };
    const maxBrush = Math.max(40, Math.round(shortSide * 0.3));

    const [uploaded, setUploaded] = useState<UploadedBackground | null>(null);
    /**
     * Every uploaded background stays alive until the editor closes — undo may bring any of them back.
     * The one in use outlives it: the remembered session still shows it when the studio reopens.
     */
    const uploads = useRef<string[]>([]);

    const photoUrl = doc.background.kind === "image" ? doc.background.url : null;
    const { photo, loading: photoLoading } = usePhotoBitmaps(photoUrl);

    const [chosenFormat, setFormat] = useState<ExportFormat>("png");
    const [quality, setQuality] = useState(QUALITY);
    // JPG can't hold transparency, so a transparent image always leaves as PNG/WebP.
    const format: ExportFormat = isTransparent(doc.background) && !formatOf(chosenFormat).alpha ? "png" : chosenFormat;
    const [exporting, setExporting] = useState<"download" | "continue" | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);
    const [notice, setNotice] = useState<Notice>({ tone: "success", text: copy.removedSuccess });

    const { open: exportOpen, setOpen: setExportOpen, wrap: exportWrap, trigger: exportTrigger } = usePopover();

    // The mask follows the document: undo/redo/reset rebuild it; a fresh stroke is already in it.
    useEffect(() => {
        if (engine.ready) sync(doc.strokes);
    }, [engine.ready, sync, doc.strokes]);

    const changeBrush = (next: BrushSettings) => {
        setBrushState(next);
        setTool("brush");
        setView("after");
    };
    const changeTab = (next: Tab) => {
        setTab(next);
        setTool(next === "refine" ? "brush" : "move");
        setView("after");
    };

    const commit = history.commit;
    const onStroke = useCallback((stroke: Stroke) => commit((current: EditorDoc) => ({ ...current, strokes: [...current.strokes, stroke] })), [commit]);

    const undo = useCallback(() => {
        if (!history.canUndo) return;
        history.undo();
        setNotice({ tone: "info", text: copy.undone });
    }, [history, copy.undone]);
    const redo = useCallback(() => {
        if (!history.canRedo) return;
        history.redo();
        setNotice({ tone: "info", text: copy.redone });
    }, [history, copy.redone]);
    const resetAll = () => {
        commit(() => INITIAL_DOC);
        setNotice({ tone: "info", text: copy.resetDone });
    };
    const resetMask = () => commit((current) => ({ ...current, strokes: [] }));

    const onUpload = async (file: File) => {
        const url = URL.createObjectURL(file);
        try {
            // Decode before using it, so an unreadable file is reported instead of silently blank.
            (await createImageBitmap(file)).close();
        } catch (error) {
            URL.revokeObjectURL(url);
            throw error;
        }
        uploads.current.push(url);
        const next = { id: `upload-${crypto.randomUUID()}`, url, name: file.name };
        setUploaded(next);
        commit((current) => ({ ...current, background: { kind: "image", id: next.id, url, zoom: 1, x: 0.5, y: 0.5 } }));
    };
    const onRemoveUpload = () => {
        if (uploaded && doc.background.kind === "image" && doc.background.id === uploaded.id) commit((current) => ({ ...current, background: { kind: "transparent" } }));
        setUploaded(null);
    };

    const render = async (as: ExportFormat) => {
        const subject = engine.subject();
        if (!subject) throw new Error("not-ready");
        history.settle();
        return exportComposition(doc, subject, photo, as, quality);
    };

    const download = async () => {
        setExporting("download");
        setExportError(null);
        try {
            const blob = await render(format);
            // A browser without a WebP encoder hands back PNG; name the file for what it really is.
            const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
            const name = `${baseName(original.name)}-${isTransparent(doc.background) ? "no-background" : "edited"}.${extension}`;
            const url = URL.createObjectURL(blob);
            downloadFile(url, name);
            window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
            setNotice({ tone: "success", text: copy.downloaded(name) });
            setExportOpen(false);
        } catch {
            setExportError(copy.exportFailed);
            setNotice({ tone: "error", text: copy.exportFailed });
        } finally {
            setExporting(null);
        }
    };

    /** Carries the finished image into the full editor, as a new image of its own. */
    const continueEditing = async () => {
        setExporting("continue");
        try {
            const blob = await render("png");
            const file = new File([blob], `${baseName(original.name)}-${isTransparent(doc.background) ? "no-background" : "edited"}.png`, { type: "image/png" });
            setOriginal({
                id: crypto.randomUUID(),
                file,
                name: file.name,
                size: file.size,
                mimeType: file.type,
                previewUrl: URL.createObjectURL(file),
                dimensions: { width: engine.width, height: engine.height },
            });
            navigate(ROUTES.editor);
        } catch {
            setNotice({ tone: "error", text: copy.exportFailed });
            setExporting(null);
        }
    };

    // Every tool (and a reload) opens the latest composition: once edits settle, it's rendered at full
    // size and becomes the shared image, and the session remembers the edits behind it.
    const publishImage = useImageStore((state) => state.publish);
    /** The engine's live canvas — the same object for the editor's life, so it's a stable dependency. */
    const subject = engine.ready ? engine.subject() : null;
    const latest = useRef({ doc, photo, subject });
    useLayoutEffect(() => {
        latest.current = { doc, photo, subject };
    });
    /** The document last sent out; the session's own starting point is already the shared image. */
    const sent = useRef<{ doc: EditorDoc; photo: ImageBitmap | null } | null>({ doc: background.doc, photo: null });
    const sequence = useRef(0);
    const publishLatest = useCallback(() => {
        const { doc: current, photo: currentPhoto, subject: canvas } = latest.current;
        if (!canvas || (sent.current?.doc === current && (current.background.kind !== "image" || sent.current.photo === currentPhoto))) return;
        // A photo background that hasn't loaded yet would render without it; wait for it.
        if (current.background.kind === "image" && !currentPhoto) return;
        sent.current = { doc: current, photo: currentPhoto };
        const id = ++sequence.current;
        const size = { width: canvas.width, height: canvas.height };
        // Draws synchronously, so it's safe to start even while the editor is closing.
        exportComposition(current, canvas, currentPhoto, "png", QUALITY)
            .then((blob) => {
                if (id !== sequence.current) return;
                const name = `${baseName(original.name)}-${isTransparent(current.background) ? "no-background" : "edited"}.png`;
                const image = publishImage(session, { blob, name, dimensions: size }, "removeBackground");
                if (image) rememberResult(background, current, image.id);
            })
            .catch(() => undefined);
    }, [background, original.name, publishImage, session]);
    useEffect(() => {
        if (!subject) return;
        const timer = window.setTimeout(publishLatest, 350);
        return () => window.clearTimeout(timer);
    }, [doc, photo, subject, publishLatest]);
    // Leaving before the last change was sent (straight to another tool): send it now. A layout-effect
    // cleanup runs before the passive ones that release the photo and the engine's pixels.
    const flush = useRef(publishLatest);
    useLayoutEffect(() => {
        flush.current = publishLatest;
    });
    useLayoutEffect(
        () => () => {
            flush.current();
            const inUse = latest.current.doc.background;
            for (const url of uploads.current) if (inUse.kind !== "image" || inUse.url !== url) URL.revokeObjectURL(url);
        },
        [],
    );

    // Keyboard: undo/redo everywhere; tool and brush keys when not typing.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const mod = event.metaKey || event.ctrlKey;
            if (mod && event.key.toLowerCase() === "z") {
                if (isTyping(event.target)) return;
                event.preventDefault();
                if (event.shiftKey) redo();
                else undo();
                return;
            }
            if (mod && event.key.toLowerCase() === "y") {
                event.preventDefault();
                redo();
                return;
            }
            if (mod || event.altKey || isTyping(event.target)) return;
            const key = event.key.toLowerCase();
            if (key === "v") setTool("move");
            else if (key === "b") setTool("brush");
            else if (key === "e" || key === "r") {
                setBrushState((current) => ({ ...current, mode: key === "e" ? "erase" : "restore" }));
                setTool("brush");
            } else if (key === "[" || key === "]") {
                setBrushState((current) => {
                    const size = current.size || Math.max(8, Math.round(shortSide * 0.04));
                    const step = Math.max(1, Math.round(size * 0.15));
                    return { ...current, size: Math.min(maxBrush, Math.max(2, size + (key === "]" ? step : -step))) };
                });
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [undo, redo, shortSide, maxBrush]);

    /** The export controls, in the top-bar menu. */
    const exportPanel = (onContinue: () => void) => (
        <ExportPanel
            doc={doc}
            subject={engine.ready ? engine.subject() : null}
            photo={photo}
            revision={engine.revision}
            format={format}
            onFormatChange={setFormat}
            quality={quality}
            onQualityChange={setQuality}
            exporting={exporting === "download"}
            error={exportError}
            onDownload={() => void download()}
            onContinue={onContinue}
        />
    );

    const iconButton =
        "grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-secondary transition-colors duration-150 outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-35 pointer-coarse:size-11";

    const actions = (
        <>
            <button type="button" className={iconButton} onClick={undo} disabled={!history.canUndo} aria-label={copy.undo} title={`${copy.undo} (⌘Z)`}>
                <Undo2 className="size-[1.125rem]" aria-hidden />
            </button>
            <button type="button" className={iconButton} onClick={redo} disabled={!history.canRedo} aria-label={copy.redo} title={`${copy.redo} (⇧⌘Z)`}>
                <Redo2 className="size-[1.125rem]" aria-hidden />
            </button>
            <button type="button" className={cn(iconButton, "hidden sm:grid")} onClick={resetAll} disabled={doc === INITIAL_DOC} aria-label={copy.resetAll} title={copy.resetAll}>
                <RotateCcw className="size-[1.125rem]" aria-hidden />
            </button>
        </>
    );

    const exportSlot = (
        <div ref={exportWrap} className="relative">
            <button
                ref={exportTrigger}
                type="button"
                onClick={() => setExportOpen((open) => !open)}
                aria-expanded={exportOpen}
                aria-haspopup="dialog"
                disabled={!engine.ready}
                className={studioExportButton}
            >
                <Download className="size-4" aria-hidden />
                <span className="sr-only sm:not-sr-only">{copy.export}</span>
                <ChevronDown className={cn("size-4 opacity-70 transition-transform duration-200", exportOpen && "rotate-180")} aria-hidden />
            </button>
            {exportOpen && (
                <div role="dialog" aria-label={copy.exportTitle} className="absolute top-full right-0 z-50 mt-2 max-h-[calc(100dvh-5rem)] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border border-[var(--card-line)] bg-primary p-4 shadow-xl">
                    {exportPanel(() => setExportOpen(false))}
                </div>
            )}
        </div>
    );

    const panel = (
        <>
            <PanelTabs
                label={copy.controlsLabel}
                value={tab}
                onChange={changeTab}
                tabs={[
                    { id: "background" as Tab, label: copy.tabs.background, icon: <ImageIcon className="size-4" aria-hidden /> },
                    { id: "refine" as Tab, label: copy.tabs.refine, icon: <Wand2 className="size-4" aria-hidden /> },
                ]}
            />
            <PanelBody id={tab}>
                {tab === "background" ? (
                    <>
                        <BackgroundControls doc={doc} onCommit={commit} onPreview={history.preview} uploaded={uploaded} onUpload={onUpload} onRemoveUpload={onRemoveUpload} photoLoading={photoLoading} />
                        <div className="border-t border-[var(--card-line)] pt-5">
                            <RefineCard brush={brush} onBrushChange={changeBrush} maxSize={maxBrush} strokeCount={doc.strokes.length} onResetMask={resetMask} />
                        </div>
                    </>
                ) : (
                    <RefinePanel
                        brush={brush}
                        onBrushChange={changeBrush}
                        maxSize={maxBrush}
                        strokeCount={doc.strokes.length}
                        canUndo={history.canUndo}
                        canRedo={history.canRedo}
                        onUndo={undo}
                        onRedo={redo}
                        onResetMask={resetMask}
                    />
                )}
            </PanelBody>
        </>
    );

    return (
        <StudioShell tool="removeBackground" actions={actions} exportSlot={exportSlot} panel={panel} panelLabel={copy.controlsLabel} dirty={doc !== INITIAL_DOC}>
            <div className="flex justify-center">
                <Segmented
                    size="sm"
                    label={copy.compareLabel}
                    value={view}
                    onChange={setView}
                    options={[
                        { value: "before" as CanvasView, label: copy.before },
                        { value: "after" as CanvasView, label: copy.after },
                    ]}
                />
            </div>
            <StudioCanvas>
                <EditorCanvas
                    engine={engine}
                    doc={doc}
                    photo={photo}
                    tool={tool}
                    onToolChange={(next) => {
                        setTool(next);
                        setView("after");
                    }}
                    brush={brush}
                    view={view}
                    onPlacementPreview={(placement) => history.preview((current) => ({ ...current, placement }))}
                    onPlacementSettle={history.settle}
                    onStroke={onStroke}
                />
            </StudioCanvas>

            <StudioNotice notice={notice} />

            <StudioActions>
                <ClearImageButton />
                <Button size="lg" color="secondary" onPress={() => void continueEditing()} isDisabled={!engine.ready || exporting !== null} className="press-scale pointer-coarse:min-h-12">
                    <span className="flex items-center justify-center gap-2">
                        {exporting === "continue" ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <PencilLine className="size-4" aria-hidden />}
                        {copy.openInEditor}
                    </span>
                </Button>
                <Button size="lg" color="primary" onPress={() => void download()} isDisabled={!engine.ready || exporting !== null} className="press-scale pointer-coarse:min-h-12">
                    <span className="flex items-center justify-center gap-2">
                        {exporting === "download" ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Download className="size-4" aria-hidden />}
                        {exporting === "download" ? copy.preparingDownload : `${copy.downloadImage} · ${t.workspace.formatNames[format]}`}
                    </span>
                </Button>
            </StudioActions>
        </StudioShell>
    );
}
