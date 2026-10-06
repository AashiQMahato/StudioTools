import { FileImage, FileStack, Image as ImageIcon, Layers, Sparkles, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PanelArt, ToolbarSelect } from "@/components/studio/StudioParts";
import { Range } from "@/features/background-removal/editor/RefinePanel";
import { DocumentToolLayout } from "@/features/documents/DocumentToolLayout";
import { MAX_PDF_MB, PDF_ACCEPT } from "@/features/documents/limits";
import { PageGrid, type PageItem } from "@/features/documents/PageGrid";
import { PdfFileSummary, SinglePdfWorkspace } from "@/features/documents/SinglePdfWorkspace";
import { useDocumentJob } from "@/features/documents/useDocumentJob";
import { useSinglePdf } from "@/features/documents/useSinglePdf";
import { PageScopeControl } from "@/features/documents/PageScopeControl";
import { usePageScope } from "@/features/documents/usePageScope";
import { jobFileUrl } from "@/lib/api/jobsApi";
import { useT } from "@/i18n";

type Format = "jpg" | "png" | "webp";
const FORMATS: readonly Format[] = ["jpg", "png", "webp"];
const RESOLUTIONS = [72, 150, 300] as const;
const PREVIEW_LIMIT = 12;

export function ToImagesPage() {
    const t = useT();
    const copy = t.documents.toImages;
    const job = useDocumentJob();
    const pdf = useSinglePdf();
    // "PDF to JPG" / "PDF to PNG" links open this page with the format already chosen (?format=png).
    const [params] = useSearchParams();
    const [format, setFormat] = useState<Format>(() => FORMATS.find((value) => value === params.get("format")) ?? "jpg");
    const [dpi, setDpi] = useState<(typeof RESOLUTIONS)[number]>(150);
    const [quality, setQuality] = useState(85);
    const count = pdf.ready?.sizes.length ?? 0;
    const pages = usePageScope(count);
    const first = pdf.ready?.sizes[0];

    const items = useMemo<PageItem[]>(() => Array.from({ length: count }, (_, index) => ({ key: String(index + 1), page: index + 1, rotate: 0 })), [count]);
    const chosen = pages.count;

    const convert = () => {
        if (!pdf.file) return;
        const form = new FormData();
        form.append("format", format);
        form.append("dpi", String(dpi));
        form.append("quality", String(quality));
        if (pages.param) form.append("pages", pages.param);
        form.append("files", pdf.file, pdf.file.name);
        void job.run("/pdf/to-images", form);
    };
    const startOver = () => {
        job.reset();
        pdf.clear();
        pages.reset();
    };
    const result = job.job;

    return (
        <DocumentToolLayout
            tool="pdfToImages"
            accept={PDF_ACCEPT}
            onFiles={pdf.receive}
            empty={!pdf.file}
            drop={{
                title: t.documents.dropPdf,
                hint: copy.intro,
                limits: t.documents.pdfLimits(MAX_PDF_MB),
                headline: copy.headline,
                features: [
                    { icon: Layers, ...copy.features[0]! },
                    { icon: FileStack, ...copy.features[1]! },
                    { icon: Sparkles, ...copy.features[2]! },
                ],
            }}
            intro={copy.guide}
            guide={{ art: <PanelArt from="pdf" to="images" />, formats: FORMATS.map((value) => (value === "webp" ? "WebP" : value.toUpperCase())), tip: copy.tip }}
            quickSettings={
                <>
                    <ToolbarSelect icon={ImageIcon} label={copy.imageFormat} value={format} onChange={setFormat} options={FORMATS.map((value) => ({ value, label: value === "webp" ? "WebP" : value.toUpperCase() }))} />
                    <ToolbarSelect icon={Star} label={copy.quality} value={dpi} onChange={setDpi} options={RESOLUTIONS.map((value) => ({ value, label: `${copy.qualityPresets[value]} · ${value} dpi` }))} />
                </>
            }
            job={job}
            runningTitle={copy.running}
            onStartOver={startOver}
            notice={pdf.problem ? { tone: "error", text: pdf.problem } : null}
            result={
                result && (
                    <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3">
                        {result.files.slice(0, PREVIEW_LIMIT).map((file) => (
                            <li key={file.id} className="overflow-hidden rounded-lg border border-[var(--card-line)] bg-white">
                                <img src={jobFileUrl(result.id, file.id, true)} alt={file.name} loading="lazy" className="aspect-[3/4] w-full object-contain" />
                            </li>
                        ))}
                    </ul>
                )
            }
            options={
                <>
                    <PdfFileSummary name={pdf.file?.name ?? ""} pages={count || null} />
                    <PageScopeControl scope={pages} pageCount={count} label={copy.pages} rangesLabel={copy.rangesLabel} />
                    <section className="flex flex-col gap-3">
                        {format !== "png" ? <Range label={copy.quality} value={quality} min={40} max={100} onChange={setQuality} format={(value) => `${value}%`} /> : <p className="text-xs text-tertiary">{copy.pngHint}</p>}
                        {first && <p className="text-xs text-tertiary tabular-nums">{copy.resolutions[dpi]} · {copy.pixels(Math.round((first.width / 72) * dpi), Math.round((first.height / 72) * dpi))}</p>}
                    </section>
                </>
            }
            action={{ label: !pdf.file || chosen === count ? copy.convertAction : !chosen ? copy.actionNone : copy.action(chosen), icon: FileImage, onPress: convert, disabled: !pdf.ready || chosen === 0 }}
        >
            <SinglePdfWorkspace pdf={pdf}>
                {({ document, sizes }) => (
                    <PageGrid
                        document={document}
                        sizes={sizes}
                        items={items}
                        label={copy.gridLabel}
                        {...pages.grid}
                    />
                )}
            </SinglePdfWorkspace>
        </DocumentToolLayout>
    );
}
