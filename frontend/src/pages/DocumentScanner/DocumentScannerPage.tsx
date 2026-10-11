import { ArrowDown, ArrowUp, Camera, CloudUpload, Crop, FileDown, FileText, ImageDown, LoaderCircle, Printer, RotateCcw, RotateCw, Trash2, Wand2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Segmented } from "@/components/common/Segmented";
import { ExportPopover } from "@/components/studio/ExportPopover";
import { ImageProcessingPreview } from "@/components/studio/ImageProcessingPreview";
import { type Notice, Fitted, PanelBody, PanelIntro, StudioCanvas, StudioDropzone, StudioError, StudioNotice } from "@/components/studio/StudioParts";
import { useStudio } from "@/components/studio/StudioShell";
import { Button } from "@/components/ui/base/buttons/button";
import { CameraDialog } from "@/features/document-scanner/CameraDialog";
import { CornerEditor } from "@/features/document-scanner/CornerEditor";
import { downloadPageImage, isReady, printPages, scanToPdf } from "@/features/document-scanner/exportScan";
import { LOOKS, type Look } from "@/features/document-scanner/filters";
import { PageStrip } from "@/features/document-scanner/PageStrip";
import { layoutPage, PAPER_SIZES, type PaperSize } from "@/features/document-scanner/pdf";
import { scannerSupported } from "@/features/document-scanner/scanClient";
import { type ScanPage, useScanPages } from "@/features/document-scanner/useScanPages";
import { DocumentStudio } from "@/features/documents/DocumentStudio";
import { MAX_FILES } from "@/features/documents/limits";
import { baseName } from "@/features/image-processing/format";
import { prepareImageFile } from "@/hooks/useImageUpload";
import { UPLOAD_ACCEPT } from "@/lib/constants/upload";
import { cn } from "@/lib/utils/cn";
import { downloadBlob } from "@/lib/utils/download";
import { useT } from "@/i18n";

type View = "corners" | "result" | "print";

export function DocumentScannerPage() {
    const t = useT();
    const copy = t.scanner;
    const scan = useScanPages("enhance");
    const { pages } = scan;
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [view, setView] = useState<View>("corners");
    const [paper, setPaper] = useState<PaperSize>("a4");
    const [notice, setNotice] = useState<Notice | null>(null);
    const [camera, setCamera] = useState(false);
    const cameraInput = useRef<HTMLInputElement>(null);
    const supported = scannerSupported();

    const selected = pages.find((page) => page.id === selectedId) ?? pages[0] ?? null;
    const index = selected ? pages.indexOf(selected) : -1;

    /** Picked, dropped, pasted or photographed: checked (HEIC converted) one by one, then scanned in order. */
    const receive = useCallback(
        async (files: File[]) => {
            const room = MAX_FILES - pages.length;
            let problem: string | null = files.length > room ? t.documents.tooMany(MAX_FILES) : null;
            let first: string | null = null;
            for (const picked of files.slice(0, Math.max(0, room))) {
                const prepared = await prepareImageFile(picked, t, (status) => status && setNotice({ tone: "info", text: status }));
                if (!prepared.ok) {
                    problem = `${picked.name}: ${prepared.error}`;
                    continue;
                }
                const id = scan.add(prepared.file, picked.name);
                first ??= id;
            }
            if (first) setSelectedId(first);
            setNotice(problem ? { tone: "error", text: problem } : null);
        },
        // `scan.add` reads its pages from a ref; only the count matters here.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [pages.length, t],
    );

    const removeSelected = () => {
        if (!selected) return;
        const next = pages[index + 1] ?? pages[index - 1] ?? null;
        scan.remove(selected.id);
        setSelectedId(next?.id ?? null);
    };
    const moveSelected = (step: 1 | -1) => {
        if (!selected || !pages[index + step]) return;
        const list = [...pages];
        list.splice(index, 1);
        list.splice(index + step, 0, selected);
        scan.reorder(list);
    };

    const openCameraApp = () => {
        setCamera(false);
        cameraInput.current?.click();
    };

    const ready = pages.filter(isReady);
    const allReady = pages.length > 0 && ready.length === pages.length;

    const panel = (
        <PanelBody>
            {!selected ? (
                <PanelIntro title={t.studio.howItWorks} steps={t.studio.intros.documentScanner.steps} formats={["JPG", "PNG", "WebP", "HEIC"]} />
            ) : (
                <SelectedPagePanel
                    page={selected}
                    position={index}
                    count={pages.length}
                    onAutoDetect={() => {
                        scan.autoDetect(selected.id);
                        setView("corners");
                    }}
                    onFullImage={() => {
                        scan.fullImage(selected.id);
                        setView("corners");
                    }}
                    onRotate={(step) => scan.rotate(selected.id, step)}
                    onLook={(look) => scan.setLook(selected.id, look)}
                    onLookForAll={() => scan.lookForAll(selected.look)}
                    onMove={moveSelected}
                    onRemove={removeSelected}
                />
            )}
            <p className="rounded-xl bg-secondary p-3 text-xs leading-relaxed text-tertiary">{copy.privacy}</p>
        </PanelBody>
    );

    const exportSlot = (
        <ExportPopover label={copy.export} title={copy.export} disabled={!pages.length}>
            {(close) => <ExportChoices pages={pages} current={selected} paper={paper} onPaper={setPaper} allReady={allReady} onDone={close} onProblem={(text) => setNotice({ tone: "error", text })} />}
        </ExportPopover>
    );

    return (
        <DocumentStudio
            tool="documentScanner"
            accept={UPLOAD_ACCEPT}
            onFiles={(files) => void receive(files)}
            hasWork={pages.length > 0}
            dirty={pages.length > 0}
            panelLabel={t.nav.toolItems.documentScanner.title}
            panel={panel}
            exportSlot={exportSlot}
        >
            <input
                ref={cameraInput}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                tabIndex={-1}
                aria-hidden
                onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    if (files.length) void receive(files);
                }}
            />
            {!supported ? (
                <StudioCanvas>
                    <StudioError title={copy.unsupportedTitle} message={copy.unsupported} />
                </StudioCanvas>
            ) : pages.length === 0 ? (
                <>
                    <StudioCanvas>
                        <StudioDropzone title={copy.dropTitle} hint={t.studio.intros.documentScanner.hint} limits={t.documents.imageLimits} actionLabel={t.documents.uploadImages} many />
                    </StudioCanvas>
                    <div className="flex flex-wrap justify-center gap-2">
                        <Button size="lg" color="secondary" iconLeading={Camera} onPress={() => setCamera(true)} className="press-scale pointer-coarse:min-h-12">
                            {copy.useCamera}
                        </Button>
                    </div>
                </>
            ) : (
                <Workspace
                    pages={pages}
                    selected={selected}
                    view={view}
                    onView={setView}
                    paper={paper}
                    onCamera={() => setCamera(true)}
                    onSelect={setSelectedId}
                    onReorder={scan.reorder}
                    onQuad={(quad, when) => selected && scan.setQuad(selected.id, quad, when)}
                    onRetry={() => selected && void scan.retry(selected.id)}
                />
            )}
            {notice && <StudioNotice notice={notice} />}
            {camera && <CameraDialog onClose={() => setCamera(false)} onCapture={(file) => void receive([file])} onCameraApp={openCameraApp} />}
        </DocumentStudio>
    );
}

interface WorkspaceProps {
    pages: ScanPage[];
    selected: ScanPage | null;
    view: View;
    onView: (view: View) => void;
    paper: PaperSize;
    onCamera: () => void;
    onSelect: (id: string) => void;
    onReorder: (pages: ScanPage[]) => void;
    onQuad: (quad: NonNullable<ScanPage["quad"]>, when: "now" | "settle" | "never") => void;
    onRetry: () => void;
}

/** With pages: the toolbar, the selected page (corners, result or print preview) and the page strip. */
function Workspace({ pages, selected, view, onView, paper, onCamera, onSelect, onReorder, onQuad, onRetry }: WorkspaceProps) {
    const t = useT();
    const copy = t.scanner;
    const { openPicker } = useStudio();
    const toolButton = "flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-[var(--card-line)] px-3.5 text-sm font-semibold text-secondary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 pointer-coarse:h-12";

    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={openPicker} className={toolButton}>
                    <CloudUpload className="size-[1.125rem]" aria-hidden />
                    {copy.addPhotos}
                </button>
                <button type="button" onClick={onCamera} className={toolButton}>
                    <Camera className="size-[1.125rem]" aria-hidden />
                    {copy.camera.title}
                </button>
                <Segmented
                    label={copy.viewLabel}
                    value={view}
                    onChange={onView}
                    className="ml-auto"
                    scrollable
                    options={(["corners", "result", "print"] as const).map((value) => ({ value, label: copy.views[value] }))}
                />
            </div>
            <StudioCanvas>
                {view === "print" ? <PrintPreview pages={pages} paper={paper} /> : selected && <PageView key={selected.id} page={selected} view={view} onQuad={onQuad} onRetry={onRetry} />}
            </StudioCanvas>
            {selected && !selected.confident && selected.status !== "detecting" && selected.quad && view === "corners" && <StudioNotice notice={{ tone: "info", text: copy.noEdges }} />}
            <PageStrip pages={pages} selected={selected?.id ?? null} onSelect={onSelect} onReorder={onReorder} onAdd={openPicker} />
        </>
    );
}

function PageView({ page, view, onQuad, onRetry }: { page: ScanPage; view: "corners" | "result"; onQuad: WorkspaceProps["onQuad"]; onRetry: () => void }) {
    const t = useT();
    const copy = t.scanner;
    if (page.status === "failed") return <StudioError title={copy.failedTitle} message={page.quad ? copy.renderFailed : copy.readFailed} onRetry={onRetry} />;
    if (!page.quad) {
        return (
            <p role="status" className="m-auto flex items-center gap-2 text-sm text-secondary">
                <LoaderCircle className="size-4 animate-spin text-[var(--brand)] motion-reduce:animate-none" aria-hidden />
                {copy.statuses.detecting}
            </p>
        );
    }
    if (view === "corners") return <CornerEditor src={page.source} alt={page.name} width={page.width} height={page.height} quad={page.quad} onChange={onQuad} />;
    // The first render: the shared processing effect over the photo. Later ones keep the last result, with a quiet status.
    if (!page.result) {
        return (
            <Fitted dimensions={{ width: page.width, height: page.height }}>
                {(size) => <ImageProcessingPreview src={page.source} alt={page.name} size={size} status="processing" label={copy.statuses.rendering} />}
            </Fitted>
        );
    }
    const result = page.result;
    return (
        <>
            <Fitted dimensions={{ width: result.width, height: result.height }}>
                {(size) => <img src={result.url} alt={copy.resultAlt(page.name)} style={size} className="animate-enter absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-white shadow-sm [--i:-1]" />}
            </Fitted>
            {page.status === "rendering" && (
                <p role="status" className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--card-line)] bg-primary px-3 py-1.5 text-xs font-medium text-secondary">
                    <LoaderCircle className="size-3.5 animate-spin text-[var(--brand)] motion-reduce:animate-none" aria-hidden />
                    {copy.statuses.rendering}
                </p>
            )}
        </>
    );
}

/** Every page on its sheet of paper, as it will print and as the PDF lays it out. */
function PrintPreview({ pages, paper }: { pages: ScanPage[]; paper: PaperSize }) {
    const t = useT();
    const copy = t.scanner;
    return (
        <ol aria-label={copy.views.print} className="flex min-h-0 flex-1 flex-col items-center gap-6 overflow-y-auto p-4 sm:p-6">
            {pages.map((page, index) => {
                const result = page.result;
                const layout = layoutPage(paper, result?.width ?? 210, result?.height ?? 297);
                const { x, y, width, height } = layout.image;
                return (
                    <li key={page.id} className="flex w-full max-w-md flex-col items-center gap-2">
                        <div className="relative w-full overflow-hidden border border-[var(--card-line)] bg-white shadow-sm" style={{ aspectRatio: `${layout.width} / ${layout.height}`, maxWidth: layout.width > layout.height ? "100%" : "24rem" }}>
                            {result ? (
                                <img
                                    src={result.url}
                                    alt={copy.resultAlt(page.name)}
                                    className="absolute"
                                    style={{ left: `${(x / layout.width) * 100}%`, top: `${((layout.height - y - height) / layout.height) * 100}%`, width: `${(width / layout.width) * 100}%`, height: `${(height / layout.height) * 100}%` }}
                                />
                            ) : (
                                <LoaderCircle className="absolute inset-0 m-auto size-5 animate-spin text-[var(--brand)] motion-reduce:animate-none" aria-label={copy.statuses[page.status]} />
                            )}
                        </div>
                        <span className="text-xs text-tertiary tabular-nums">{copy.pageN(index + 1)}</span>
                    </li>
                );
            })}
        </ol>
    );
}

interface SelectedPagePanelProps {
    page: ScanPage;
    position: number;
    count: number;
    onAutoDetect: () => void;
    onFullImage: () => void;
    onRotate: (step: 1 | -1) => void;
    onLook: (look: Look) => void;
    onLookForAll: () => void;
    onMove: (step: 1 | -1) => void;
    onRemove: () => void;
}

function SelectedPagePanel({ page, position, count, onAutoDetect, onFullImage, onRotate, onLook, onLookForAll, onMove, onRemove }: SelectedPagePanelProps) {
    const t = useT();
    const copy = t.scanner;
    const busy = !page.quad;
    const smallButton = "flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[var(--card-line)] px-3 text-sm font-medium text-secondary outline-focus-ring transition-colors duration-150 hover:bg-primary_hover hover:text-primary focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:min-h-11";
    return (
        <>
            <section className="flex flex-col gap-1">
                <h3 className="text-md font-semibold text-primary">{copy.pageOf(position + 1, count)}</h3>
                <p className="truncate text-xs text-tertiary" title={page.name}>
                    {page.name}
                </p>
            </section>
            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-primary">{copy.cornersTitle}</h3>
                <p className="text-xs text-tertiary">{page.confident || busy ? copy.cornersHint : copy.noEdges}</p>
                <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={onAutoDetect} disabled={busy} className={smallButton}>
                        <Wand2 className="size-4" aria-hidden />
                        {copy.autoDetect}
                    </button>
                    <button type="button" onClick={onFullImage} disabled={busy} className={smallButton}>
                        <Crop className="size-4" aria-hidden />
                        {copy.fullImage}
                    </button>
                </div>
            </section>
            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-primary">{copy.rotate}</h3>
                <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => onRotate(-1)} disabled={busy} className={smallButton}>
                        <RotateCcw className="size-4" aria-hidden />
                        {copy.rotateLeft}
                    </button>
                    <button type="button" onClick={() => onRotate(1)} disabled={busy} className={smallButton}>
                        <RotateCw className="size-4" aria-hidden />
                        {copy.rotateRight}
                    </button>
                </div>
            </section>
            <section className="flex flex-col gap-3">
                <h3 id="scanner-look" className="text-sm font-semibold text-primary">
                    {copy.look}
                </h3>
                <div role="radiogroup" aria-labelledby="scanner-look" className="flex flex-col gap-1.5">
                    {LOOKS.map((look) => (
                        <button
                            key={look}
                            type="button"
                            role="radio"
                            aria-checked={page.look === look}
                            onClick={() => onLook(look)}
                            className={cn(
                                "flex min-h-11 cursor-pointer flex-col items-start justify-center rounded-lg border px-3 py-1.5 text-left outline-focus-ring transition-colors duration-150 focus-visible:outline-2",
                                page.look === look ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--card-line)] hover:bg-primary_hover",
                            )}
                        >
                            <span className={cn("text-sm font-medium", page.look === look ? "text-[var(--brand)]" : "text-primary")}>{copy.looks[look].label}</span>
                            <span className="text-xs text-tertiary">{copy.looks[look].detail}</span>
                        </button>
                    ))}
                </div>
                {count > 1 && (
                    <button type="button" onClick={onLookForAll} className="self-start rounded-md text-sm font-medium text-[var(--brand)] outline-focus-ring hover:underline focus-visible:outline-2 pointer-coarse:min-h-11">
                        {copy.lookForAll}
                    </button>
                )}
            </section>
            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-primary">{copy.page}</h3>
                <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => onMove(-1)} disabled={position === 0} className={smallButton}>
                        <ArrowUp className="size-4" aria-hidden />
                        {copy.moveEarlier}
                    </button>
                    <button type="button" onClick={() => onMove(1)} disabled={position === count - 1} className={smallButton}>
                        <ArrowDown className="size-4" aria-hidden />
                        {copy.moveLater}
                    </button>
                </div>
                <button type="button" onClick={onRemove} className={cn(smallButton, "hover:text-error-primary")}>
                    <Trash2 className="size-4" aria-hidden />
                    {copy.deletePage}
                </button>
            </section>
        </>
    );
}

/** The export popover: paper size, the PDF, printing, and the pages as images. */
function ExportChoices({ pages, current, paper, onPaper, allReady, onDone, onProblem }: { pages: ScanPage[]; current: ScanPage | null; paper: PaperSize; onPaper: (paper: PaperSize) => void; allReady: boolean; onDone: () => void; onProblem: (text: string) => void }) {
    const t = useT();
    const copy = t.scanner;
    const [format, setFormat] = useState<"jpg" | "png">("jpg");
    const [busy, setBusy] = useState<null | "pdf" | "print" | "images" | "page">(null);
    const ready = pages.filter(isReady);

    // Close the popover only once work it started is done.
    const run = async (kind: NonNullable<typeof busy>, work: () => Promise<void>) => {
        setBusy(kind);
        try {
            await work();
            onDone();
        } catch {
            onProblem(copy.exportFailed);
        } finally {
            setBusy(null);
        }
    };
    const disabled = !allReady || busy !== null;
    const spin = (kind: NonNullable<typeof busy>) => busy === kind && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />;

    return (
        <div className="flex flex-col gap-4">
            {!allReady && (
                <p role="status" className="text-xs text-tertiary">
                    {copy.waitForPages}
                </p>
            )}
            <section className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold text-secondary">{copy.paper}</h3>
                <Segmented label={copy.paper} value={paper} onChange={onPaper} options={PAPER_SIZES.map((value) => ({ value, label: copy.papers[value] }))} />
            </section>
            <div className="grid grid-cols-2 gap-2">
                <Button size="md" color="primary" iconLeading={busy === "pdf" ? undefined : FileDown} isDisabled={disabled} onPress={() => void run("pdf", async () => downloadBlob(await scanToPdf(ready, paper), `${copy.fileName}.pdf`))} className="pointer-coarse:min-h-11">
                    {spin("pdf")}
                    {copy.downloadPdf}
                </Button>
                <Button size="md" color="secondary" iconLeading={busy === "print" ? undefined : Printer} isDisabled={disabled} onPress={() => void run("print", () => printPages(ready, paper))} className="pointer-coarse:min-h-11">
                    {spin("print")}
                    {copy.print}
                </Button>
            </div>
            <hr className="border-[var(--card-line)]" />
            <section className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold text-secondary">{copy.images}</h3>
                <Segmented label={copy.images} value={format} onChange={setFormat} options={[{ value: "jpg", label: "JPG" }, { value: "png", label: "PNG" }]} />
                {current && pages.length > 1 && (
                    <Button
                        size="md"
                        color="secondary"
                        iconLeading={busy === "page" ? undefined : ImageDown}
                        isDisabled={busy !== null || !isReady(current)}
                        onPress={() => void run("page", async () => {
                            if (isReady(current)) await downloadPageImage(current, format, `${copy.fileName}-${String(pages.indexOf(current) + 1).padStart(2, "0")}`);
                        })}
                        className="pointer-coarse:min-h-11"
                    >
                        {spin("page")}
                        {copy.downloadThisPage(pages.indexOf(current) + 1)}
                    </Button>
                )}
                <Button
                    size="md"
                    color="secondary"
                    iconLeading={busy === "images" ? undefined : ImageDown}
                    isDisabled={disabled}
                    onPress={() =>
                        void run("images", async () => {
                            // One after another: browsers drop downloads started all at once.
                            for (const [index, page] of ready.entries()) {
                                if (index) await new Promise((resolve) => window.setTimeout(resolve, 350));
                                await downloadPageImage(page, format, ready.length === 1 ? `${baseName(page.name)}-${copy.fileName}` : `${copy.fileName}-${String(index + 1).padStart(2, "0")}`);
                            }
                        })
                    }
                    className="pointer-coarse:min-h-11"
                >
                    {spin("images")}
                    {copy.downloadImages(ready.length)}
                </Button>
            </section>
            <p className="flex items-center gap-1.5 text-xs text-tertiary">
                <FileText className="size-3.5" aria-hidden />
                {copy.pagesReady(ready.length, pages.length)}
            </p>
        </div>
    );
}
