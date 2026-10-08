import { Check, CircleAlert, LoaderCircle, Minus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Fitted } from "@/components/studio/StudioParts";
import { apiUrl, type Rect, type StepId, type WarningCode } from "@/lib/api/photoGeneratorApi";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";
import { type Preview, STEPS, type StepState } from "./usePhotoJob";

interface ProcessingViewProps {
    steps: Record<StepId, StepState>;
    previews: Partial<Record<"original" | "cutout" | "white", Preview>>;
    crop: Rect | null;
    warnings: WarningCode[];
    startedAt: number | null;
    /** The format the photo was converted from on upload (e.g. "HEIC"), if any. */
    convertedFrom?: string;
    onCancel: () => void;
}

/**
 * The work as it happens: the photo moves through its stages (original, background removed, white
 * background), the crop frame settles over it, and each step is ticked off when the server reports
 * it — nothing here is timed or simulated.
 */
export function ProcessingView({ steps, previews, crop, warnings, startedAt, convertedFrom, onCancel }: ProcessingViewProps) {
    const t = useT();
    const copy = t.photo;
    const stage = previews.white ? "white" : previews.cutout ? "cutout" : previews.original ? "original" : null;
    const base = previews.original;
    const active = STEPS.find((step) => steps[step].status === "active");
    const scanning = active === "face" || active === "background" || (active === "resolution" && Boolean(steps.resolution.detail?.upscaling));

    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        if (!startedAt) return;
        const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
        const timer = window.setInterval(tick, 1000);
        return () => window.clearInterval(timer);
    }, [startedAt]);

    return (
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(12rem,1fr)_auto] gap-2 lg:grid-cols-[minmax(0,1fr)_19rem] lg:grid-rows-1">
            <div className="relative flex min-h-0">
                {base ? (
                    <Fitted dimensions={base}>
                        {(size) => (
                            <figure className="relative overflow-hidden rounded-lg shadow-sm" style={size}>
                                {(["original", "cutout", "white"] as const).map((key) => {
                                    const preview = previews[key];
                                    if (!preview) return null;
                                    return (
                                        <img
                                            key={key}
                                            src={apiUrl(preview.url)}
                                            alt={copy.stages[key]}
                                            aria-hidden={key !== stage}
                                            className={cn("absolute inset-0 size-full transition-opacity duration-700 ease-[var(--ease-out)]", key === "cutout" && "bg-checkerboard", key === stage ? "opacity-100" : "opacity-0")}
                                            draggable={false}
                                        />
                                    );
                                })}
                                {crop && <CropFrame rect={crop} />}
                                {scanning && <span aria-hidden className="pg-scan pointer-events-none absolute inset-y-0 w-24 -translate-x-1/2" />}
                                {stage && (
                                    <figcaption className="absolute top-3 left-3 rounded-full bg-neutral-950/55 px-3 py-1 text-xs font-medium text-white backdrop-blur-md">{copy.stages[stage]}</figcaption>
                                )}
                            </figure>
                        )}
                    </Fitted>
                ) : (
                    <div className="flex flex-1 items-center justify-center">
                        <LoaderCircle className="size-6 animate-spin text-tertiary motion-reduce:animate-none" aria-hidden />
                    </div>
                )}
            </div>

            <section aria-live="polite" className="flex min-h-0 flex-col rounded-xl border border-[var(--card-line)] bg-primary p-3 sm:p-4 lg:my-6 lg:mr-2 lg:self-center">
                <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-primary">{copy.preparing}</h3>
                    <span className="flex items-center gap-1">
                        {elapsed >= 3 && <span className="text-xs text-quaternary tabular-nums">{elapsed}s</span>}
                        <button type="button" onClick={onCancel} aria-label={t.common.cancel} title={t.common.cancel} className="grid size-8 cursor-pointer place-items-center rounded-lg text-tertiary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 pointer-coarse:size-10">
                            <X className="size-4" aria-hidden />
                        </button>
                    </span>
                </div>
                <ol className="mt-2 flex flex-col gap-0.5 overflow-y-auto">
                    {STEPS.map((step) => (
                        <StepRow key={step} step={step} state={steps[step]} convertedFrom={convertedFrom} />
                    ))}
                </ol>
                {warnings.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-1.5 border-t border-[var(--card-line)] pt-3">
                        {warnings.map((code) => (
                            <li key={code} className="retouch-fade-in flex gap-2 text-xs text-secondary">
                                <CircleAlert className="mt-px size-3.5 shrink-0 text-warning-primary" aria-hidden />
                                {code === "LOW_RESOLUTION" ? copy.lowResLive : copy.warnings[code]}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

/** "6.8", "−3.2" — degrees as people read them. */
export const formatAngle = (degrees: number) => `${degrees < 0 ? "−" : ""}${Math.abs(degrees).toFixed(1)}`;

function StepRow({ step, state, convertedFrom }: { step: StepId; state: StepState; convertedFrom?: string }) {
    const t = useT();
    const labels = t.photo.steps;
    const { status, detail } = state;
    const label = (() => {
        switch (step) {
            case "format": {
                const from = detail?.converted ? detail.format?.toUpperCase() : convertedFrom;
                return status === "done" ? (from ? labels.format.converted(from === "HEIF" ? "HEIC" : from) : labels.format.done) : labels.format.active;
            }
            case "orientation":
                return status === "done" ? (detail?.corrected ? labels.orientation.corrected : labels.orientation.done) : labels.orientation.active;
            case "align":
                if (status === "skipped") return labels.align.skipped;
                return status === "done" ? `${labels.align.done} · ${labels.align.angle(formatAngle(detail?.angle ?? 0))}` : labels.align.active;
            case "resolution":
                if (status === "skipped") return labels.resolution.sharp;
                if (status === "done") return detail?.upscaled === "resample" ? labels.resolution.enlarged : labels.resolution.enhanced;
                return detail?.upscaling ? labels.resolution.upscaling : labels.resolution.active;
            default: {
                const text = labels[step];
                return status === "done" ? text.done : text.active;
            }
        }
    })();
    return (
        <li className={cn("flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-sm transition-colors duration-300", status === "active" && "bg-[var(--brand-soft)]")}>
            <span className="grid size-5 shrink-0 place-items-center">
                {status === "done" ? (
                    <span className="retouch-fade-in grid size-5 place-items-center rounded-full bg-success-solid text-white">
                        <Check className="size-3" strokeWidth={3} aria-hidden />
                    </span>
                ) : status === "skipped" ? (
                    <span className="retouch-fade-in grid size-5 place-items-center rounded-full bg-secondary text-tertiary">
                        <Minus className="size-3" strokeWidth={3} aria-hidden />
                    </span>
                ) : status === "active" ? (
                    <LoaderCircle className="size-4 animate-spin text-[var(--brand)] motion-reduce:animate-none" aria-hidden />
                ) : (
                    <span className="size-2 rounded-full bg-[var(--card-line)] ring-4 ring-transparent" aria-hidden />
                )}
            </span>
            <span className={cn(status === "pending" ? "text-quaternary" : status === "active" ? "font-medium text-primary" : "text-secondary")}>{label}</span>
        </li>
    );
}

/** The chosen crop, drawn from the whole image inward so you can see it being found. */
function CropFrame({ rect }: { rect: Rect }) {
    const [shown, setShown] = useState<Rect>({ x: 0, y: 0, width: 1, height: 1 });
    useEffect(() => {
        const frame = requestAnimationFrame(() => setShown(rect));
        return () => cancelAnimationFrame(frame);
    }, [rect]);
    return (
        <span
            aria-hidden
            className="pointer-events-none absolute rounded-[2px] border-2 border-white shadow-[0_0_0_9999px_rgb(9_9_11/0.45)] transition-[left,top,width,height] duration-700 ease-[var(--ease-out)] motion-reduce:transition-none"
            style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.width * 100}%`, height: `${shown.height * 100}%` }}
        />
    );
}
