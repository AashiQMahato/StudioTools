import { ChevronDown, Copy, Download, FileText, Info, Languages, LoaderCircle, ScanText } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Segmented } from "@/components/common/Segmented";
import { Fitted, type Notice, PanelBody, PanelIntro, PanelTabs, StudioActions, StudioCanvas, StudioDropzone, StudioNotice } from "@/components/studio/StudioParts";
import { StudioShell } from "@/components/studio/StudioShell";
import { studioExportButton } from "@/components/studio/styles";
import { usePopover } from "@/components/studio/usePopover";
import { Button } from "@/components/ui/base/buttons/button";
import { baseName } from "@/features/image-processing/format";
import { applyTranslations, blocksFrom, hasTranslation, textFile, type TranslatorBlock } from "@/features/image-translator/blocks";
import { copyText } from "@/features/image-translator/clipboard";
import { languageLabel, SOURCE_LANGUAGES, TARGET_LANGUAGES, targetLanguage, translationSource } from "@/features/image-translator/languages";
import { loadPage, renderTranslatedImage } from "@/features/image-translator/renderImage";
import { BlockRows, BoxedImage } from "@/features/image-translator/TranslatorViews";
import { StageList } from "@/features/ocr/StageList";
import { useOcrJob } from "@/features/ocr/useOcrJob";
import { ApiError } from "@/lib/api/apiClient";
import type { OcrDocument, OcrLanguage } from "@/lib/api/ocrApi";
import { getTranslationStatus, translateTexts } from "@/lib/api/translateApi";
import { cn } from "@/lib/utils/cn";
import { downloadBlob } from "@/lib/utils/download";
import { useToolImage } from "@/store/useImageStore";
import type { ImageFile } from "@/types/image";
import { type AppErrorInfo, errorMessage, useT } from "@/i18n";

const selectClass =
    "h-11 w-full cursor-pointer rounded-lg border border-[var(--card-line)] bg-primary px-3 text-sm text-primary outline-focus-ring focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-12";

export function ImageTranslatorPage() {
    const { image, session } = useToolImage();
    // A new image starts a fresh translation.
    return <TranslatorStudio key={session} image={image} />;
}

function TranslatorStudio({ image }: { image: ImageFile | null }) {
    const t = useT();
    const copy = t.translator;
    const idPrefix = useId().replace(/:/g, "");
    const job = useOcrJob();
    const [source, setSource] = useState<OcrLanguage>("auto");
    const [target, setTarget] = useState("ne");
    const [document, setDocument] = useState<OcrDocument | null>(null);
    const [blocks, setBlocks] = useState<TranslatorBlock[] | null>(null);
    const [active, setActive] = useState<string | null>(null);
    const [view, setView] = useState<"original" | "translated">("original");
    const [preview, setPreview] = useState<"original" | "translated">("original");
    const [notice, setNotice] = useState<Notice | null>(null);
    const [configured, setConfigured] = useState<boolean | null>(null);
    const [translating, setTranslating] = useState(false);
    const translateController = useRef<AbortController | null>(null);
    useEffect(() => () => translateController.current?.abort(), []);

    // Ask once whether this server can translate, so nobody waits for a failure to find out.
    useEffect(() => {
        const controller = new AbortController();
        getTranslationStatus(controller.signal)
            .then((status) => setConfigured(status.available))
            .catch(() => undefined);
        return () => controller.abort();
    }, []);

    // The page as the OCR saw it (turned, for a sideways photo) — made only when needed.
    const page = useRef<{ for: OcrDocument; canvas: Promise<HTMLCanvasElement> } | null>(null);
    const getPage = useCallback(() => {
        if (!image || !document) return Promise.reject(new Error("No page"));
        if (page.current?.for !== document) page.current = { for: document, canvas: loadPage(image.file, document.document) };
        return page.current.canvas;
    }, [image, document]);

    const [rotated, setRotated] = useState<{ for: OcrDocument; url: string } | null>(null);
    useEffect(() => {
        if (!document?.document.rotation) return;
        let url: string | null = null;
        let live = true;
        void getPage().then((canvas) =>
            canvas.toBlob((blob) => {
                if (!blob || !live) return;
                url = URL.createObjectURL(blob);
                setRotated({ for: document, url });
            }),
        );
        return () => {
            live = false;
            if (url) URL.revokeObjectURL(url);
        };
    }, [document, getPage]);

    const language = targetLanguage(target);
    const translatedAny = blocks ? hasTranslation(blocks) : false;
    const showTranslation = Boolean(blocks?.some((block) => block.translated !== null));
    const sourceCode = translationSource(source);
    const sameLanguage = sourceCode !== "auto" && sourceCode === target;
    const running = job.status === "running";

    // The translated overlay, for the preview toggle: redrawn (after a pause in typing) when the text changes.
    // The previous picture stays up until the new one is ready, so it never flashes empty.
    const [overlay, setOverlay] = useState<{ url: string; skipped: number } | null>(null);
    const overlayUrl = useRef<string | null>(null);
    useEffect(() => () => void (overlayUrl.current && URL.revokeObjectURL(overlayUrl.current)), []);
    useEffect(() => {
        if (preview !== "translated" || !blocks || !document || !translatedAny) return;
        let live = true;
        const timer = window.setTimeout(async () => {
            try {
                const rendered = await renderTranslatedImage({ page: await getPage(), document: document.document, blocks, target: language, type: "image/png" });
                if (!live) return;
                if (overlayUrl.current) URL.revokeObjectURL(overlayUrl.current);
                overlayUrl.current = URL.createObjectURL(rendered.blob);
                setOverlay({ url: overlayUrl.current, skipped: rendered.skipped });
            } catch {
                if (live) setNotice({ tone: "error", text: copy.image.failed });
            }
        }, 250);
        return () => {
            live = false;
            window.clearTimeout(timer);
        };
    }, [preview, blocks, document, translatedAny, language, getPage, copy.image.failed]);

    const extract = async () => {
        if (!image) return;
        translateController.current?.abort();
        setTranslating(false);
        setNotice(null);
        setPreview("original");
        setView("original");
        const result = await job.run(image.file, image.file.name || image.name, { language: source, region: null, preserveLayout: true });
        if (!result) return;
        setDocument(result);
        setBlocks(blocksFrom(result));
        // Text that's already in the target language: offer the other one instead.
        if (result.language === target) setTarget(target === "ne" ? "en" : "ne");
        setNotice({ tone: "success", text: copy.extracted(result.blocks.length) });
    };

    const translate = async () => {
        if (!blocks || sameLanguage) return;
        translateController.current?.abort();
        const controller = new AbortController();
        translateController.current = controller;
        const sent = blocks.map((block) => block.original);
        setTranslating(true);
        setNotice({ tone: "info", text: copy.translating });
        try {
            const response = await translateTexts({ texts: sent, source: sourceCode, target }, controller.signal);
            if (controller.signal.aborted) return;
            // Edits made meanwhile are kept; those blocks show as needing another translation.
            setBlocks((current) => (current ? applyTranslations(current, sent, response.translations) : current));
            setConfigured(true);
            setView("translated");
            setNotice({ tone: "success", text: copy.translated(sent.filter((text) => text.trim()).length) });
        } catch (error) {
            if (controller.signal.aborted) return;
            const info: AppErrorInfo = error instanceof ApiError ? { code: error.code, message: error.message } : { code: "GENERIC" };
            if (info.code === "TRANSLATION_NOT_CONFIGURED") {
                setConfigured(false);
                setNotice(null);
            } else setNotice({ tone: "error", text: errorMessage(t, info) });
        } finally {
            if (translateController.current === controller) setTranslating(false);
        }
    };

    const edit = (id: string, field: "original" | "translated", text: string) =>
        setBlocks((current) =>
            current?.map((block) => (block.id !== id ? block : field === "original" ? { ...block, original: text } : { ...block, translated: text, translatedFrom: block.translatedFrom ?? block.original })) ?? current,
        );

    const pick = (id: string) => {
        setActive(id);
        const field = window.document.getElementById(`${idPrefix}-${id}-${showTranslation && view === "translated" && window.matchMedia("(max-width: 1023px)").matches ? "translated" : "original"}`);
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        field?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
        field?.focus({ preventScroll: true });
    };

    const copyBlocks = async (which: "original" | "translated") => {
        if (!blocks) return;
        const ok = await copyText(textFile(blocks, which).trimEnd());
        setNotice(ok ? { tone: "success", text: copy.copied } : { tone: "error", text: copy.copyFailed });
    };

    const name = image ? baseName(image.name) : "image";
    const downloadText = (which: "original" | "translated") => {
        if (!blocks) return;
        downloadBlob(new Blob([textFile(blocks, which)], { type: "text/plain;charset=utf-8" }), which === "original" ? `${name}-text.txt` : `${name}-${target}.txt`);
    };

    const [format, setFormat] = useState<"png" | "jpeg">("png");
    const [exporting, setExporting] = useState(false);
    const [skipped, setSkipped] = useState<number | null>(null);
    const downloadImage = async () => {
        if (!blocks || !document) return;
        setExporting(true);
        try {
            const rendered = await renderTranslatedImage({ page: await getPage(), document: document.document, blocks, target: language, type: format === "png" ? "image/png" : "image/jpeg" });
            downloadBlob(rendered.blob, `${name}-${target}.${format === "png" ? "png" : "jpg"}`);
            setSkipped(rendered.skipped);
        } catch {
            setNotice({ tone: "error", text: copy.image.failed });
        } finally {
            setExporting(false);
        }
    };

    const { open: exportOpen, setOpen: setExportOpen, wrap: exportWrap, trigger: exportTrigger } = usePopover();
    const exportSlot = (
        <div ref={exportWrap} className="relative">
            <button ref={exportTrigger} type="button" onClick={() => setExportOpen((open) => !open)} aria-expanded={exportOpen} aria-haspopup="dialog" disabled={!blocks} className={studioExportButton}>
                <Download className="size-4" aria-hidden />
                <span className="sr-only sm:not-sr-only">{t.studio.export}</span>
                <ChevronDown className={cn("size-4 opacity-70 transition-transform duration-200 motion-reduce:transition-none", exportOpen && "rotate-180")} aria-hidden />
            </button>
            {exportOpen && blocks && (
                <div role="dialog" aria-label={t.studio.exportTitle} className="absolute top-full right-0 z-50 mt-2 flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-4 rounded-2xl border border-[var(--card-line)] bg-primary p-4 shadow-xl">
                    <section className="flex flex-col gap-2">
                        <p className="text-sm font-semibold text-primary">{copy.textFiles}</p>
                        <Button size="md" color="secondary" iconLeading={FileText} onPress={() => downloadText("original")} className="press-scale w-full pointer-coarse:min-h-11">
                            {copy.downloadOriginal}
                        </Button>
                        <Button size="md" color="secondary" iconLeading={FileText} onPress={() => downloadText("translated")} isDisabled={!translatedAny} className="press-scale w-full pointer-coarse:min-h-11">
                            {copy.downloadTranslated}
                        </Button>
                    </section>
                    <section className="flex flex-col gap-2 border-t border-[var(--card-line)] pt-4">
                        <p className="text-sm font-semibold text-primary">{copy.image.title}</p>
                        <p className="text-xs leading-relaxed text-tertiary">{copy.image.approximate}</p>
                        <Segmented label={copy.image.format} size="sm" value={format} onChange={setFormat} options={[{ value: "png", label: "PNG" }, { value: "jpeg", label: "JPEG" }]} />
                        <Button size="md" color="primary" iconLeading={Download} onPress={downloadImage} isDisabled={!translatedAny || exporting} isLoading={exporting} showTextWhileLoading className="press-scale w-full pointer-coarse:min-h-11">
                            {exporting ? copy.image.rendering : copy.image.download}
                        </Button>
                        {skipped !== null && skipped > 0 && <p className="text-xs text-warning-primary">{copy.image.skipped(skipped)}</p>}
                    </section>
                </div>
            )}
        </div>
    );

    const ocrProblem = job.status === "error" ? { tone: job.error?.code === "NO_TEXT" ? ("info" as const) : ("error" as const), text: errorMessage(t, job.error) } : job.status === "cancelled" ? { tone: "info" as const, text: t.ocr.cancelled } : null;
    const shownNotice: Notice | null = !image ? null : running ? null : (ocrProblem ?? notice ?? (blocks ? null : { tone: "info", text: copy.ready }));

    const panel = (
        <>
            <PanelTabs label={copy.panelLabel} value="translate" onChange={() => undefined} tabs={[{ id: "translate", label: copy.tab, icon: <Languages className="size-4" aria-hidden /> }]} />
            <PanelBody id="translate">
                {configured === false && (
                    <aside role="status" className="flex gap-3 rounded-xl border border-[var(--card-line)] bg-secondary p-3.5">
                        <Info className="mt-0.5 size-4 shrink-0 text-tertiary" aria-hidden />
                        <span className="min-w-0">
                            <span className="block text-sm font-semibold text-primary">{copy.notConfiguredTitle}</span>
                            <span className="mt-0.5 block text-sm text-tertiary">{copy.notConfigured}</span>
                        </span>
                    </aside>
                )}
                {image ? (
                    <>
                        <section className="flex flex-col gap-1.5">
                            <label htmlFor={`${idPrefix}-source`} className="text-sm font-semibold text-primary">
                                {copy.sourceLabel}
                            </label>
                            <select id={`${idPrefix}-source`} value={source} disabled={running} onChange={(event) => setSource(event.target.value as OcrLanguage)} className={selectClass}>
                                {SOURCE_LANGUAGES.map((code) => (
                                    <option key={code} value={code}>
                                        {t.ocr.languages[code]}
                                    </option>
                                ))}
                            </select>
                            <p className="text-xs text-tertiary">{copy.sourceHint}</p>
                        </section>
                        <section className="flex flex-col gap-1.5">
                            <label htmlFor={`${idPrefix}-target`} className="text-sm font-semibold text-primary">
                                {copy.targetLabel}
                            </label>
                            <select id={`${idPrefix}-target`} value={target} disabled={translating} onChange={(event) => setTarget(event.target.value)} className={selectClass}>
                                {TARGET_LANGUAGES.map((option) => (
                                    <option key={option.code} value={option.code}>
                                        {languageLabel(option, t.meta.lang)}
                                    </option>
                                ))}
                            </select>
                            {sameLanguage && <p className="text-xs text-warning-primary">{copy.sameLanguage}</p>}
                        </section>
                        {running && <StageList stages={job.stages} startedAt={job.startedAt} onCancel={job.cancel} />}
                    </>
                ) : (
                    <PanelIntro title={t.studio.howItWorks} steps={t.studio.intros.imageTranslator.steps} />
                )}
            </PanelBody>
        </>
    );

    const pageSize = document ? { width: document.document.width, height: document.document.height } : image?.dimensions;
    const boxesSrc = document?.document.rotation ? (rotated?.for === document ? rotated.url : null) : image?.previewUrl;

    return (
        <StudioShell tool="imageTranslator" exportSlot={exportSlot} panel={panel} panelLabel={copy.panelLabel} dirty={Boolean(blocks)}>
            <StudioCanvas>
                {!image || !pageSize ? (
                    <StudioDropzone title={t.studio.dropTitle} hint={t.studio.intros.imageTranslator.hint} />
                ) : (
                    <>
                        {translatedAny && (
                            <div className="absolute top-3 left-1/2 z-10 -translate-x-1/2">
                                <Segmented label={copy.preview} kind="tab" size="sm" value={preview} onChange={setPreview} options={[{ value: "original", label: copy.previews.original }, { value: "translated", label: copy.previews.translated }]} />
                            </div>
                        )}
                        <Fitted dimensions={pageSize}>
                            {(size) =>
                                preview === "translated" && translatedAny ? (
                                    overlay ? (
                                        <figure className="animate-enter relative overflow-hidden rounded-lg [--i:-1]" style={size}>
                                            <img src={overlay.url} alt={copy.overlayAlt(image.name)} className="size-full object-contain" draggable={false} />
                                        </figure>
                                    ) : (
                                        <LoaderCircle className="size-6 animate-spin text-[var(--brand)] motion-reduce:animate-none" aria-label={copy.image.rendering} />
                                    )
                                ) : (
                                    <div className={cn("transition-opacity duration-300 motion-reduce:transition-none", running && "opacity-60")}>
                                        {boxesSrc && <BoxedImage src={boxesSrc} alt={copy.imageAlt(image.name)} page={pageSize} size={size} blocks={blocks ?? []} active={active} onActive={setActive} onPick={pick} />}
                                    </div>
                                )
                            }
                        </Fitted>
                    </>
                )}
            </StudioCanvas>

            {preview === "translated" && overlay && overlay.skipped > 0 ? <StudioNotice notice={{ tone: "info", text: copy.image.skipped(overlay.skipped) }} /> : shownNotice && <StudioNotice notice={shownNotice} />}

            {image && !running && (
                <StudioActions>
                    <Button size="lg" color={blocks ? "secondary" : "primary"} iconLeading={ScanText} onPress={extract} className="press-scale pointer-coarse:min-h-12">
                        {blocks ? copy.extractAgain : copy.extract}
                    </Button>
                    {blocks && (
                        <Button size="lg" color="primary" iconLeading={Languages} onPress={translate} isDisabled={configured === false || sameLanguage || translating || !blocks.some((block) => block.original.trim())} isLoading={translating} showTextWhileLoading className="press-scale pointer-coarse:min-h-12">
                            {translating ? copy.translating : translatedAny ? copy.translateAgain : copy.translate}
                        </Button>
                    )}
                </StudioActions>
            )}

            {blocks && blocks.length > 0 && (
                <section aria-label={t.ocr.editorLabel} className="flex shrink-0 flex-col gap-3 lg:max-h-[42%] lg:min-h-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        {showTranslation ? (
                            <Segmented label={copy.view} kind="tab" size="sm" value={view} onChange={setView} className="lg:hidden" options={[{ value: "original", label: copy.originalHeading }, { value: "translated", label: copy.translatedHeading }]} />
                        ) : (
                            <h2 className="text-sm font-semibold text-primary">{copy.originalHeading}</h2>
                        )}
                        <div className="ml-auto flex gap-1">
                            <Button size="sm" color="tertiary" iconLeading={Copy} onPress={() => copyBlocks("original")} className="press-scale pointer-coarse:min-h-11">
                                {copy.copyOriginal}
                            </Button>
                            {translatedAny && (
                                <Button size="sm" color="tertiary" iconLeading={Copy} onPress={() => copyBlocks("translated")} className="press-scale pointer-coarse:min-h-11">
                                    {copy.copyTranslated}
                                </Button>
                            )}
                        </div>
                    </div>
                    <div className="lg:min-h-0 lg:overflow-y-auto">
                        <BlockRows blocks={blocks} idPrefix={idPrefix} active={active} onActive={setActive} onEdit={edit} showTranslation={showTranslation} view={view} targetCode={target} />
                    </div>
                </section>
            )}
        </StudioShell>
    );
}
