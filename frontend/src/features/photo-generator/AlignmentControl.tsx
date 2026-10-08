import { CheckCircle2, LoaderCircle, RotateCcw, RotateCw, Undo2 } from "lucide-react";
import { useState } from "react";
import { type GeneratedPhoto, rotatePhoto } from "@/lib/api/photoGeneratorApi";
import { useT } from "@/i18n";
import { formatAngle } from "./ProcessingView";

const STEP = 0.5;

/**
 * The head's straightening, shown and fine-tunable: the automatic angle, then ±0.5° steps and Reset.
 * Each change makes the photo again from the kept cut-out of the unturned photo (one turn, no second
 * background removal).
 */
export function AlignmentControl({ result, onRotated }: { result: GeneratedPhoto; onRotated: (photo: Omit<GeneratedPhoto, "source">) => void }) {
    const copy = useT().photo.alignment;
    const { angle, autoAngle, maxAngle, sourceId } = result.alignment;
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    const apply = async (next: number) => {
        const clamped = Math.max(-maxAngle, Math.min(maxAngle, Math.round(next * 10) / 10));
        if (clamped === angle || busy) return;
        setBusy(true);
        setFailed(false);
        try {
            onRotated(await rotatePhoto(sourceId, clamped));
        } catch {
            setFailed(true);
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="flex flex-col gap-2.5" aria-busy={busy}>
            <h3 className="text-sm font-semibold text-primary">{copy.title}</h3>
            <p className="flex items-start gap-2 text-sm text-secondary">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-primary" aria-hidden />
                <span>
                    <span className="font-medium text-primary">{copy.aligned}</span> · {autoAngle === 0 ? copy.already : copy.turned(formatAngle(autoAngle))}
                </span>
            </p>
            <div className="flex items-center gap-2">
                <button type="button" onClick={() => void apply(angle - STEP)} disabled={busy || angle - STEP < -maxAngle} aria-label={copy.rotateLeft} title={copy.rotateLeft} className="grid size-10 cursor-pointer place-items-center rounded-full border border-[var(--card-line)] text-secondary outline-focus-ring transition-colors hover:bg-primary_hover focus-visible:outline-2 disabled:cursor-default disabled:opacity-40">
                    <RotateCcw className="size-4" aria-hidden />
                </button>
                <output aria-live="polite" aria-label={copy.angle} className="min-w-16 text-center text-sm font-semibold text-primary tabular-nums">
                    {busy ? <LoaderCircle className="mx-auto size-4 animate-spin motion-reduce:animate-none" aria-label={copy.applying} /> : `${formatAngle(angle)}°`}
                </output>
                <button type="button" onClick={() => void apply(angle + STEP)} disabled={busy || angle + STEP > maxAngle} aria-label={copy.rotateRight} title={copy.rotateRight} className="grid size-10 cursor-pointer place-items-center rounded-full border border-[var(--card-line)] text-secondary outline-focus-ring transition-colors hover:bg-primary_hover focus-visible:outline-2 disabled:cursor-default disabled:opacity-40">
                    <RotateCw className="size-4" aria-hidden />
                </button>
                <button type="button" onClick={() => void apply(autoAngle)} disabled={busy || angle === autoAngle} className="ml-auto flex h-10 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm font-medium text-secondary outline-focus-ring transition-colors hover:bg-primary_hover focus-visible:outline-2 disabled:cursor-default disabled:opacity-40">
                    <Undo2 className="size-4" aria-hidden />
                    {copy.reset}
                </button>
            </div>
            {failed && (
                <p role="alert" className="text-sm text-error-primary">
                    {copy.failed}
                </p>
            )}
        </section>
    );
}
