import { FileText, RotateCw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Segmented } from "@/components/common/Segmented";
import { Range } from "@/features/background-removal/editor/RefinePanel";
import { DocumentToolLayout } from "@/features/documents/DocumentToolLayout";
import { DEFAULT_IMAGES_TO_PDF, type ImagesToPdfOptions, type PageSize, placeImage } from "@/features/documents/imageLayout";
import { MAX_FILES } from "@/features/documents/limits";
import { PagePreview } from "@/features/documents/PagePreview";
import { SortableCards } from "@/features/documents/SortableCards";
import { useDocumentJob } from "@/features/documents/useDocumentJob";
import { formatBytes } from "@/features/image-processing/format";
import { prepareImageFile } from "@/hooks/useImageUpload";
import { UPLOAD_ACCEPT } from "@/lib/constants/upload";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";

interface Entry {
    id: string;
    file: File;
    url: string;
    dimensions: { width: number; height: number };
    rotate: 0 | 90 | 180 | 270;
}

const MARGINS = [0, 5, 10, 20] as const;
const RESOLUTIONS = ["none", 300, 200, 150] as const;

export function ImagesToPdfPage() {
    const t = useT();
    const copy = t.documents.fromImages;
    const job = useDocumentJob();
    const [entries, setEntries] = useState<Entry[]>([]);
    const [options, setOptions] = useState<ImagesToPdfOptions>(DEFAULT_IMAGES_TO_PDF);
    const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
    const set = (patch: Partial<ImagesToPdfOptions>) => setOptions((current) => ({ ...current, ...patch }));
    const widthId = useId();
    const heightId = useId();

    // Previews are object URLs: freed when an image leaves (and when the page does).
    const urls = useRef(new Set<string>());
    useEffect(() => {
        const held = urls.current;
        return () => held.forEach((url) => URL.revokeObjectURL(url));
    }, []);

    /** Picked, dropped or pasted images: checked (and HEIC converted) one by one, then added in order. */
    const receive = async (files: File[]) => {
        const room = MAX_FILES - entries.length;
        let problem: string | null = files.length > room ? t.documents.tooMany(MAX_FILES) : null;
        for (const picked of files.slice(0, Math.max(0, room))) {
            const prepared = await prepareImageFile(picked, t, (status) => status && setNotice({ tone: "info", text: status }));
            if (!prepared.ok) {
                problem = `${picked.name}: ${prepared.error}`;
                continue;
            }
            const url = URL.createObjectURL(prepared.file);
            urls.current.add(url);
            const entry: Entry = { id: crypto.randomUUID(), file: prepared.file, url, dimensions: prepared.dimensions, rotate: 0 };
            setEntries((current) => [...current, entry]);
        }
        setNotice(problem ? { tone: "error", text: problem } : null);
    };
    const remove = (entry: Entry) => {
        URL.revokeObjectURL(entry.url);
        urls.current.delete(entry.url);
        setEntries((current) => current.filter((item) => item.id !== entry.id));
    };
    const rotate = (entry: Entry) => setEntries((current) => current.map((item) => (item.id === entry.id ? { ...item, rotate: ((item.rotate + 90) % 360) as Entry["rotate"] } : item)));
    const startOver = () => {
        job.reset();
        entries.forEach((entry) => {
            URL.revokeObjectURL(entry.url);
            urls.current.delete(entry.url);
        });
        setEntries([]);
        setNotice(null);
    };

    const create = () => {
        const form = new FormData();
        form.append("size", options.size);
        form.append("orientation", options.orientation);
        form.append("customWidth", String(options.custom.width));
        form.append("customHeight", String(options.custom.height));
        form.append("margin", String(options.margin));
        form.append("fit", options.fit);
        form.append("quality", String(options.quality));
        form.append("maxDpi", options.maxDpi === null ? "none" : String(options.maxDpi));
        form.append("rotations", JSON.stringify(entries.map((entry) => entry.rotate)));
        for (const entry of entries) form.append("files", entry.file, entry.file.name);
        void job.run("/pdf/from-images", form);
    };

    const sized = (entry: Entry) => (entry.rotate % 180 ? { width: entry.dimensions.height, height: entry.dimensions.width } : entry.dimensions);
    const customValid = options.size !== "custom" || (options.custom.width >= 20 && options.custom.width <= 2000 && options.custom.height >= 20 && options.custom.height <= 2000);
    const mmInput = "h-10 w-full rounded-lg border border-[var(--card-line)] bg-primary px-3 text-sm text-primary tabular-nums outline-focus-ring focus-visible:outline-2 pointer-coarse:h-11";

    return (
        <DocumentToolLayout
            tool="imagesToPdf"
            accept={UPLOAD_ACCEPT}
            onFiles={(files) => void receive(files)}
            empty={entries.length === 0}
            drop={{ title: t.documents.dropImages, hint: copy.hint, limits: t.documents.imageLimits }}
            intro={copy.steps}
            job={job}
            runningTitle={copy.running}
            onStartOver={startOver}
            notice={notice}
            many
            action={{ label: copy.action(entries.length), icon: FileText, onPress: create, disabled: !entries.length || !customValid }}
            options={
                <>
                    <section className="flex flex-col gap-3">
                        <h3 className="text-sm font-semibold text-primary">{copy.pageSize}</h3>
                        <div role="radiogroup" aria-label={copy.pageSize} className="grid grid-cols-3 gap-2">
                            {(["a4", "letter", "legal", "original", "custom"] as const).map((size: PageSize) => (
                                <button
                                    key={size}
                                    type="button"
                                    role="radio"
                                    aria-checked={options.size === size}
                                    onClick={() => set({ size })}
                                    className={cn(
                                        "min-h-10 cursor-pointer rounded-lg border px-2 text-sm font-medium outline-focus-ring transition-colors duration-150 focus-visible:outline-2 pointer-coarse:min-h-11",
                                        options.size === size ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]" : "border-[var(--card-line)] text-secondary hover:bg-primary_hover hover:text-primary",
                                    )}
                                >
                                    {copy.sizes[size]}
                                </button>
                            ))}
                        </div>
                        {options.size === "custom" && (
                            <div className="grid grid-cols-2 gap-2">
                                <label htmlFor={widthId} className="flex flex-col gap-1 text-xs font-medium text-secondary">
                                    {copy.customWidth}
                                    <input id={widthId} type="number" inputMode="decimal" min={20} max={2000} value={options.custom.width} onChange={(event) => set({ custom: { ...options.custom, width: Number(event.target.value) } })} className={mmInput} />
                                </label>
                                <label htmlFor={heightId} className="flex flex-col gap-1 text-xs font-medium text-secondary">
                                    {copy.customHeight}
                                    <input id={heightId} type="number" inputMode="decimal" min={20} max={2000} value={options.custom.height} onChange={(event) => set({ custom: { ...options.custom, height: Number(event.target.value) } })} className={mmInput} />
                                </label>
                                {!customValid && <p className="col-span-2 text-xs text-error-primary">{copy.customRange}</p>}
                            </div>
                        )}
                        {options.size !== "original" && (
                            <Segmented label={copy.orientation} value={options.orientation} onChange={(orientation) => set({ orientation })} options={(["auto", "portrait", "landscape"] as const).map((value) => ({ value, label: copy.orientations[value] }))} />
                        )}
                    </section>
                    <section className="flex flex-col gap-3">
                        <h3 className="text-sm font-semibold text-primary">{copy.layout}</h3>
                        {options.size !== "original" && (
                            <Segmented label={copy.fit} value={options.fit} onChange={(fit) => set({ fit })} options={(["contain", "cover", "original"] as const).map((value) => ({ value, label: copy.fits[value] }))} />
                        )}
                        <Segmented label={copy.margin} value={options.margin as (typeof MARGINS)[number]} onChange={(margin) => set({ margin })} options={MARGINS.map((value) => ({ value, label: copy.margins[value] }))} />
                    </section>
                    <section className="flex flex-col gap-3">
                        <h3 className="text-sm font-semibold text-primary">{copy.imageQuality}</h3>
                        <Range label={copy.quality} value={options.quality} min={40} max={100} onChange={(quality) => set({ quality })} format={(value) => `${value}%`} />
                        <Segmented
                            label={copy.resolution}
                            value={options.maxDpi ?? "none"}
                            onChange={(value) => set({ maxDpi: value === "none" ? null : value })}
                            options={RESOLUTIONS.map((value) => ({ value, label: copy.resolutions[value] }))}
                            scrollable
                        />
                        <p className="text-xs text-tertiary">{copy.resolutionHint}</p>
                    </section>
                </>
            }
        >
            <SortableCards
                items={entries}
                getId={(entry) => entry.id}
                onReorder={setEntries}
                onRemove={remove}
                label={copy.listLabel}
                name={(entry) => entry.file.name}
                meta={(entry) => `${entry.dimensions.width} × ${entry.dimensions.height} · ${formatBytes(entry.file.size)}`}
                actions={(entry) => (
                    <button
                        type="button"
                        onClick={() => rotate(entry)}
                        aria-label={copy.rotate(entry.file.name)}
                        title={copy.rotate(entry.file.name)}
                        className="grid size-8 cursor-pointer place-items-center rounded-lg border border-[var(--card-line)] bg-primary/95 text-secondary shadow-sm outline-focus-ring backdrop-blur hover:text-primary focus-visible:outline-2 pointer-coarse:size-9"
                    >
                        <RotateCw className="size-4" aria-hidden />
                    </button>
                )}
                thumbnail={(entry) => <PagePreview src={entry.url} alt={entry.file.name} placement={placeImage(sized(entry), options)} rotate={entry.rotate} />}
            />
        </DocumentToolLayout>
    );
}
