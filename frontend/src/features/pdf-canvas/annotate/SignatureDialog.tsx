import { Eraser, ImageUp, Info, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Segmented } from "@/components/common/Segmented";
import { Range } from "@/features/background-removal/editor/RefinePanel";
import { Button } from "@/components/ui/base/buttons/button";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";
import { inkPixels } from "./recolour";

export interface SignatureImage {
    blob: Blob;
    width: number;
    height: number;
}

type Mode = "draw" | "type" | "upload";

const INKS = ["#111827", "#1d3a8a", "#0f5132"] as const;
/** Handwriting faces (Google Fonts, loaded only when this opens). Kalam also writes Devanagari. */
const FONTS = [
    { family: "Dancing Script", weight: 600 },
    { family: "Great Vibes", weight: 400 },
    { family: "Caveat", weight: 600 },
    { family: "Kalam", weight: 400 },
] as const;
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Caveat:wght@600&family=Dancing+Script:wght@600&family=Great+Vibes&family=Kalam&display=swap";

function loadSignatureFonts() {
    if (document.querySelector(`link[href="${FONT_CSS}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONT_CSS;
    document.head.append(link);
}

/** The part of a canvas with ink on it (plus a small margin), as a PNG. Null when it's blank. */
async function trimmed(canvas: HTMLCanvasElement): Promise<SignatureImage | null> {
    const context = canvas.getContext("2d");
    if (!context) return null;
    const { width, height } = canvas;
    const pixels = context.getImageData(0, 0, width, height).data;
    let top = height;
    let left = width;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (pixels[(y * width + x) * 4 + 3]! > 8) {
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
        }
    }
    if (right < 0) return null;
    const margin = 6;
    left = Math.max(0, left - margin);
    top = Math.max(0, top - margin);
    const cropWidth = Math.min(width, right + margin + 1) - left;
    const cropHeight = Math.min(height, bottom + margin + 1) - top;
    const out = document.createElement("canvas");
    out.width = cropWidth;
    out.height = cropHeight;
    out.getContext("2d")!.drawImage(canvas, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
    return blob ? { blob, width: cropWidth, height: cropHeight } : null;
}

/**
 * Making a signature: drawn with a finger, pen or mouse; typed in a handwriting font; or a photo or
 * scan of one, with the paper made transparent. It stays in this browser — it's placed on the PDF as
 * a picture when you save. It is not a certified digital signature, and says so.
 */
export function SignatureDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (signature: SignatureImage) => void }) {
    const t = useT();
    const copy = t.documents.sign.dialog;
    const dialog = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    const [mode, setMode] = useState<Mode>("draw");
    const [ink, setInk] = useState<string>(INKS[0]);
    const [ready, setReady] = useState(false);
    const make = useRef<() => Promise<SignatureImage | null>>(async () => null);
    const register = useCallback((fn: () => Promise<SignatureImage | null>) => {
        make.current = fn;
    }, []);

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        if (open && !element.open) {
            loadSignatureFonts();
            element.showModal();
        } else if (!open && element.open) element.close();
    }, [open]);

    const use = async () => {
        const signature = await make.current();
        if (signature) onCreate(signature);
    };

    return (
        <dialog
            ref={dialog}
            aria-labelledby={titleId}
            onClose={onClose}
            onClick={(event) => event.target === dialog.current && onClose()}
            className="m-auto w-[min(40rem,calc(100vw-1.5rem))] rounded-2xl border border-[var(--card-line)] bg-primary p-0 text-primary shadow-2xl backdrop:bg-neutral-950/45"
        >
            {open && (
                <div className="flex flex-col gap-4 p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-3">
                        <h2 id={titleId} className="text-md font-semibold text-primary">
                            {copy.title}
                        </h2>
                        <button type="button" onClick={onClose} aria-label={copy.close} className="grid size-9 cursor-pointer place-items-center rounded-lg text-tertiary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2">
                            <X className="size-4" aria-hidden />
                        </button>
                    </div>
                    <Segmented label={copy.mode} value={mode} onChange={(value) => { setMode(value); setReady(false); }} options={(["draw", "type", "upload"] as const).map((value) => ({ value, label: copy.modes[value] }))} />
                    {mode !== "upload" && (
                        <div role="radiogroup" aria-label={copy.ink} className="flex items-center gap-2">
                            <span className="text-xs font-medium text-secondary">{copy.ink}</span>
                            {INKS.map((colour, index) => (
                                <button
                                    key={colour}
                                    type="button"
                                    role="radio"
                                    aria-checked={ink === colour}
                                    aria-label={copy.inks[index]}
                                    onClick={() => setInk(colour)}
                                    className={cn("size-7 cursor-pointer rounded-full border-2 outline-focus-ring focus-visible:outline-2", ink === colour ? "border-[var(--brand)]" : "border-transparent")}
                                >
                                    <span className="m-auto block size-5 rounded-full" style={{ background: colour }} />
                                </button>
                            ))}
                        </div>
                    )}
                    {mode === "draw" && <DrawPad ink={ink} register={register} onReady={setReady} />}
                    {mode === "type" && <TypePad ink={ink} register={register} onReady={setReady} />}
                    {mode === "upload" && <UploadPad register={register} onReady={setReady} />}
                    <p className="flex gap-2 rounded-xl border border-[var(--card-line)] bg-secondary px-3 py-2.5 text-xs leading-relaxed text-secondary">
                        <Info className="mt-0.5 size-3.5 shrink-0 text-tertiary" aria-hidden />
                        {t.documents.sign.disclaimer}
                    </p>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button size="md" color="secondary" onPress={onClose}>
                            {copy.cancel}
                        </Button>
                        <Button size="md" color="primary" onPress={() => void use()} isDisabled={!ready}>
                            {copy.use}
                        </Button>
                    </div>
                </div>
            )}
        </dialog>
    );
}

type PadProps = { register: (make: () => Promise<SignatureImage | null>) => void; onReady: (ready: boolean) => void };

/** Drawing: smooth strokes at the screen's density, on a transparent canvas. */
function DrawPad({ ink, register, onReady }: PadProps & { ink: string }) {
    const copy = useT().documents.sign.dialog;
    const canvas = useRef<HTMLCanvasElement>(null);
    const strokes = useRef<{ colour: string; points: [number, number][] }[]>([]);
    const [empty, setEmpty] = useState(true);

    const paint = useCallback(() => {
        const element = canvas.current;
        const context = element?.getContext("2d");
        if (!element || !context) return;
        const ratio = element.width / element.clientWidth;
        context.clearRect(0, 0, element.width, element.height);
        context.lineCap = "round";
        context.lineJoin = "round";
        for (const stroke of strokes.current) {
            context.strokeStyle = stroke.colour;
            context.lineWidth = 2.6 * ratio;
            context.beginPath();
            const [first, ...rest] = stroke.points;
            if (!first) continue;
            context.moveTo(first[0] * ratio, first[1] * ratio);
            if (!rest.length) context.lineTo(first[0] * ratio + 0.1, first[1] * ratio + 0.1);
            // Through the midpoints: smooth curves rather than a polyline.
            rest.forEach((point, index) => {
                const next = rest[index + 1];
                if (next) context.quadraticCurveTo(point[0] * ratio, point[1] * ratio, ((point[0] + next[0]) / 2) * ratio, ((point[1] + next[1]) / 2) * ratio);
                else context.lineTo(point[0] * ratio, point[1] * ratio);
            });
            context.stroke();
        }
    }, []);

    useEffect(() => {
        const element = canvas.current;
        if (!element) return;
        const size = () => {
            element.width = Math.round(element.clientWidth * 3);
            element.height = Math.round(element.clientHeight * 3);
            paint();
        };
        size();
        const observer = new ResizeObserver(size);
        observer.observe(element);
        return () => observer.disconnect();
    }, [paint]);

    // A new ink colour recolours the signature (it's one signature, in one ink).
    useEffect(() => {
        strokes.current = strokes.current.map((stroke) => ({ ...stroke, colour: ink }));
        paint();
    }, [ink, paint]);

    useEffect(() => {
        register(() => trimmed(canvas.current!));
        onReady(!empty);
    }, [register, onReady, empty]);

    const point = (event: React.PointerEvent): [number, number] => {
        const rect = canvas.current!.getBoundingClientRect();
        return [event.clientX - rect.left, event.clientY - rect.top];
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="relative">
                <canvas
                    ref={canvas}
                    aria-label={copy.drawLabel}
                    className="block h-44 w-full cursor-crosshair touch-none rounded-xl border border-dashed border-[var(--card-line)] bg-white sm:h-52"
                    onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        strokes.current.push({ colour: ink, points: [point(event)] });
                        paint();
                    }}
                    onPointerMove={(event) => {
                        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                        strokes.current[strokes.current.length - 1]?.points.push(point(event));
                        paint();
                    }}
                    onPointerUp={() => setEmpty(strokes.current.length === 0)}
                />
                <span aria-hidden className="pointer-events-none absolute inset-x-6 bottom-10 border-b border-neutral-300" />
                {empty && <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-neutral-400">{copy.drawHint}</span>}
            </div>
            <Button
                size="sm"
                color="tertiary"
                iconLeading={Eraser}
                onPress={() => {
                    strokes.current = [];
                    paint();
                    setEmpty(true);
                }}
                isDisabled={empty}
                className="self-start"
            >
                {copy.clear}
            </Button>
        </div>
    );
}

/** Typing a name, set in a handwriting face. */
function TypePad({ ink, register, onReady }: PadProps & { ink: string }) {
    const copy = useT().documents.sign.dialog;
    const [name, setName] = useState("");
    const [font, setFont] = useState(0);
    const inputId = useId();

    useEffect(() => {
        register(async () => {
            const face = FONTS[font]!;
            const size = 120;
            await document.fonts.load(`${face.weight} ${size}px "${face.family}"`, name).catch(() => undefined);
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d")!;
            context.font = `${face.weight} ${size}px "${face.family}", "Noto Serif Devanagari", cursive`;
            const width = Math.ceil(context.measureText(name).width + size);
            canvas.width = Math.min(4000, width);
            canvas.height = Math.round(size * 1.8);
            context.font = `${face.weight} ${size}px "${face.family}", "Noto Serif Devanagari", cursive`;
            context.fillStyle = ink;
            context.textBaseline = "middle";
            context.fillText(name, size / 2, canvas.height / 2);
            return trimmed(canvas);
        });
        onReady(name.trim().length > 0);
    }, [register, onReady, name, font, ink]);

    return (
        <div className="flex flex-col gap-3">
            <label htmlFor={inputId} className="text-sm font-medium text-secondary">
                {copy.name}
            </label>
            <input
                id={inputId}
                value={name}
                maxLength={60}
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
                placeholder={copy.namePlaceholder}
                className="h-10 rounded-lg border border-[var(--card-line)] bg-primary px-3 text-sm text-primary outline-focus-ring placeholder:text-quaternary focus-visible:outline-2 pointer-coarse:h-11"
            />
            <div role="radiogroup" aria-label={copy.style} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {FONTS.map((face, index) => (
                    <button
                        key={face.family}
                        type="button"
                        role="radio"
                        aria-checked={font === index}
                        aria-label={`${copy.style} ${index + 1}`}
                        onClick={() => setFont(index)}
                        className={cn("flex h-16 cursor-pointer items-center justify-center overflow-hidden rounded-xl border bg-white px-3 text-[1.75rem] outline-focus-ring focus-visible:outline-2", font === index ? "border-[var(--brand)] ring-2 ring-[var(--brand)]/25" : "border-[var(--card-line)]")}
                        style={{ fontFamily: `"${face.family}", "Noto Serif Devanagari", cursive`, fontWeight: face.weight, color: ink }}
                    >
                        <span className="truncate">{name.trim() || copy.namePlaceholder}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

/** A photo or scan of a signature; the paper (anything near-white) made transparent, if wanted. */
function UploadPad({ register, onReady }: PadProps) {
    const copy = useT().documents.sign.dialog;
    const picker = useRef<HTMLInputElement>(null);
    const [image, setImage] = useState<ImageBitmap | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [clean, setClean] = useState(true);
    const [threshold, setThreshold] = useState(70);
    // Null keeps the photo's own colours.
    const [ink, setInk] = useState<string | null>(null);
    const preview = useRef<HTMLCanvasElement>(null);

    // The result, redrawn as the settings change: what you see is what's placed.
    useEffect(() => {
        const canvas = preview.current;
        if (!canvas || !image) return;
        const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        if (clean) {
            const data = context.getImageData(0, 0, canvas.width, canvas.height);
            const pixels = data.data;
            // Paper-light pixels go transparent; between ink and paper they fade, so the ink's edges stay soft.
            const low = 255 - threshold;
            const high = 255 - threshold * 0.25;
            for (let index = 0; index < pixels.length; index += 4) {
                const light = 0.299 * pixels[index]! + 0.587 * pixels[index + 1]! + 0.114 * pixels[index + 2]!;
                if (light > low) pixels[index + 3] = Math.round(pixels[index + 3]! * Math.max(0, (high - light) / (high - low)));
            }
            // Recoloured once the paper is gone (with the paper, the whole picture would take the ink).
            if (ink) inkPixels(pixels, ink);
            context.putImageData(data, 0, 0);
        }
    }, [image, clean, threshold, ink]);

    useEffect(() => {
        register(async () => (preview.current ? trimmed(preview.current) : null));
        onReady(Boolean(image));
    }, [register, onReady, image]);

    const choose = async (file: File | undefined) => {
        if (!file) return;
        if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) return setProblem(copy.uploadProblem);
        try {
            setImage(await createImageBitmap(file));
            setProblem(null);
        } catch {
            setProblem(copy.uploadProblem);
        }
    };

    return (
        <div className="flex flex-col gap-3">
            <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void choose(event.target.files?.[0]).finally(() => (event.target.value = ""))} />
            <div className="grid h-44 place-items-center overflow-hidden rounded-xl border border-dashed border-[var(--card-line)] bg-[conic-gradient(#e5e7eb_25%,#fff_0_50%,#e5e7eb_0_75%,#fff_0)] bg-[length:16px_16px] sm:h-52">
                {image ? <canvas ref={preview} aria-label={copy.uploadPreview} className="max-h-full max-w-full object-contain" /> : <span className="text-sm text-neutral-500">{copy.uploadHint}</span>}
            </div>
            {problem && (
                <p role="alert" className="text-xs text-error-primary">
                    {problem}
                </p>
            )}
            <Button size="sm" color="secondary" iconLeading={ImageUp} onPress={() => picker.current?.click()} className="self-start">
                {image ? copy.changeImage : copy.chooseImage}
            </Button>
            {image && (
                <>
                    <label className="flex cursor-pointer items-start gap-2.5 text-sm text-secondary">
                        <input type="checkbox" checked={clean} onChange={(event) => setClean(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" />
                        <span>{copy.removePaper}</span>
                    </label>
                    {clean && <Range label={copy.strength} value={threshold} min={20} max={140} onChange={setThreshold} format={(value) => `${Math.round(((value - 20) / 120) * 100)}%`} />}
                    {clean && (
                        <div role="radiogroup" aria-label={copy.ink} className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-secondary">{copy.ink}</span>
                            <button type="button" role="radio" aria-checked={ink === null} onClick={() => setInk(null)} className={cn("h-7 cursor-pointer rounded-full border px-2.5 text-xs font-medium outline-focus-ring focus-visible:outline-2", ink === null ? "border-[var(--brand)] text-[var(--brand)]" : "border-[var(--card-line)] text-secondary hover:bg-primary_hover")}>
                                {copy.original}
                            </button>
                            {INKS.map((colour, index) => (
                                <button key={colour} type="button" role="radio" aria-checked={ink === colour} aria-label={copy.inks[index]} onClick={() => setInk(colour)} className={cn("size-7 cursor-pointer rounded-full border-2 outline-focus-ring focus-visible:outline-2", ink === colour ? "border-[var(--brand)]" : "border-transparent")}>
                                    <span className="m-auto block size-5 rounded-full" style={{ background: colour }} />
                                </button>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
