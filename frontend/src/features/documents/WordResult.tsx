import type { JSONContent } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { FileDown, FilePenLine, Info, RotateCcw } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/base/buttons/button";
import { fitFontSizes, plainText, toEditorContent } from "@/features/ocr/convert";
import { printDocument } from "@/features/ocr/printPdf";
import { exportDocx } from "@/features/ocr/exportDocx";
import { BlockFormat, LowConfidence } from "@/features/ocr/extensions";
import { openInTextEditor } from "@/features/text/textDocument";
import { fetchJobFile, type Job } from "@/lib/api/jobsApi";
import type { OcrDocument } from "@/lib/api/ocrApi";
import { ROUTES } from "@/lib/constants/routes";
import { downloadFile } from "@/lib/utils/download";
import { useT } from "@/i18n";
import { ExportDialog, type ExportFormat } from "./ExportDialog";
import { Figure, figureNode, withoutFigures } from "./figure";

type WordFormat = "layout" | "docx" | "pdf" | "txt";
import "@/features/ocr/ocr.css";

type Method = "text" | "ocr" | "none";

interface WordPage {
    page: number;
    method: Method;
    document: OcrDocument | null;
    figures: { editorBox: { x: number; y: number; width: number; height: number }; width: number; height: number; data: string }[];
}

/** Page pixels: the width the reconstructed page is laid out at (and a Word page's, at 96 dpi). */
const PAGE_WIDTH = 816;

/**
 * A page as editor content: its text blocks in reading order, with each picture placed before the
 * first block below it — so it lands among the text where it was.
 */
async function pageContent(page: WordPage, alt: string): Promise<JSONContent> {
    const document = page.document && page.method === "ocr" ? await fitFontSizes(page.document) : page.document;
    const nodes = document?.blocks.length ? (toEditorContent(document).content ?? []) : [];
    const tops = document?.blocks.map((block) => block.editorBox.y) ?? [];
    const placed: { at: number; node: JSONContent }[] = page.figures.map((figure) => {
        const width = Math.max(24, figure.editorBox.width * PAGE_WIDTH);
        const at = tops.findIndex((top) => top >= figure.editorBox.y);
        return { at: at < 0 ? nodes.length : at, node: figureNode(figure.data, width, (width * figure.height) / Math.max(1, figure.width), alt) };
    });
    const content: JSONContent[] = [];
    nodes.forEach((node, index) => {
        for (const figure of placed) if (figure.at === index) content.push(figure.node);
        content.push(node);
    });
    for (const figure of placed) if (figure.at >= nodes.length) content.push(figure.node);
    return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/**
 * The converted document, page by page, in editors: fix anything before downloading the Word file
 * (which is made from what you see here), or carry the text on to the Text Editor.
 */
export function WordResult({ job, name, onStartOver }: { job: Job; name: string; onStartOver: () => void }) {
    const t = useT();
    const copy = t.documents.toWord;
    const [pages, setPages] = useState<{ page: WordPage; content: JSONContent }[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);
    const editors = useRef(new Map<number, Editor>());
    const navigate = useNavigate();

    useEffect(() => {
        const file = job.files.find((candidate) => candidate.mimeType.startsWith("application/json"));
        if (!file) return;
        const controller = new AbortController();
        void fetchJobFile(job.id, file.id, controller.signal)
            .then((blob) => blob.text())
            .then(async (body) => {
                const list = (JSON.parse(body) as { pages: WordPage[] }).pages;
                const built = await Promise.all(list.map(async (page) => ({ page, content: await pageContent(page, copy.figureAlt(page.page)) })));
                if (!controller.signal.aborted) setPages(built);
            })
            .catch(() => !controller.signal.aborted && setFailed(true));
        return () => controller.abort();
    }, [job, copy]);

    const docs = () => (pages ?? []).map(({ page }) => editors.current.get(page.page)).filter((editor): editor is Editor => Boolean(editor));

    // The server's Word file keeps the page layout; the editor's export reflects any edits made here.
    const layoutFile = job.files.find((candidate) => candidate.name.endsWith(".docx"));
    const formats: ExportFormat<WordFormat>[] = [
        ...(layoutFile ? [{ value: "layout" as const, label: copy.layoutFormat, extension: "docx", hint: copy.layoutHint }] : []),
        { value: "docx", label: layoutFile ? copy.editedFormat : t.ocr.export.docx, extension: "docx" },
        { value: "pdf", label: t.ocr.export.pdf, extension: "pdf", prints: true, hint: t.ocr.export.pdfHint },
        { value: "txt", label: t.ocr.export.txt, extension: "txt" },
    ];
    /** The pages as edited, in the chosen format — Word keeps the pictures and each page starts a new page. */
    const exportPages = async (format: WordFormat, fileName: string, baseName: string, chosen: number[] | null) => {
        const selected = docs().filter((_, index) => !chosen || chosen.includes(index + 1));
        if (format === "layout" && layoutFile) {
            const blob = await fetchJobFile(job.id, layoutFile.id);
            const url = URL.createObjectURL(blob);
            downloadFile(url, fileName);
            window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
            setNotice(t.documents.result.downloadFile(fileName));
        } else if (format === "docx") {
            const blob = await exportDocx(
                selected.map((editor) => editor.state.doc),
                baseName,
            );
            const url = URL.createObjectURL(blob);
            downloadFile(url, fileName);
            window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
            setNotice(t.documents.result.downloadFile(fileName));
        } else if (format === "txt") {
            const text = selected.map((editor) => plainText(editor.state.doc)).join("\n\n");
            const url = URL.createObjectURL(new Blob([text.replace(/\n/g, "\r\n")], { type: "text/plain;charset=utf-8" }));
            downloadFile(url, fileName);
            window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
            setNotice(t.documents.result.downloadFile(fileName));
        } else {
            const html = selected.map((editor) => editor.getHTML());
            await printDocument({ pages: html.map((page) => ({ html: page, layout: null, colours: { background: "#ffffff", ink: "#1a1a1a" } })), title: baseName, lang: html.some((page) => /[ऀ-ॿ]/.test(page)) ? "ne" : "en" });
        }
    };

    if (failed) return <p className="py-10 text-center text-sm text-error-primary">{t.errors.GENERIC}</p>;
    if (!pages) return <p className="py-10 text-center text-sm text-tertiary">{t.documents.errors.loading}</p>;

    const { textPages = 0, ocrPages = 0, figures = 0, ocrUnavailable = 0 } = job.summary;
    return (
        <div className="animate-enter mx-auto flex w-full max-w-4xl flex-col gap-4 py-4 [--i:-1] sm:py-6">
            <div className="flex flex-col gap-3">
                <div>
                    <h2 className="text-lg font-semibold text-primary">{copy.ready}</h2>
                    <p className="text-sm text-tertiary tabular-nums">{copy.summary(pages.length, textPages, ocrPages, figures)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button size="md" color="primary" iconLeading={FileDown} onPress={() => setExporting(true)}>
                        {copy.download}
                    </Button>
                    <Button
                        size="md"
                        color="secondary"
                        iconLeading={FilePenLine}
                        onPress={() => {
                            openInTextEditor({ type: "doc", content: docs().flatMap((editor) => withoutFigures(editor.getJSON()).content ?? []) });
                            navigate(ROUTES.textEditor);
                        }}
                    >
                        {copy.openEditor}
                    </Button>
                </div>
            </div>
            <p className="flex gap-2 rounded-xl border border-[var(--card-line)] bg-secondary px-3 py-2.5 text-xs leading-relaxed text-secondary">
                <Info className="mt-0.5 size-3.5 shrink-0 text-tertiary" aria-hidden />
                <span>
                    {copy.approximate} {ocrUnavailable ? copy.ocrUnavailable : ""}
                </span>
            </p>
            {notice && (
                <p role="status" className="text-xs text-success-primary">
                    {notice}
                </p>
            )}
            <ExportDialog
                open={exporting}
                onClose={() => setExporting(false)}
                title={t.documents.exportDialog.title}
                formats={formats}
                name={name}
                pageCount={pages.length}
                onExport={({ format, fileName, baseName, pages: chosen }) => exportPages(format, fileName, baseName, chosen)}
            />
            <ol className="flex flex-col gap-6">
                {pages.map(({ page, content }) => (
                    <li key={page.page} className="flex flex-col gap-2">
                        <p className="text-sm font-semibold text-primary">
                            {copy.page(page.page)} <span className="font-normal text-tertiary">· {copy.methods[page.method]}</span>
                        </p>
                        <PageEditor content={content} label={copy.page(page.page)} page={page.page} editors={editors} />
                    </li>
                ))}
            </ol>
            <div className="flex justify-center py-2">
                <Button size="lg" color="tertiary" iconLeading={RotateCcw} onPress={onStartOver}>
                    {t.documents.result.startOver}
                </Button>
            </div>
        </div>
    );
}

/** One page, editable, laid out as Word will show it. */
function PageEditor({ content, label, page, editors }: { content: JSONContent; label: string; page: number; editors: RefObject<Map<number, Editor>> }) {
    const editor = useEditor({
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2, 3] }, code: false, codeBlock: false, blockquote: false, link: false, undoRedo: { depth: 200 } }),
            TextStyleKit.configure({ lineHeight: false, backgroundColor: false }),
            TextAlign.configure({ types: ["heading", "paragraph"] }),
            Highlight.configure({ multicolor: true }),
            TableKit.configure({ table: { resizable: false } }),
            BlockFormat,
            LowConfidence,
            Figure,
        ],
        content,
        shouldRerenderOnTransaction: false,
        editorProps: { attributes: { "aria-label": label, "aria-multiline": "true", role: "textbox" } },
    });
    useEffect(() => {
        const map = editors.current;
        map.set(page, editor);
        return () => void map.delete(page);
    }, [editor, editors, page]);
    return (
        <div className="ocr-page ocr-hide-low w-full" style={{ maxWidth: PAGE_WIDTH }}>
            <EditorContent editor={editor} />
        </div>
    );
}
