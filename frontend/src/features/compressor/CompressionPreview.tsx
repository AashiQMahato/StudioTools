import { type PointerEvent, useState } from "react";
import { CompareSlider } from "@/components/common/CompareSlider";
import { Segmented } from "@/components/common/Segmented";
import { ImageProcessingPreview } from "@/components/studio/ImageProcessingPreview";
import { Fitted } from "@/components/studio/StudioParts";
import { formatBytes, formatDimensions } from "@/features/image-processing/format";
import type { CompressSettings } from "@/lib/api/compressApi";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";
import { formatTarget } from "./settings";
import type { QueueItem } from "./useCompressionQueue";

export type PreviewMode = "original" | "compressed" | "split";
const ZOOMS = [1, 2, 4] as const;
const imageClass = "absolute inset-0 size-full object-contain";

/**
 * The selected image — original, compressed, or split down the middle — with 2× and 4× zoom that
 * follows the pointer, to look for compression artefacts where they'd show.
 */
export function CompressionPreview({ item, mode, onModeChange }: { item: QueueItem; mode: PreviewMode; onModeChange: (mode: PreviewMode) => void }) {
    const t = useT();
    const copy = t.compress;
    const result = item.result;
    const shown: PreviewMode = result ? mode : "original";
    const [split, setSplit] = useState(50);
    const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
    const [origin, setOrigin] = useState({ x: 50, y: 50 });
    const follow = (event: PointerEvent<HTMLDivElement>) => {
        if (zoom === 1) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setOrigin({ x: Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)), y: Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100)) });
    };
    // The divider sits at the edge for single views: the handle steps aside there on its own.
    const position = shown === "original" ? 100 : shown === "compressed" ? 0 : split;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center justify-center gap-2 px-3 pt-3">
                <Segmented
                    size="sm"
                    label={copy.viewLabel}
                    value={shown}
                    onChange={onModeChange}
                    options={(["original", "compressed", "split"] as const).map((value) => ({ value, label: copy.views[value], disabled: !result && value !== "original" }))}
                />
                <Segmented size="sm" label={t.workspace.zoom} value={zoom} onChange={setZoom} options={ZOOMS.map((level) => ({ value: level, label: level === 1 ? t.workspace.fit : `${level}×`, ariaLabel: level === 1 ? t.workspace.fitAria : t.workspace.zoomAria(level) }))} />
            </div>
            <Fitted dimensions={item.dimensions}>
                {(size) =>
                    // Being compressed: the shared processing effect (as in Remove Background).
                    item.status === "processing" ? (
                        <ImageProcessingPreview src={item.previewUrl} alt={`${copy.original}: ${item.name}`} size={size} status="processing" label={`${copy.status.processing}…`} />
                    ) : (
                    <div className={cn("relative", shown !== "split" && "[&_[role=slider]]:hidden")} style={size} onPointerMove={follow} onPointerDown={follow}>
                        <CompareSlider
                            value={position}
                            onChange={(value) => shown === "split" && setSplit(value)}
                            beforeLabel={copy.before}
                            afterLabel={copy.after}
                            className={cn("rounded-lg bg-checkerboard", shown !== "split" && "pointer-events-none")}
                            style={size}
                            zoom={zoom > 1 ? { scale: zoom, origin } : undefined}
                            before={<img src={item.previewUrl} alt={`${copy.original}: ${item.name}`} className={imageClass} draggable={false} />}
                            after={result ? <img src={result.url} alt={`${copy.compressed}: ${result.fileName}`} className={imageClass} draggable={false} /> : <span />}
                        />
                    </div>
                    )
                }
            </Fitted>
        </div>
    );
}

/** Sizes side by side as bars, what was saved, and anything worth knowing about how it was done. */
export function ResultSummary({ item, settings }: { item: QueueItem; settings: CompressSettings }) {
    const t = useT();
    const copy = t.compress;
    const result = item.result;
    if (!result) return null;
    const saved = result.originalSize - result.size;
    const percent = Math.round((saved / result.originalSize) * 100);
    const notes: { text: string; tone: "info" | "warn" }[] = [];
    if (result.alreadyOptimal) notes.push({ text: copy.alreadyOptimal, tone: "info" });
    else if (saved < 0) notes.push({ text: copy.biggerNote, tone: "warn" });
    if (result.targetMet === false && settings.target) notes.push({ text: copy.targetMissed(formatBytes(result.size), formatTarget(settings.target)), tone: "warn" });
    if (result.targetMet && settings.target) notes.push({ text: copy.targetMet(formatTarget(settings.target)), tone: "info" });
    if (result.resized && result.targetMet !== null) notes.push({ text: copy.resized(result.width, result.height), tone: "info" });
    if (result.flattened) notes.push({ text: copy.flattened, tone: "info" });

    const bar = (value: number, strong: boolean) => (
        <span className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
            <span className={cn("block h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out)]", strong ? "bg-[var(--brand)]" : "bg-quaternary")} style={{ width: `${Math.max(2, Math.min(100, (value / Math.max(result.originalSize, result.size)) * 100))}%` }} />
        </span>
    );

    return (
        <section aria-label={copy.completeTitle} className="retouch-fade-in rounded-xl border border-[var(--card-line)] bg-primary p-3 sm:p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-sm font-semibold text-primary">{copy.completeTitle}</h3>
                <p className={cn("text-sm font-semibold tabular-nums", saved > 0 ? "text-success-primary" : "text-tertiary")}>{saved > 0 ? copy.savedAmount(formatBytes(saved), percent) : `${copy.saved}: 0%`}</p>
            </div>
            <dl className="mt-3 grid gap-2 text-xs">
                <div className="flex items-center gap-3">
                    <dt className="w-24 shrink-0 text-tertiary">{copy.original}</dt>
                    {bar(result.originalSize, false)}
                    <dd className="w-16 shrink-0 text-right font-medium text-secondary tabular-nums">{formatBytes(result.originalSize)}</dd>
                </div>
                <div className="flex items-center gap-3">
                    <dt className="w-24 shrink-0 text-tertiary">{copy.compressed}</dt>
                    {bar(result.size, true)}
                    <dd className="w-16 shrink-0 text-right font-semibold text-primary tabular-nums">{formatBytes(result.size)}</dd>
                </div>
            </dl>
            <p className="mt-3 text-xs text-tertiary tabular-nums">
                {copy.dimensions}: {formatDimensions(result)} px · {copy.formatLabel}: {copy.formats[result.format]}
            </p>
            {notes.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                    {notes.map((note) => (
                        <li key={note.text} className={cn("text-xs", note.tone === "warn" ? "text-warning-primary" : "text-secondary")}>
                            {note.text}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
