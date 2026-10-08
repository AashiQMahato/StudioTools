import { X } from "lucide-react";
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";

export type PreviewStatus = "processing" | "finishing";

interface ImageProcessingPreviewProps {
    src: string;
    alt: string;
    /** The fitted on-screen size of the image. */
    size: { width: number; height: number };
    /** "finishing": the result is in — the effect dissolves before the result takes over. */
    status: PreviewStatus;
    /** What the server is doing, e.g. "Removing background…". Left out where the tool lists its own steps: no status pill then. */
    label?: string;
    /** Real upload progress (0–1) while the file is still being sent. */
    uploading?: boolean;
    uploadProgress?: number;
    /** When the job started, for the elapsed-seconds hint on slow runs. */
    startedAt?: number | null;
    onCancel?: () => void;
    className?: string;
    /** Laid over the effect: a tool's own marks (e.g. the photo generator's crop frame, a stage caption). */
    children?: ReactNode;
}

/** One wave of light every this many seconds, rolling diagonally across the dot matrix. */
const WAVE_PERIOD = 2.6;

/**
 * While the server works, the photo becomes a living dot matrix of itself: it sits softly out of
 * focus, a fine grid of dots — each coloured from the photo underneath — pulses as a wave of light
 * rolls across. Hover (or touch) and the dots around the pointer swell and brighten, following you.
 *
 * Purely a visual: no pixels are changed and nothing here reports progress it doesn't have — the pill
 * shows the real upload percentage, then honest elapsed time. Drawn on a canvas at display rate; holds
 * still (only the pointer glow responds) for people who prefer reduced motion.
 */
export function ImageProcessingPreview({ src, alt, size, status, label, uploading = false, uploadProgress = 0, startedAt = null, onCancel, className, children }: ImageProcessingPreviewProps) {
    const t = useT();
    const reduced = usePrefersReducedMotion();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    /** Pointer position in CSS px over the image, or null when it isn't there. */
    const pointer = useRef<{ x: number; y: number } | null>(null);
    /** Redraws one frame on demand — used when motion is reduced and nothing runs continuously. */
    const redraw = useRef<(() => void) | null>(null);
    const finishing = status === "finishing";

    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        if (!startedAt) return;
        const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
        tick();
        const timer = window.setInterval(tick, 1000);
        return () => window.clearInterval(timer);
    }, [startedAt]);

    // The dot matrix, drawn each frame.
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx || !size.width) return;
        const { width, height } = size;
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

        const spacing = Math.max(7, Math.min(12, width / 72));
        const cols = Math.floor(width / spacing);
        const rows = Math.floor(height / spacing);
        const offsetX = (width - cols * spacing) / 2 + spacing / 2;
        const offsetY = (height - rows * spacing) / 2 + spacing / 2;
        const reach = Math.min(width, height) * 0.22;
        let colours: Uint8ClampedArray | null = null;
        let frame = 0;
        let cancelled = false;
        /** Where the pointer's glow is, easing after the pointer so it glides rather than jumps. */
        const glow = { x: -1e4, y: -1e4 };
        const started = performance.now();

        // Sample the photo once, one pixel per dot, so every dot wears the colour beneath it.
        const image = new Image();
        image.decoding = "async";
        image.src = src;
        image
            .decode()
            .then(() => {
                if (cancelled) return;
                const sampler = document.createElement("canvas");
                sampler.width = cols;
                sampler.height = rows;
                const sctx = sampler.getContext("2d", { willReadFrequently: true });
                if (!sctx) return;
                sctx.drawImage(image, 0, 0, cols, rows);
                colours = sctx.getImageData(0, 0, cols, rows).data;
                if (reduced) draw(0);
            })
            .catch(() => undefined);

        const draw = (seconds: number) => {
            ctx.clearRect(0, 0, width, height);
            if (!colours) return;

            // Dots near the pointer swell and brighten; the glow eases after it.
            const target = pointer.current;
            if (target) {
                const follow = reduced || glow.x < -1e3 ? 1 : 0.25;
                glow.x += (target.x - glow.x) * follow;
                glow.y += (target.y - glow.y) * follow;
            }
            const glowOn = Boolean(target);
            const front = reduced ? -1 : ((seconds / WAVE_PERIOD) % 1) * 1.5 - 0.25;

            for (let row = 0; row < rows; row++) {
                const y = offsetY + row * spacing;
                for (let col = 0; col < cols; col++) {
                    const x = offsetX + col * spacing;
                    // Where this dot sits along the wave's diagonal (0 top-left → 1 bottom-right).
                    const along = (x / width) * 0.62 + (y / height) * 0.38;
                    const wave = Math.exp(-(((along - front) / 0.07) ** 2));
                    const near = glowOn ? Math.max(0, 1 - Math.hypot(x - glow.x, y - glow.y) / reach) : 0;
                    const energy = Math.max(wave, near * 0.85);
                    const i = (row * cols + col) * 4;
                    const lift = energy * 0.55;
                    const r = colours[i]! + (255 - colours[i]!) * lift;
                    const g = colours[i + 1]! + (255 - colours[i + 1]!) * lift;
                    const b = colours[i + 2]! + (255 - colours[i + 2]!) * lift;
                    ctx.globalAlpha = 0.5 + energy * 0.5;
                    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
                    ctx.beginPath();
                    ctx.arc(x, y, spacing * (0.2 + energy * 0.2), 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.globalAlpha = 1;
        };

        const loop = (now: number) => {
            if (cancelled) return;
            draw((now - started) / 1000);
            frame = requestAnimationFrame(loop);
        };
        if (!reduced) frame = requestAnimationFrame(loop);
        redraw.current = () => draw(0);
        return () => {
            cancelled = true;
            cancelAnimationFrame(frame);
            redraw.current = null;
        };
    }, [src, size, reduced]);

    const track = (event: PointerEvent<HTMLElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        pointer.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        if (reduced) redraw.current?.();
    };

    const percent = Math.round(uploadProgress * 100);
    const circumference = 2 * Math.PI * 7;

    return (
        <figure
            className={cn("animate-enter relative touch-none overflow-hidden rounded-lg bg-neutral-950 [--i:-1]", className)}
            style={size}
            aria-busy={!finishing}
            onPointerMove={track}
            onPointerDown={track}
            onPointerLeave={() => {
                pointer.current = null;
                if (reduced) redraw.current?.();
            }}
            onPointerCancel={() => (pointer.current = null)}
        >
            {/* The photo, softly out of focus while it's being worked on; it sharpens back as the result arrives. */}
            <img src={src} alt={alt} className={cn("ipp-base size-full object-contain", finishing && "ipp-base-sharp")} draggable={false} />

            <div aria-hidden className={cn("ipp-layer absolute inset-0", finishing && "ipp-layer-out")}>
                <canvas ref={canvasRef} className="absolute inset-0 size-full" />
                {/* Focus corners, gently breathing, like a camera locking on. */}
                <span className="ipp-corners absolute inset-3">
                    <span className="absolute top-0 left-0 size-5 rounded-tl-md border-t-2 border-l-2 border-white/85" />
                    <span className="absolute top-0 right-0 size-5 rounded-tr-md border-t-2 border-r-2 border-white/85" />
                    <span className="absolute bottom-0 left-0 size-5 rounded-bl-md border-b-2 border-l-2 border-white/85" />
                    <span className="absolute right-0 bottom-0 size-5 rounded-br-md border-r-2 border-b-2 border-white/85" />
                </span>
            </div>

            {children}

            {/* Status: a ring that fills with the real upload, then spins while the server works. */}
            {(label !== undefined || uploading) && (
                <figcaption
                    role="status"
                    className={cn(
                        "absolute bottom-4 left-1/2 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2.5 rounded-full border border-white/15 bg-neutral-950/70 py-1.5 pr-1.5 pl-2 text-xs font-medium text-white shadow-lg backdrop-blur-md transition-[opacity,translate] duration-300",
                        !onCancel && "pr-3.5",
                        finishing && "translate-y-2 opacity-0",
                    )}
                >
                    <svg viewBox="0 0 18 18" className={cn("size-[1.125rem] shrink-0 -rotate-90", !uploading && "animate-spin motion-reduce:animate-none")} aria-hidden>
                        <circle cx="9" cy="9" r="7" fill="none" stroke="rgb(255 255 255 / 0.2)" strokeWidth="2" />
                        <circle
                            cx="9"
                            cy="9"
                            r="7"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeDasharray={circumference}
                            strokeDashoffset={uploading ? circumference * (1 - Math.max(0.04, uploadProgress)) : circumference * 0.72}
                            className="transition-[stroke-dashoffset] duration-200"
                        />
                    </svg>
                    <span className="truncate">{uploading ? t.workspace.uploading(percent) : label}</span>
                    {!uploading && elapsed >= 3 && <span className="shrink-0 text-white/55 tabular-nums">{elapsed}s</span>}
                    {onCancel && (
                        <button
                            type="button"
                            onClick={onCancel}
                            onPointerDown={(event) => event.stopPropagation()}
                            aria-label={t.common.cancel}
                            className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-white/70 outline-white hover:bg-white/15 hover:text-white focus-visible:outline-2 pointer-coarse:size-9"
                        >
                            <X className="size-3.5" aria-hidden />
                        </button>
                    )}
                </figcaption>
            )}
        </figure>
    );
}

/**
 * True once `done` has held for `ms` — lets the processing effect dissolve before the result
 * replaces it, instead of the picture snapping from one to the other.
 */
export function useSettled(done: boolean, ms = 450) {
    const [settled, setSettled] = useState(false);
    useEffect(() => {
        if (!done) return;
        const timer = window.setTimeout(() => setSettled(true), ms);
        return () => {
            window.clearTimeout(timer);
            setSettled(false);
        };
    }, [done, ms]);
    return done && settled;
}
