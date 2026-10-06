import type { JSONContent } from "@tiptap/core";
import { EditorContent, type Editor, useEditorState } from "@tiptap/react";
import { BrushCleaning, CaseSensitive, Copy, FilePlus, FolderOpen, Search, Share, Sigma } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { type Notice, PanelBody, PanelTabs, StudioNotice } from "@/components/studio/StudioParts";
import { studioExportButton } from "@/components/studio/styles";
import { DocumentStudio } from "@/features/documents/DocumentStudio";
import { plainText } from "@/features/ocr/convert";
import { FindReplaceBar } from "@/features/ocr/FindReplaceBar";
import { OcrToolbar } from "@/features/ocr/OcrToolbar";
import { printDocument } from "@/features/ocr/printPdf";
import type { ToolKey } from "@/lib/constants/navigation";
import { cn } from "@/lib/utils/cn";
import { downloadFile } from "@/lib/utils/download";
import { useT } from "@/i18n";
import { applyCase, type CaseMode } from "./caseConvert";
import { cleanDocument, type CleanCounts, type CleanRule } from "./cleaner";
import { lineDiff } from "./diff";
import { textStats } from "./stats";
import { textToContent, useTextDocument } from "./textDocument";
import { ExportDialog } from "@/features/documents/ExportDialog";
import { CasePanel, CleanPanel, ExportList, StatsPanel, type TextExport } from "./TextPanels";

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
import { useTextEditor } from "./useTextEditor";
import "@/features/ocr/ocr.css";

export type TextTab = "clean" | "case" | "stats" | "export";
const ACCEPT = ".txt,.md,.markdown,.html,.htm,text/plain,text/markdown,text/html";
const MAX_OPEN_BYTES = 5 * 1024 * 1024;
const DEFAULT_RULES: CleanRule[] = ["extraSpaces", "ocrSpacing", "blankParagraphs", "collapseBlankLines", "specialCharacters"];

/**
 * The text tools, one workspace: a full editor with cleaning, case conversion, statistics and export
 * alongside. The routes (editor, cleaner, case converter, word counter) open it on the matching panel;
 * the document is shared between them and kept on this device.
 */
export function TextWorkspace({ tool, tab }: { tool: ToolKey; tab: TextTab }) {
    const { content, revision, load } = useTextDocument();
    useEffect(() => void load(), [load]);
    if (!content) return null;
    return <TextStudio key={revision} tool={tool} initialTab={tab} content={content} />;
}

function TextStudio({ tool, initialTab, content }: { tool: ToolKey; initialTab: TextTab; content: JSONContent }) {
    const t = useT();
    const copy = t.text;
    const update = useTextDocument((state) => state.update);
    const editor = useTextEditor({ content, label: copy.editorLabel, placeholder: copy.placeholder, spellcheck: true, onChange: update });
    const [tab, setTab] = useState<TextTab>(initialTab);
    // The menu's "Find & Replace" opens the editor with Replace showing (?find=replace).
    const [params] = useSearchParams();
    const [find, setFind] = useState<"find" | "replace" | null>(() => (params.get("find") === "replace" ? "replace" : params.has("find") ? "find" : null));
    const [notice, setNotice] = useState<Notice | null>(null);
    const [busy, setBusy] = useState<TextExport | null>(null);
    const workspace = useRef<HTMLDivElement>(null);
    const picker = useRef<HTMLInputElement>(null);

    // What the side panels need, read from the editor as it changes.
    const view = useEditorState({
        editor,
        selector: ({ editor: current }) => {
            const { from, to, empty } = current.state.selection;
            return { text: plainText(current.state.doc), selected: empty ? "" : current.state.doc.textBetween(from, to, "\n\n", "\n") };
        },
    });
    // Counting a long document on every keystroke would lag typing: counts follow a moment behind.
    const text = useDeferredValue(view.text);
    const selected = useDeferredValue(view.selected);
    const stats = useMemo(() => textStats(text), [text]);
    const selectionStats = useMemo(() => (selected.trim() ? textStats(selected) : null), [selected]);

    // ⌘/Ctrl+F finds; ⌘/Ctrl+H (or ⌘⌥F, since macOS keeps ⌘H) opens Replace.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey)) return;
            if (event.code === "KeyH" || (event.code === "KeyF" && event.altKey)) {
                event.preventDefault();
                setFind("replace");
            } else if (event.code === "KeyF") {
                event.preventDefault();
                setFind("find");
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // ------------------------------------------------------------------ opening files
    const open = useCallback(
        async (files: File[]) => {
            const file = files[0];
            if (!file) return;
            if (file.size > MAX_OPEN_BYTES) return setNotice({ tone: "error", text: copy.open.tooLarge });
            const name = file.name.toLowerCase();
            if (!/\.(txt|md|markdown|html?)$/.test(name) && !["text/plain", "text/markdown", "text/html"].includes(file.type)) return setNotice({ tone: "error", text: copy.open.unsupported });
            const body = await file.text();
            // HTML is read through the editor's own schema: only text and supported formatting survive (no scripts, no styles from outside).
            if (/\.html?$/.test(name) || file.type === "text/html") editor.chain().focus().setContent(body).run();
            else editor.chain().focus().setContent(textToContent(body)).run();
            setNotice({ tone: "success", text: copy.open.opened(file.name) });
        },
        [editor, copy.open],
    );
    const startNew = () => {
        editor.chain().focus().setContent({ type: "doc", content: [{ type: "paragraph" }] }).run();
        setNotice({ tone: "info", text: copy.newDocument });
    };

    // ------------------------------------------------------------------ cleaning
    const [rules, setRules] = useState<Set<CleanRule>>(new Set(DEFAULT_RULES));
    const [preview, setPreview] = useState<{ doc: JSONContent; counts: CleanCounts; before: string; after: string } | null>(null);
    const runPreview = () => {
        const { doc, counts } = cleanDocument(editor.getJSON(), rules);
        setPreview({ doc, counts, before: plainText(editor.state.doc), after: plainText(editor.schema.nodeFromJSON(doc)) });
    };
    const applyClean = () => {
        if (!preview) return;
        // One step: Undo brings the text back exactly as it was.
        editor.chain().focus().setContent(preview.doc).run();
        const total = Object.values(preview.counts).reduce((sum, count) => sum + count, 0);
        setPreview(null);
        setNotice({ tone: "success", text: copy.clean.applied(total) });
    };
    const diff = useMemo(() => (preview ? lineDiff(preview.before, preview.after) : null), [preview]);

    // ------------------------------------------------------------------ case
    const convert = (mode: CaseMode) => {
        applyCase(editor, mode, t.meta.lang);
        setNotice({ tone: "success", text: copy.case.done(copy.case.modes[mode]) });
    };

    // ------------------------------------------------------------------ export
    const name = copy.fileName;
    const save = (blob: Blob, fileName: string) => {
        const url = URL.createObjectURL(blob);
        downloadFile(url, fileName);
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
        setNotice({ tone: "success", text: t.documents.result.downloadFile(fileName) });
    };
    const [exportAs, setExportAs] = useState<Exclude<TextExport, "copy"> | null>(null);
    const runExport = async (kind: TextExport, fileName = `${name}.${kind}`, title = name) => {
        const plain = plainText(editor.state.doc);
        if (!plain.trim()) return setNotice({ tone: "error", text: copy.export.empty });
        setBusy(kind);
        try {
            const html = editor.getHTML();
            const lang = /[ऀ-ॿ]/.test(plain) ? "ne" : "en";
            if (kind === "copy") {
                try {
                    await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([plain], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
                } catch {
                    await navigator.clipboard.writeText(plain);
                }
                setNotice({ tone: "success", text: t.ocr.export.copied });
            } else if (kind === "txt") save(new Blob([plain.replace(/\n/g, "\r\n")], { type: "text/plain;charset=utf-8" }), fileName);
            else if (kind === "docx") {
                const { exportDocx } = await import("@/features/ocr/exportDocx");
                save(await exportDocx(editor.state.doc, title), fileName);
            } else if (kind === "pdf") await printDocument({ pages: [{ html, layout: null, colours: { background: "#ffffff", ink: "#1a1a1a" } }], title, lang });
            else save(new Blob([`<!doctype html>\n<html lang="${lang}">\n<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>\n<body>\n${html}\n</body>\n</html>\n`], { type: "text/html;charset=utf-8" }), fileName);
        } catch {
            setNotice({ tone: "error", text: kind === "copy" ? t.ocr.export.copyFailed : t.ocr.export.failed });
        } finally {
            setBusy(null);
        }
    };

    const tabs = useMemo(
        () => [
            { id: "clean" as const, label: copy.tabs.clean, icon: <BrushCleaning className="size-4" aria-hidden /> },
            { id: "case" as const, label: copy.tabs.case, icon: <CaseSensitive className="size-4" aria-hidden /> },
            { id: "stats" as const, label: copy.tabs.stats, icon: <Sigma className="size-4" aria-hidden /> },
            { id: "export" as const, label: copy.tabs.export, icon: <Share className="size-4" aria-hidden /> },
        ],
        [copy.tabs],
    );
    const iconButton =
        "grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-secondary transition-colors duration-150 outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 aria-pressed:bg-[var(--brand-soft)] aria-pressed:text-[var(--brand)] pointer-coarse:size-11";

    return (
        <DocumentStudio
            tool={tool}
            accept={ACCEPT}
            onFiles={(files) => void open(files)}
            panelLabel={copy.panelLabel}
            actions={
                <>
                    <input ref={picker} type="file" accept={ACCEPT} hidden onChange={(event) => void open([...(event.target.files ?? [])]).finally(() => (event.target.value = ""))} />
                    <button type="button" className={iconButton} onClick={() => picker.current?.click()} aria-label={copy.open.action} title={copy.open.action}>
                        <FolderOpen className="size-[1.125rem]" aria-hidden />
                    </button>
                    <button type="button" className={iconButton} onClick={startNew} aria-label={copy.new} title={copy.new}>
                        <FilePlus className="size-[1.125rem]" aria-hidden />
                    </button>
                    <button type="button" className={iconButton} onClick={() => setFind((open_) => (open_ ? null : "find"))} aria-pressed={Boolean(find)} aria-label={t.ocr.toolbar.find} title={t.ocr.toolbar.find}>
                        <Search className="size-[1.125rem]" aria-hidden />
                    </button>
                </>
            }
            exportSlot={
                <button type="button" className={studioExportButton} onClick={() => void runExport("copy")} disabled={busy !== null} aria-label={t.ocr.export.copy}>
                    <Copy className="size-4" aria-hidden />
                    <span className="hidden sm:inline">{t.ocr.export.copy}</span>
                </button>
            }
            panel={
                <>
                    <PanelTabs tabs={tabs} value={tab} onChange={(next) => (setTab(next), next !== "clean" && setPreview(null))} label={copy.panelLabel} />
                    <PanelBody id={tab}>
                        {tab === "clean" && <CleanPanel rules={rules} onRules={(next) => (setRules(next), setPreview(null))} counts={preview?.counts ?? null} previewing={Boolean(preview)} onPreview={runPreview} onApply={applyClean} onCancel={() => setPreview(null)} />}
                        {tab === "case" && <CasePanel sample={(selected || text).slice(0, 140)} target={selected.trim() ? "selection" : "document"} onApply={convert} />}
                        {tab === "stats" && <StatsPanel stats={stats} selection={selectionStats} />}
                        {tab === "export" && <ExportList busy={busy} onExport={(kind) => (kind === "copy" ? void runExport(kind) : setExportAs(kind))} />}
                    </PanelBody>
                </>
            }
        >
            <div ref={workspace} className="relative flex h-[calc(100svh-7.5rem)] min-h-[28rem] flex-col overflow-hidden rounded-xl border border-[var(--card-line)] bg-secondary lg:h-auto lg:min-h-0 lg:flex-1">
                {preview && diff ? (
                    <CleanPreview before={diff.before} after={diff.after} />
                ) : (
                    <>
                        <OcrToolbar editor={editor} extended />
                        {find && <FindReplaceBar key={find} editor={editor} focus={find} onClose={() => setFind(null)} onReplaced={(count) => setNotice({ tone: "success", text: t.ocr.find.replaced(count) })} />}
                        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
                            <Page editor={editor} />
                        </div>
                        <StatusBar words={stats.words} characters={stats.characters} selection={selectionStats?.words ?? null} />
                    </>
                )}
            </div>
            {notice && <StudioNotice notice={notice} />}
            <ExportDialog
                open={exportAs !== null}
                onClose={() => setExportAs(null)}
                title={t.documents.exportDialog.title}
                formats={[
                    { value: "txt", label: copy.export.txt, extension: "txt" },
                    { value: "docx", label: copy.export.docx, extension: "docx" },
                    { value: "pdf", label: copy.export.pdf, extension: "pdf", prints: true, hint: copy.export.pdfHint },
                    { value: "html", label: copy.export.html, extension: "html" },
                ]}
                initialFormat={exportAs ?? "docx"}
                name={name}
                onExport={({ format, fileName, baseName }) => runExport(format, fileName, baseName)}
            />
        </DocumentStudio>
    );
}

/** The page you write on: paper in light mode, dark in dark mode (exports are always on white). */
function Page({ editor }: { editor: Editor }) {
    return (
        <div className="flex min-h-full w-full justify-center p-3 sm:p-5">
            <div className="ocr-page text-page" style={{ width: "100%", maxWidth: 816, minHeight: "100%" }}>
                <EditorContent editor={editor} className="h-full" />
            </div>
        </div>
    );
}

function StatusBar({ words, characters, selection }: { words: number; characters: number; selection: number | null }) {
    const copy = useT().text.stats;
    return (
        <p aria-live="polite" className="flex shrink-0 items-center gap-3 border-t border-[var(--card-line)] bg-primary px-3 py-1.5 text-xs text-tertiary tabular-nums">
            <span>{copy.wordCount(words)}</span>
            <span aria-hidden>·</span>
            <span>{copy.characterCount(characters)}</span>
            {selection !== null && (
                <>
                    <span aria-hidden>·</span>
                    <span className="text-[var(--brand)]">{copy.selectedWords(selection)}</span>
                </>
            )}
        </p>
    );
}

/** Before | After, line by line, the lines that change highlighted. */
function CleanPreview({ before, after }: { before: { text: string; changed: boolean }[]; after: { text: string; changed: boolean }[] }) {
    const copy = useT().text.clean;
    const column = (title: string, lines: { text: string; changed: boolean }[], tone: "before" | "after") => (
        <section aria-label={title} className="flex min-h-0 min-w-0 flex-col">
            <h3 className="shrink-0 border-b border-[var(--card-line)] bg-primary px-3 py-2 text-xs font-semibold tracking-wide text-tertiary uppercase">{title}</h3>
            <ol className="min-h-0 flex-1 overflow-auto bg-primary py-2 font-mono text-[0.8125rem] leading-relaxed">
                {lines.map((line, index) => (
                    <li
                        key={index}
                        className={cn("px-3 break-words whitespace-pre-wrap", line.changed && (tone === "before" ? "bg-error-primary text-error-primary line-through decoration-1" : "bg-success-primary text-success-primary"))}
                    >
                        {line.text || " "}
                    </li>
                ))}
            </ol>
        </section>
    );
    return (
        <div className="grid min-h-0 flex-1 grid-rows-2 divide-y divide-[var(--card-line)] md:grid-cols-2 md:grid-rows-1 md:divide-x md:divide-y-0">
            {column(copy.before, before, "before")}
            {column(copy.after, after, "after")}
        </div>
    );
}
