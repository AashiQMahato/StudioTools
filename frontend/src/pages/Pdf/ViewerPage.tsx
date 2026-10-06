import { FilePlus2, FileText } from "lucide-react";
import { useState } from "react";
import { BottomSheet } from "@/components/studio/BottomSheet";
import { useStudio } from "@/components/studio/StudioShell";
import { PanelBody, PanelIntro, StudioCanvas, StudioDropzone, StudioNotice } from "@/components/studio/StudioParts";
import { Button } from "@/components/ui/base/buttons/button";
import { ContinueWith } from "@/features/documents/ContinueWith";
import { DocumentStudio } from "@/features/documents/DocumentStudio";
import { MAX_PDF_MB, PDF_ACCEPT } from "@/features/documents/limits";
import { SinglePdfWorkspace } from "@/features/documents/SinglePdfWorkspace";
import { useSinglePdf } from "@/features/documents/useSinglePdf";
import { PdfViewer } from "@/features/pdf-canvas/PdfViewer";
import { formatBytes } from "@/features/image-processing/format";
import { useT } from "@/i18n";

/** Read a PDF in the browser — nothing is uploaded. */
export function ViewerPage() {
    const t = useT();
    const copy = t.documents.viewer;
    const pdf = useSinglePdf();
    const [sheet, setSheet] = useState(false);
    const details = (
        <PanelBody>
            {pdf.file ? (
                <>
                    <section className="flex flex-col gap-2">
                        <FileCard name={pdf.file.name} pages={pdf.ready?.sizes.length ?? null} size={pdf.file.size} />
                        <OpenAnother label={copy.openAnother} />
                    </section>
                    {pdf.ready && <ContinueWith kind="pdf" current="pdfViewer" files={async () => [pdf.file!]} />}
                </>
            ) : (
                <PanelIntro title={t.studio.howItWorks} steps={copy.steps} />
            )}
            <p className="px-1 text-xs leading-relaxed text-tertiary">{copy.local}</p>
        </PanelBody>
    );

    return (
        <DocumentStudio
            tool="pdfViewer"
            accept={PDF_ACCEPT}
            onFiles={pdf.receive}
            panelLabel={t.nav.toolItems.pdfViewer.title}
            panel={details}
            mobilePanel={pdf.file ? "none" : "stack"}
            panelWidth="compact"
            hasWork={Boolean(pdf.file)}
        >
            {pdf.file ? (
                <SinglePdfWorkspace pdf={pdf}>{({ document, sizes }) => <PdfViewer key={pdf.id} file={pdf.file!} document={document} sizes={sizes} onDetails={() => setSheet(true)} />}</SinglePdfWorkspace>
            ) : (
                <StudioCanvas>
                    <StudioDropzone title={t.documents.dropPdf} hint={copy.hint} limits={t.documents.pdfLimits(MAX_PDF_MB)} kind="pdf" actionLabel={t.documents.uploadPdf} />
                </StudioCanvas>
            )}
            {pdf.problem && <StudioNotice notice={{ tone: "error", text: pdf.problem }} />}
            <BottomSheet open={sheet} onClose={() => setSheet(false)} title={copy.details} closeLabel={t.documents.done}>
                {details}
            </BottomSheet>
        </DocumentStudio>
    );
}

/** The open file: name, then pages and size on one line. */
function FileCard({ name, pages, size }: { name: string; pages: number | null; size: number }) {
    const t = useT();
    const details = [pages !== null ? t.documents.result.pages(pages) : null, formatBytes(size)].filter(Boolean).join(" · ");
    return (
        <div className="flex items-center gap-3 rounded-xl border border-[var(--card-line)] bg-secondary p-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-[var(--brand)] shadow-xs">
                <FileText className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold text-primary" title={name}>
                    {name}
                </h3>
                <p className="text-xs text-tertiary tabular-nums">{details}</p>
            </div>
        </div>
    );
}

function OpenAnother({ label }: { label: string }) {
    const { openPicker } = useStudio();
    return (
        <Button size="sm" color="secondary" iconLeading={FilePlus2} onPress={openPicker} className="w-full">
            {label}
        </Button>
    );
}
