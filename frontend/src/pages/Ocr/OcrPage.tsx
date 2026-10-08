import { getHTMLFromFragment, type JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { useEditorState } from "@tiptap/react";
import { GitCompareArrows, PenLine, ScanText, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Segmented } from "@/components/common/Segmented";
import { ImageProcessingPreview } from "@/components/studio/ImageProcessingPreview";
import { type Notice, PanelBody, PanelIntro, PanelTabs, StudioActions, StudioCanvas, StudioDropzone, StudioNotice, ClearImageButton } from "@/components/studio/StudioParts";
import { Button } from "@/components/ui/base/buttons/button";
import { baseName } from "@/features/image-processing/format";
import { type EditorMode, fitFontSizes, pageColours, plainText, toEditorContent } from "@/features/ocr/convert";
import { activeBlockId, focusBlock, uncertainRanges } from "@/features/ocr/extensions";
import { FindReplaceBar } from "@/features/ocr/FindReplaceBar";
import { ImagePane } from "@/features/ocr/ImagePane";
import { OcrPageView } from "@/features/ocr/OcrPageView";
import { BatchProgress, OcrShell, OcrSourceProvider, PdfPager, useOcrSource } from "@/features/ocr/OcrSource";
import { pageId, pageOf, turnImage } from "@/features/ocr/pdf";
import { ExportPopover } from "@/components/studio/ExportPopover";
import { ExportDialog } from "@/features/documents/ExportDialog";
import { EditPanel, type ExportKind, ExportPanel, ReadSettingsPanel } from "@/features/ocr/OcrPanels";
import { DEFAULT_SETTINGS, type ReadSettings } from "@/features/ocr/settings";
import { OcrToolbar } from "@/features/ocr/OcrToolbar";
import { printDocument } from "@/features/ocr/printPdf";
import { renderEditedImage } from "@/features/ocr/renderImage";
import { StageList } from "@/features/ocr/StageList";
import { useOcrEditor } from "@/features/ocr/useOcrEditor";
import { useOcrJob } from "@/features/ocr/useOcrJob";
import { type CompareMode, CompareControls, ComparisonLayer, SideBySide } from "@/features/retouch/BeforeAfterComparison";
import { Fitted } from "@/components/studio/StudioParts";
import type { OcrDocument } from "@/lib/api/ocrApi";
import { loadDraftOcr, saveDraftOcr } from "@/lib/draft";
import { cn } from "@/lib/utils/cn";
import { openInTextEditor } from "@/features/text/textDocument";
import { ROUTES } from "@/lib/constants/routes";
import { useNavigate } from "react-router-dom";
import { downloadFile } from "@/lib/utils/download";
import { ImageStoreContext, useSectionImageStore, useTextImageStore, useToolImage } from "@/store/useImageStore";
import type { ImageDimensions, ImageFile } from "@/types/image";
import { errorMessage, useT } from "@/i18n";

interface Reading {
    id: number;
    result: OcrDocument;
    content: JSONContent;
    restored: boolean;
}

/** A name that's safe on every system: no path separators or reserved characters, not too long. */
const safeName = (name: string) =>
    [...baseName(name)]
        .filter((char) => char.charCodeAt(0) >= 32)
        .join("")
        .replace(/[\\/:*?"<>|]+/g, "-")
        .replace(/^[.\s-]+|[.\s]+$/g, "")
        .slice(0, 80) || "text";

const useDesktop = () => {
    const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
    useEffect(() => {
        const media = window.matchMedia("(min-width: 1024px)");
        const onChange = () => setDesktop(media.matches);
        media.addEventListener("change", onChange);
        return () => media.removeEventListener("change", onChange);
    }, []);
    return desktop;
};

/** A text tool: it keeps its own image, apart from the image tools'. */
export function OcrPage() {
    return (
        <ImageStoreContext.Provider value={useTextImageStore}>
            <OcrSection />
        </ImageStoreContext.Provider>
    );
}

function OcrSection() {
    const { image } = useToolImage();
    return (
        <OcrSourceProvider image={image}>
            <OcrSectionBody image={image} />
        </OcrSourceProvider>
    );
}

function OcrSectionBody({ image }: { image: ImageFile | null }) {
    const { batch } = useOcrSource();
    if (batch) return <BatchStudio />;
    return image ? <OcrStudio key={image.id} image={image} /> : <EmptyStudio />;
}

/** The file a draft belongs to: the PDF an image is a page of, or the image itself. */
const sourceOf = (image: ImageFile) => pageOf(image.id)?.sourceId ?? image.id;

/** "Read all pages" at work, page by page. */
/** While the text is read: the shared processing effect (as in Remove Background). The stage list below says what's happening. */
function ReadingPreview({ src, alt, dimensions }: { src: string; alt: string; dimensions: ImageDimensions }) {
    return <Fitted dimensions={dimensions}>{(size) => <ImageProcessingPreview src={src} alt={alt} size={size} status="processing" />}</Fitted>;
}

function BatchStudio() {
    const t = useT();
    const { batch } = useOcrSource();
    if (!batch) return null;
    return (
        <OcrShell
            panel={
                <PanelBody>
                    <PanelIntro title={t.studio.howItWorks} steps={t.studio.intros.ocr.steps} />
                </PanelBody>
            }
            panelLabel={t.ocr.controlsLabel}
        >
            <StudioCanvas>
                <ReadingPreview key={batch.image.id} src={batch.image.previewUrl} alt={t.ocr.imageAlt(batch.image.name)} dimensions={batch.image.dimensions} />
            </StudioCanvas>
            <BatchProgress />
        </OcrShell>
    );
}

function EmptyStudio() {
    const t = useT();
    const intro = t.studio.intros.ocr;
    return (
        <OcrShell
            panel={
                <PanelBody>
                    <PanelIntro title={t.studio.howItWorks} steps={intro.steps} />
                </PanelBody>
            }
            panelLabel={t.ocr.controlsLabel}
        >
            <StudioCanvas>
                <StudioDropzone title={t.studio.dropTitle} hint={intro.hint} limits={t.ocr.limits} />
            </StudioCanvas>
        </OcrShell>
    );
}

/**
 * One image: its settings, the reading job, and — once there is text — the editor. Each new reading
 * gets a fresh editor; the text (and how it was read) is kept on this device so a reload keeps it.
 */
function OcrStudio({ image }: { image: ImageFile }) {
    const t = useT();
    const [settings, setSettings] = useState<ReadSettings>(DEFAULT_SETTINGS);
    const job = useOcrJob();
    const [reading, setReading] = useState<Reading | null>(null);
    const [notice, setNotice] = useState<Notice | null>(null);
    const { refreshRead } = useOcrSource();
    const setOriginal = useSectionImageStore()((state) => state.setOriginal);

    useEffect(() => {
        let live = true;
        void loadDraftOcr<OcrDocument, JSONContent>(image.id).then((draft) => {
            if (!live || !draft) return;
            setReading((current) => current ?? { id: 0, result: draft.result, content: draft.content, restored: true });
            setSettings((current) => ({ ...current, ...(draft.settings as Partial<ReadSettings>) }));
        });
        return () => {
            live = false;
        };
    }, [image.id]);

    const extract = async (next = settings) => {
        if (next.tool !== "full" && !next.region) {
            setNotice({ tone: "error", text: t.ocr.regionMissing });
            return;
        }
        setNotice(null);
        const read = await job.run(image.file, image.file.name || image.name, { language: next.language, region: next.tool === "full" ? null : next.region, preserveLayout: next.detectLayout });
        if (!read) return;
        const result = await fitFontSizes(read);
        // A sideways or upside-down page was turned to be read: the editor's copy turns with it, so
        // the text, the overlay and every export line up with the picture.
        if (read.document.rotation) setOriginal(await turnImage(image, read.document.rotation));
        const content = toEditorContent(result);
        setReading((current) => ({ id: (current?.id ?? 0) + 1, result, content, restored: false }));
        await saveDraftOcr({ imageId: image.id, sourceId: sourceOf(image), result, content, settings: next });
        refreshRead();
    };

    const running = job.status === "running";
    const failure = job.status === "error" ? { tone: "error" as const, text: errorMessage(t, job.error) } : job.status === "cancelled" ? { tone: "info" as const, text: t.ocr.cancelled } : null;

    if (reading) {
        return <ReadingStudio key={reading.id} image={image} reading={reading} settings={settings} onSettings={setSettings} job={job} onExtract={extract} failure={failure} />;
    }

    return (
        <OcrShell
            panel={
                <PanelBody>
                    <ReadSettingsPanel settings={settings} onChange={setSettings} disabled={running} />
                </PanelBody>
            }
            panelLabel={t.ocr.controlsLabel}
        >
            <PdfPager settings={settings} disabled={running} />
            <StudioCanvas>
                {running ? (
                    <ReadingPreview src={image.previewUrl} alt={t.ocr.imageAlt(image.name)} dimensions={image.dimensions} />
                ) : (
                    <div className="relative flex min-h-0 flex-1">
                        <ImagePane src={image.previewUrl} alt={t.ocr.imageAlt(image.name)} size={image.dimensions} tool={settings.tool} region={settings.tool === "full" ? null : settings.region} onRegion={(region) => setSettings((current) => ({ ...current, region }))} />
                    </div>
                )}
            </StudioCanvas>
            {running ? (
                <StageList stages={job.stages} startedAt={job.startedAt} onCancel={job.cancel} />
            ) : (
                <>
                    {(notice ?? failure) && <StudioNotice notice={(notice ?? failure)!} />}
                    <StudioActions>
                        <ClearImageButton />
                        <Button size="lg" color="primary" iconLeading={ScanText} onPress={() => void extract()} className="press-scale pointer-coarse:min-h-12">
                            {t.ocr.extract}
                        </Button>
                    </StudioActions>
                </>
            )}
        </OcrShell>
    );
}

type View = "image" | "split" | "text";
type PanelTab = "edit" | "read";

interface ReadingStudioProps {
    image: ImageFile;
    reading: Reading;
    settings: ReadSettings;
    onSettings: (settings: ReadSettings) => void;
    job: ReturnType<typeof useOcrJob>;
    onExtract: (settings?: ReadSettings) => Promise<void>;
    failure: Notice | null;
}

function ReadingStudio({ image, reading, settings, onSettings, job, onExtract, failure }: ReadingStudioProps) {
    const t = useT();
    const copy = t.ocr;
    const { result } = reading;
    const desktop = useDesktop();
    const source = useOcrSource();

    // ------------------------------------------------------------------ editor
    const [edited, setEdited] = useState(reading.restored);
    const [spellcheck, setSpellcheck] = useState(false);
    const saveTimer = useRef<number | undefined>(undefined);
    /** Edits not saved yet: saved shortly after typing stops, or at once when leaving (another page, say). */
    const unsaved = useRef<(() => void) | null>(null);
    const settingsRef = useRef(settings);
    useEffect(() => {
        settingsRef.current = settings;
    }, [settings]);
    const onChange = useCallback(
        (content: JSONContent) => {
            setEdited(true);
            window.clearTimeout(saveTimer.current);
            unsaved.current = () => {
                unsaved.current = null;
                void saveDraftOcr({ imageId: image.id, sourceId: sourceOf(image), result, content, settings: settingsRef.current });
            };
            saveTimer.current = window.setTimeout(() => unsaved.current?.(), 600);
        },
        [image, result],
    );
    useEffect(
        () => () => {
            window.clearTimeout(saveTimer.current);
            unsaved.current?.();
        },
        [],
    );
    const editor = useOcrEditor({ content: reading.content, label: copy.editorLabel, spellcheck, onChange });

    const status = useEditorState({
        editor,
        selector: ({ editor: current }) => {
            const ranges = uncertainRanges(current.state.doc);
            return {
                uncertain: ranges.length,
                here: current.isActive("lowConfidence") ? Number(current.getAttributes("lowConfidence").confidence) || 0 : null,
                block: activeBlockId(current),
            };
        },
    });

    // ------------------------------------------------------------------ view
    const [view, setView] = useState<View>(desktop ? "split" : "text");
    const [tab, setTab] = useState<PanelTab>("edit");
    const drawing = tab === "read" && settings.tool !== "full";
    // Choosing an area to read again needs the image in view.
    const wanted: View = drawing && view === "text" ? (desktop ? "split" : "image") : view;
    const shownView: View = !desktop && wanted === "split" ? "text" : wanted;
    // The original layout first: the page as it was scanned; Document is the clean, flowing version.
    const [mode, setMode] = useState<EditorMode>("layout");
    const [overlay, setOverlay] = useState<number | null>(null);
    const [showUncertain, setShowUncertain] = useState(true);
    const [findOpen, setFindOpen] = useState(false);
    // Text read just now by "Read all pages" isn't "from last time" — that has its own message.
    const [notice, setNotice] = useState<Notice | null>(reading.restored ? (source.status ? null : { tone: "info", text: copy.restored }) : { tone: "success", text: copy.done(result.stats.blocks) });
    const workspace = useRef<HTMLDivElement>(null);

    // ⌘F / Ctrl+F inside the workspace opens our find (it searches the document, not the page).
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && workspace.current?.contains(document.activeElement)) {
                event.preventDefault();
                setFindOpen(true);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const nextUncertain = () => {
        const ranges = uncertainRanges(editor.state.doc);
        if (!ranges.length) return;
        const after = ranges.find((range) => range.from > editor.state.selection.to) ?? ranges[0]!;
        if (shownView === "image") setView(desktop ? "split" : "text");
        editor.chain().focus().command(({ tr }) => {
            tr.setSelection(TextSelection.create(tr.doc, after.from, after.to)).scrollIntoView();
            return true;
        }).run();
    };
    const acceptWord = () => {
        editor.chain().focus().extendMarkRange("lowConfidence").unsetMark("lowConfidence").run();
        setNotice({ tone: "success", text: copy.checked });
    };

    // ------------------------------------------------------------------ compare
    const [comparing, setComparing] = useState(false);
    const [rendered, setRendered] = useState<string | null>(null);
    const [compareMode, setCompareMode] = useState<CompareMode>("slider");
    const [showBefore, setShowBefore] = useState(false);
    useEffect(() => () => void (rendered && URL.revokeObjectURL(rendered)), [rendered]);
    const openCompare = async () => {
        setComparing(true);
        setRendered(null);
        try {
            const blob = await renderEditedImage({ content: editor.view.dom, doc: editor.state.doc, result, image: image.file, type: "image/png", ink: pageColours(result, "layout").ink });
            setRendered(URL.createObjectURL(blob));
        } catch {
            setComparing(false);
            setNotice({ tone: "error", text: copy.export.failed });
        }
    };

    // ------------------------------------------------------------------ export
    const [exporting, setExporting] = useState<ExportKind | null>(null);
    const navigate = useNavigate();
    const [scope, setScope] = useState<"page" | "all">("page");
    const everyPage = scope === "all" && source.pdf !== null;
    const name = safeName(everyPage ? source.pdf!.name : image.name);
    const save = (blob: Blob, fileName: string) => {
        const url = URL.createObjectURL(blob);
        downloadFile(url, fileName);
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
        setNotice({ tone: "success", text: copy.export.downloaded(fileName) });
    };
    /** The editor's HTML without the uncertain-word marks (they mean nothing outside the editor). */
    const cleanHtml = (html = editor.getHTML()) => {
        const holder = document.createElement("div");
        holder.innerHTML = html;
        holder.querySelectorAll("span.ocr-low").forEach((span) => span.replaceWith(...span.childNodes));
        return holder.innerHTML;
    };
    /** What to export: this page, or every page of the PDF that has text (this one as it is now). */
    const collect = async () => {
        const here = { doc: editor.state.doc as PMNode, html: cleanHtml(), result };
        if (!everyPage) return { pages: [here], skipped: [] as number[] };
        const pages: (typeof here)[] = [];
        const skipped: number[] = [];
        for (let number = 1; number <= source.pdf!.pageCount; number++) {
            const id = pageId(source.pdf!.id, number);
            if (id === image.id) {
                pages.push(here);
                continue;
            }
            const draft = await loadDraftOcr<OcrDocument, JSONContent>(id);
            if (!draft) {
                skipped.push(number);
                continue;
            }
            const doc = editor.schema.nodeFromJSON(draft.content);
            pages.push({ doc, html: cleanHtml(getHTMLFromFragment(doc.content, editor.schema)), result: draft.result });
        }
        return { pages, skipped };
    };
    const [exportAs, setExportAs] = useState<Exclude<ExportKind, "copy" | "editor"> | null>(null);
    const runExport = async (kind: ExportKind, request?: { fileName: string; baseName: string; quality: number }) => {
        const image_ = kind === "png" || kind === "jpeg" || kind === "webp";
        const { pages, skipped } = image_ ? { pages: [], skipped: [] } : await collect();
        const text = image_ ? plainText(editor.state.doc) : pages.map((page) => plainText(page.doc)).filter(Boolean).join("\n\n");
        const html = pages.map((page) => page.html).join("");
        if (!text.trim() && !image_) {
            setNotice({ tone: "error", text: copy.export.empty });
            return;
        }
        setExporting(kind);
        try {
            switch (kind) {
                case "editor": {
                    // The text, as edited, into the full text editor (every page, when exporting all pages).
                    openInTextEditor({ type: "doc", content: pages.flatMap((page) => page.doc.toJSON().content ?? []) });
                    navigate(ROUTES.textEditor);
                    return;
                }
                case "copy":
                    try {
                        await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
                    } catch {
                        await navigator.clipboard.writeText(text);
                    }
                    setNotice({ tone: "success", text: copy.export.copied });
                    break;
                case "txt":
                    save(new Blob([text.replace(/\n/g, "\r\n")], { type: "text/plain;charset=utf-8" }), request?.fileName ?? `${name}-text.txt`);
                    break;
                case "docx": {
                    // Word export is a large library, loaded only when asked for.
                    const { exportDocx } = await import("@/features/ocr/exportDocx");
                    save(await exportDocx(pages.map((page) => page.doc), request?.baseName ?? name), request?.fileName ?? `${name}-text.docx`);
                    break;
                }
                case "pdf": {
                    setNotice({ tone: "info", text: copy.export.printing });
                    await printDocument({
                        pages: pages.map((page) => {
                            const { pageWidth, width, height } = page.result.document;
                            return { html: page.html, layout: mode === "layout" ? { width: pageWidth, height: Math.round((pageWidth * height) / width) } : null, colours: pageColours(page.result, mode) };
                        }),
                        title: request?.baseName ?? `${name}-text`,
                        lang: result.language === "en" ? "en" : "ne",
                    });
                    setNotice(null);
                    break;
                }
                case "png":
                case "jpeg":
                case "webp": {
                    const type = `image/${kind}` as const;
                    save(await renderEditedImage({ content: editor.view.dom, doc: editor.state.doc, result, image: image.file, type, ink: pageColours(result, "layout").ink, quality: request?.quality ?? 0.92 }), request?.fileName ?? `${name}-edited.${kind === "jpeg" ? "jpg" : kind}`);
                    break;
                }
            }
            if (skipped.length) setNotice({ tone: "info", text: copy.pdf.skipped(skipped.join(", ")) });
        } catch {
            setNotice({ tone: "error", text: kind === "copy" ? copy.export.copyFailed : copy.export.failed });
        } finally {
            setExporting(null);
        }
    };

    // ------------------------------------------------------------------ reading again
    const [confirming, setConfirming] = useState(false);
    const running = job.status === "running";
    const rerun = () => {
        if (edited && !confirming) return setConfirming(true);
        setConfirming(false);
        void onExtract(settings);
    };

    const tabs = useMemo(
        () => [
            { id: "edit" as const, label: copy.tabs.edit, icon: <PenLine className="size-4" aria-hidden /> },
            { id: "read" as const, label: copy.tabs.read, icon: <ScanText className="size-4" aria-hidden /> },
        ],
        [copy.tabs],
    );
    const shownNotice = failure && !running ? failure : notice;

    return (
        <OcrShell
            dirty={edited}
            exportSlot={
                <ExportPopover label={copy.tabs.export} title={copy.tabs.export} heading={false}>
                    {(close) => (
                        <ExportPanel
                            busy={exporting}
                            onExport={(kind) => {
                                close();
                                if (kind === "copy" || kind === "editor") void runExport(kind);
                                else setExportAs(kind);
                            }}
                            scope={source.pdf ? scope : null}
                            onScope={setScope}
                        />
                    )}
                </ExportPopover>
            }
            panel={
                <>
                    <PanelTabs tabs={tabs} value={tab} onChange={setTab} label={copy.controlsLabel} />
                    <PanelBody id={tab}>
                        {tab === "edit" && (
                            <EditPanel
                                mode={mode}
                                onMode={(next) => {
                                    setMode(next);
                                    if (shownView === "image") setView(desktop ? "split" : "text");
                                }}
                                overlay={overlay}
                                onOverlay={setOverlay}
                                showUncertain={showUncertain}
                                onShowUncertain={setShowUncertain}
                                uncertainCount={status.uncertain}
                                onNextUncertain={nextUncertain}
                                spellcheck={spellcheck}
                                onSpellcheck={setSpellcheck}
                                result={result}
                            />
                        )}
                        {tab === "read" && (
                            <>
                                <ReadSettingsPanel settings={settings} onChange={onSettings} disabled={running} />
                                <p className="text-xs text-tertiary">{copy.rerunHint}</p>
                                {confirming ? (
                                    <div role="alertdialog" aria-label={copy.rerunConfirm} className="animate-enter flex flex-col gap-3 rounded-xl border border-[var(--card-line)] bg-secondary p-3 [--i:-1]">
                                        <p className="text-sm font-medium text-primary">{copy.rerunConfirm}</p>
                                        <div className="flex gap-2">
                                            <Button size="md" color="secondary" onPress={() => setConfirming(false)} className="flex-1">
                                                {t.common.cancel}
                                            </Button>
                                            <Button size="md" color="primary" onPress={rerun} className="flex-1">
                                                {copy.replace}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <Button size="lg" color="primary" iconLeading={ScanText} onPress={rerun} isDisabled={running} className="press-scale pointer-coarse:min-h-12">
                                        {running ? copy.extracting : copy.rerun}
                                    </Button>
                                )}
                            </>
                        )}
                    </PanelBody>
                </>
            }
            panelLabel={copy.controlsLabel}
        >
            <PdfPager settings={settings} disabled={running} />
            <div ref={workspace} className="relative flex h-[calc(100svh-7.5rem)] min-h-[30rem] flex-col overflow-hidden rounded-xl border border-[var(--card-line)] bg-secondary lg:h-auto lg:min-h-0 lg:flex-1">
                {/* View, and the comparison. */}
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--card-line)] bg-primary px-2 py-1.5">
                    {comparing ? (
                        <>
                            <CompareControls mode={compareMode} onModeChange={setCompareMode} showBefore={showBefore} onShowBeforeChange={setShowBefore} />
                            <button type="button" onClick={() => setComparing(false)} className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-secondary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 pointer-coarse:h-11">
                                <X className="size-4" aria-hidden />
                                {copy.compareClose}
                            </button>
                        </>
                    ) : (
                        <>
                            <Segmented
                                size="sm"
                                kind="tab"
                                label={copy.viewLabel}
                                value={shownView}
                                onChange={setView}
                                options={(desktop ? (["image", "split", "text"] as const) : (["image", "text"] as const)).map((value) => ({ value, label: copy.views[value] }))}
                            />
                            <span className="flex items-center gap-0.5">
                                {shownView !== "image" && (
                                    <button
                                        type="button"
                                        onClick={() => setFindOpen((open) => !open)}
                                        aria-pressed={findOpen}
                                        aria-label={copy.toolbar.find}
                                        title={copy.toolbar.find}
                                        className="grid size-9 cursor-pointer place-items-center rounded-lg text-secondary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 aria-pressed:bg-[var(--brand-soft)] aria-pressed:text-[var(--brand)] pointer-coarse:size-11"
                                    >
                                        <Search className="size-4" aria-hidden />
                                    </button>
                                )}
                                <button type="button" onClick={() => void openCompare()} className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-secondary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 pointer-coarse:h-11">
                                    <GitCompareArrows className="size-4" aria-hidden />
                                    {copy.compare}
                                </button>
                            </span>
                        </>
                    )}
                </div>

                {comparing ? (
                    rendered ? (
                        compareMode === "split" ? (
                            <SideBySide dimensions={image.dimensions} before={{ src: image.previewUrl, alt: copy.imageAlt(image.name), label: copy.original }} after={{ src: rendered, alt: copy.edited, label: copy.edited }} />
                        ) : (
                            <Fitted dimensions={image.dimensions}>
                                {(size) => (
                                    <div className="relative overflow-hidden rounded-lg" style={size}>
                                        <ComparisonLayer mode={compareMode} before={{ src: image.previewUrl, alt: copy.imageAlt(image.name), label: copy.original }} after={{ src: rendered, alt: copy.edited, label: copy.edited }} showBefore={showBefore} />
                                    </div>
                                )}
                            </Fitted>
                        )
                    ) : (
                        <p role="status" className="flex flex-1 items-center justify-center p-6 text-sm text-tertiary">
                            {copy.rendering}
                        </p>
                    )
                ) : (
                    <>
                        {shownView !== "image" && <OcrToolbar editor={editor} />}
                        {shownView !== "image" && findOpen && <FindReplaceBar editor={editor} onClose={() => setFindOpen(false)} onReplaced={(count) => setNotice({ tone: "success", text: copy.find.replaced(count) })} />}
                        <div className={cn("grid min-h-0 flex-1", shownView === "split" && "grid-cols-2 divide-x divide-[var(--card-line)]")}>
                            <section aria-label={copy.imagePane} className={cn("relative min-h-0 min-w-0 flex-col", shownView === "text" ? "hidden" : "flex")}>
                                <ImagePane
                                    src={image.previewUrl}
                                    alt={copy.imageAlt(image.name)}
                                    size={image.dimensions}
                                    tool={drawing && !running ? settings.tool : "full"}
                                    region={drawing ? settings.region : null}
                                    onRegion={(region) => onSettings({ ...settings, region })}
                                    blocks={drawing ? undefined : result.blocks}
                                    offset={result.document.region}
                                    activeBlock={status.block}
                                    onBlockClick={(id) => {
                                        if (shownView === "image") setView("text");
                                        requestAnimationFrame(() => focusBlock(editor, id));
                                    }}
                                />
                            </section>
                            <section aria-label={copy.textPane} className={cn("min-h-0 min-w-0 overflow-auto overscroll-contain", shownView === "image" && "hidden")}>
                                <OcrPageView editor={editor} result={result} mode={mode} imageUrl={image.previewUrl} imageSize={image.dimensions} overlay={overlay} showUncertain={showUncertain} />
                            </section>
                        </div>
                        {status.here !== null && shownView !== "image" && (
                            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--card-line)] bg-warning-primary px-3 py-2 text-sm text-warning-primary">
                                <span>{copy.uncertain.here(Math.round(status.here * 100))}</span>
                                <button type="button" onClick={acceptWord} className="h-8 cursor-pointer rounded-lg bg-primary px-3 text-sm font-medium text-secondary outline-focus-ring hover:text-primary focus-visible:outline-2 pointer-coarse:h-10">
                                    {copy.uncertain.accept}
                                </button>
                            </div>
                        )}
                    </>
                )}

                {running && (
                    <div className="absolute right-3 bottom-3 left-3 z-20 sm:left-auto sm:w-80">
                        <StageList stages={job.stages} startedAt={job.startedAt} onCancel={job.cancel} />
                    </div>
                )}
            </div>
            {shownNotice && <StudioNotice notice={shownNotice} />}
            <ExportDialog
                open={exportAs !== null}
                onClose={() => setExportAs(null)}
                title={t.documents.exportDialog.title}
                formats={[
                    { value: "txt", label: copy.export.txt, extension: "txt" },
                    { value: "docx", label: copy.export.docx, extension: "docx" },
                    { value: "pdf", label: copy.export.pdf, extension: "pdf", prints: true, hint: copy.export.pdfHint },
                    { value: "png", label: "PNG", extension: "png", hint: copy.export.imageHint },
                    { value: "jpeg", label: "JPG", extension: "jpg", quality: true, hint: copy.export.imageHint },
                    { value: "webp", label: "WebP", extension: "webp", quality: true, hint: copy.export.imageHint },
                ]}
                initialFormat={exportAs ?? "docx"}
                name={exportAs === "png" || exportAs === "jpeg" || exportAs === "webp" ? `${name}-edited` : `${name}-text`}
                onExport={({ format, fileName, baseName, quality }) => runExport(format, { fileName, baseName, quality })}
            />
        </OcrShell>
    );
}
