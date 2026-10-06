import { Crop, Eye, LoaderCircle, Redo2, RotateCcw, Scaling, SlidersHorizontal, Sparkles, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/base/buttons/button";
import { PanelBody, PanelIntro, PanelTabs, StudioActions, StudioCanvas, StudioDropzone, StudioError, StudioNotice } from "@/components/studio/StudioParts";
import { StudioShell } from "@/components/studio/StudioShell";
import { baseName, formatDimensions } from "@/features/image-processing/format";
import { cn } from "@/lib/utils/cn";
import { type ToolOutput, usePublishOutput, useToolImage } from "@/store/useImageStore";
import { AdjustPanel } from "./AdjustPanel";
import { CropControls } from "./CropControls";
import { CropStage } from "./CropStage";
import { ExportMenu } from "./ExportMenu";
import { FiltersPanel } from "./FiltersPanel";
import { outputSize } from "./geometry";
import { aspectRatio } from "./operations";
import { decodeSource, type EditState, EXTENSIONS, formatFromMime, makePreviewBase, paintPreview, renderEdit } from "./render";
import { ResizePanel } from "./ResizePanel";
import { isUnedited, useEditStore } from "./useEditStore";
import { useT } from "@/i18n";

export type EditorTab = "adjust" | "filters" | "crop" | "resize";

const TAB_ICONS = { adjust: SlidersHorizontal, filters: Sparkles, crop: Crop, resize: Scaling } as const;
/** The crop tool keeps to geometry; the editor has everything. */
const TABS: Record<"crop" | "edit", readonly EditorTab[]> = { crop: ["crop", "resize"], edit: ["adjust", "filters", "crop", "resize"] };

interface PhotoEditorProps {
    /** "crop" is the focused crop tool; "edit" is the full editor. */
    mode: "crop" | "edit";
}

interface Decoded {
    id: string;
    bitmap: ImageBitmap;
    preview: ImageData;
    thumbnail: ImageData;
}

const NEUTRAL = { exposure: 0, brightness: 0, contrast: 0, saturation: 0, warmth: 0, tint: 0 };

/**
 * The editor and the crop tool, in the shared studio: the photo in the middle, the tools for the
 * current task on the right, undo/redo and export in the top bar. Everything runs in the browser.
 */
export function PhotoEditor({ mode }: PhotoEditorProps) {
    const t = useT();
    const copy = t.studio;
    const toolImage = useToolImage();
    const original = toolImage.image;
    const [decoded, setDecoded] = useState<Decoded | null>(null);
    const [decodeError, setDecodeError] = useState<string | null>(null);
    const [tab, setTab] = useState<EditorTab>(mode === "crop" ? "crop" : "adjust");
    const [comparing, setComparing] = useState(false);
    const [straightening, setStraightening] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const session = useEditStore((state) => state.session);
    const { open, preview, commit, undo, redo, reset } = useEditStore.getState();
    const edit = session && decoded && session.imageId === decoded.id ? session.present : null;

    // Decode the chosen image once (EXIF-aware) and prepare preview and thumbnail copies.
    useEffect(() => {
        if (!original) return;
        let cancelled = false;
        decodeSource(original.file)
            .then((bitmap) => {
                if (cancelled) return bitmap.close();
                setDecodeError(null);
                const previewBase = makePreviewBase(bitmap, 1600);
                const thumbnail = makePreviewBase(bitmap, 160);
                open(original.id, bitmap.width, bitmap.height);
                setDecoded((current) => {
                    current?.bitmap.close();
                    return { id: original.id, bitmap, preview: previewBase, thumbnail };
                });
            })
            .catch(() => !cancelled && setDecodeError("failed"));
        return () => {
            cancelled = true;
        };
    }, [original, open]);

    // Paint the preview whenever the look changes (or while comparing with the original).
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !decoded || !edit) return;
        const frame = requestAnimationFrame(() => paintPreview(canvas, decoded.preview, comparing ? "original" : edit.filter, comparing ? NEUTRAL : edit.adjustments));
        return () => cancelAnimationFrame(frame);
    }, [decoded, edit, comparing]);

    // Keyboard: ⌘Z / ⇧⌘Z, hold M to compare.
    useEffect(() => {
        const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName));
        const onDown = (event: KeyboardEvent) => {
            if (typing(event.target)) return;
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
                event.preventDefault();
                if (event.shiftKey) redo();
                else undo();
            } else if (event.key.toLowerCase() === "m" && !event.repeat && mode === "edit") {
                setComparing(true);
            }
        };
        const onUp = (event: KeyboardEvent) => event.key.toLowerCase() === "m" && setComparing(false);
        window.addEventListener("keydown", onDown);
        window.addEventListener("keyup", onUp);
        return () => {
            window.removeEventListener("keydown", onDown);
            window.removeEventListener("keyup", onUp);
        };
    }, [undo, redo, mode]);

    // Every other tool (and a reload) opens the edited image: render it at full size once edits settle.
    // Unedited, the output is "unchanged", which puts the image the editor opened back.
    const [rendered, setRendered] = useState<{ edit: EditState; output: ToolOutput } | null>(null);
    const unedited = !edit || !session || isUnedited(edit, session.source.width, session.source.height);
    const bitmap = decoded?.bitmap ?? null;
    useEffect(() => {
        if (!original || !bitmap || !edit || unedited) return;
        let cancelled = false;
        const format = formatFromMime(original.mimeType);
        const timer = window.setTimeout(() => {
            renderEdit(bitmap, edit, format)
                .then((blob) => {
                    if (cancelled) return;
                    const width = Math.max(1, Math.round(edit.resize?.width ?? edit.crop.w));
                    const height = Math.max(1, Math.round(edit.resize?.height ?? edit.crop.h));
                    setRendered({ edit, output: { blob, name: `${baseName(original.name)}-${mode === "crop" ? "cropped" : "edited"}.${EXTENSIONS[format]}`, dimensions: { width, height } } });
                })
                .catch(() => undefined);
        }, 700);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [original, bitmap, edit, unedited, mode]);
    // While the latest edit is still rendering, nothing is published (the last result stays).
    usePublishOutput(toolImage, unedited ? null : rendered?.edit === edit ? rendered.output : undefined, mode === "crop" ? "crop" : "editor");

    const source = useMemo(() => (session ? session.source : { width: 1, height: 1 }), [session]);
    const lockedAspect = session && edit ? aspectRatio(session.aspect, session.portrait, edit, source) : null;
    const onPreview = useCallback((next: EditState) => preview(next), [preview]);
    const onCommit = useCallback((next: EditState) => commit(next), [commit]);

    const ready = Boolean(original && decoded && edit);
    const edited = edit && session ? !isUnedited(edit, session.source.width, session.source.height) : false;
    const size = edit ? (edit.resize ?? outputSize(edit.crop)) : null;
    const tool = mode === "crop" ? "crop" : "editor";
    const iconButton =
        "grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-secondary transition-colors duration-150 outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-35 pointer-coarse:size-11";

    const actions = ready ? (
        <>
            <button type="button" className={iconButton} onClick={undo} disabled={!session?.past.length} aria-label={t.editor.undo} title={`${t.editor.undo} (⌘Z)`}>
                <Undo2 className="size-[1.125rem]" aria-hidden />
            </button>
            <button type="button" className={iconButton} onClick={redo} disabled={!session?.future.length} aria-label={t.editor.redo} title={`${t.editor.redo} (⇧⌘Z)`}>
                <Redo2 className="size-[1.125rem]" aria-hidden />
            </button>
            <button type="button" className={cn(iconButton, "hidden sm:grid")} onClick={reset} disabled={!edited} aria-label={t.editor.revertAria} title={t.editor.revertAria}>
                <RotateCcw className="size-[1.125rem]" aria-hidden />
            </button>
        </>
    ) : null;

    const exportSlot =
        ready && edit && original ? <ExportMenu source={decoded?.bitmap ?? null} edit={edit} defaultFormat={formatFromMime(original.mimeType)} baseName={baseName(original.name)} suffix={mode === "crop" ? "cropped" : "edited"} /> : null;

    const panel = (
        <>
            <PanelTabs
                label={t.editor.editTools}
                value={tab}
                onChange={setTab}
                tabs={TABS[mode].map((id) => {
                    const Icon = TAB_ICONS[id];
                    return { id, label: t.editor.tabs[id], icon: <Icon className="size-4" aria-hidden />, disabled: !ready };
                })}
            />
            <PanelBody id={ready ? tab : "intro"}>
                {!ready || !edit ? (
                    <>
                        <PanelIntro title={copy.howItWorks} steps={copy.intros[tool].steps} />
                        <p className="rounded-xl bg-secondary p-3 text-xs text-tertiary">{t.editor.localNote}</p>
                    </>
                ) : (
                    <>
                        {tab === "adjust" && <AdjustPanel adjustments={edit.adjustments} onChange={(adjustments) => onPreview({ ...edit, adjustments })} onCommit={(adjustments) => onCommit({ ...edit, adjustments })} />}
                        {tab === "filters" && <FiltersPanel thumbnail={decoded?.thumbnail ?? null} value={edit.filter} onSelect={(filter) => onCommit({ ...edit, filter })} />}
                        {tab === "crop" && <CropControls edit={edit} source={source} onPreview={onPreview} onCommit={onCommit} onStraighteningChange={setStraightening} />}
                        {tab === "resize" && (
                            // Re-key on size so the text fields reset when the crop or resize changes elsewhere.
                            <ResizePanel key={`${Math.round(edit.crop.w)}x${Math.round(edit.crop.h)}:${edit.resize?.width ?? 0}x${edit.resize?.height ?? 0}`} edit={edit} onCommit={onCommit} />
                        )}
                        <Button size="md" color="secondary" iconLeading={RotateCcw} onPress={reset} isDisabled={!edited} className="press-scale w-full pointer-coarse:min-h-11">
                            {t.editor.revert}
                        </Button>
                    </>
                )}
            </PanelBody>
        </>
    );

    return (
        <StudioShell tool={tool} actions={actions} exportSlot={exportSlot} panel={panel} panelLabel={t.editor.editTools} dirty={edited}>
            <StudioCanvas>
                {!original ? (
                    <StudioDropzone title={copy.dropTitle} hint={copy.intros[tool].hint} />
                ) : decodeError ? (
                    <StudioError title={copy.errorTitle} message={t.editor.openFailed} />
                ) : edit && decoded ? (
                    <>
                        <CropStage
                            source={source}
                            edit={edit}
                            interactive={tab === "crop"}
                            aspect={lockedAspect}
                            straightening={straightening}
                            onPreview={onPreview}
                            onCommit={onCommit}
                            className="min-h-0 flex-1"
                            image={<canvas ref={canvasRef} className="block size-full" aria-label={t.editor.editingAlt(original.name)} role="img" />}
                        />
                        {/* Holding Compare: say so on the photo itself. */}
                        <span
                            role="status"
                            className={cn(
                                "pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-lg border border-[var(--card-line)] bg-primary px-3 py-1.5 text-xs font-semibold text-primary shadow-sm transition-[opacity,scale] duration-200",
                                comparing ? "scale-100 opacity-100" : "scale-95 opacity-0",
                            )}
                        >
                            {comparing ? t.editor.showingOriginal : ""}
                        </span>
                    </>
                ) : (
                    <p role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-tertiary">
                        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                        {t.editor.opening}
                    </p>
                )}
            </StudioCanvas>

            {ready && original && size && <StudioNotice notice={{ tone: edited ? "success" : "info", text: edited ? `${copy.editedNotice} · ${formatDimensions(size)}` : copy.editingNotice(original.name, formatDimensions(size)) }} />}

            {ready && mode === "edit" && (
                <StudioActions>
                    <Button
                        size="lg"
                        color="secondary"
                        iconLeading={Eye}
                        onPressStart={() => setComparing(true)}
                        onPressEnd={() => setComparing(false)}
                        aria-label={t.editor.compareAria}
                        className="press-scale pointer-coarse:min-h-12"
                    >
                        {t.editor.compare}
                    </Button>
                </StudioActions>
            )}
        </StudioShell>
    );
}
