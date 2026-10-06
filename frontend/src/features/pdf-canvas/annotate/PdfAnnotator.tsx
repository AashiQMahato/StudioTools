import {
    ArrowUpRight,
    Baseline,
    CalendarDays,
    Circle,
    Highlighter,
    ImagePlus,
    Minus,
    MousePointer2,
    PenLine,
    Redo2,
    RotateCcw,
    Signature,
    Square,
    Strikethrough,
    Trash2,
    Type,
    Undo2,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { type ReactNode, useRef } from "react";
import { Range } from "@/features/background-removal/editor/RefinePanel";
import { ColourPicker } from "@/features/documents/StampPreview";
import { Button } from "@/components/ui/base/buttons/button";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";
import { PdfPage } from "../PdfPage";
import type { usePageScroller } from "../usePageScroller";
import type { useZoom } from "../useZoom";
import { PageNav, Toolbar, ToolbarButton, ToolbarDivider, ZoomControl } from "../ViewerControls";
import { AnnotationLayer } from "./AnnotationLayer";
import { type Annotation, type ImageAnnotation, refit, type Tool } from "./model";
import { recolourPicture } from "./recolour";
import { EDIT_TOOLS, MARKUP, SIGN_TOOLS, TOOL_KEYS } from "./tools";
import type { Annotator } from "./useAnnotator";

export type AnnotatorMode = "edit" | "sign";

const ICONS: Record<Tool, typeof Type> = { select: MousePointer2, text: Type, draw: PenLine, highlight: Highlighter, underline: Baseline, strike: Strikethrough, rect: Square, ellipse: Circle, line: Minus, arrow: ArrowUpRight, image: ImagePlus, signature: Signature, date: CalendarDays };
const keyOf = (tool: Tool) => Object.entries(TOOL_KEYS).find(([, value]) => value === tool)?.[0]?.toUpperCase();


interface ToolbarProps {
    annotator: Annotator;
    mode: AnnotatorMode;
    zoom: ReturnType<typeof useZoom>;
    current: number;
    count: number;
    onGo: (page: number) => void;
    /** Image and Signature don't draw on the page: they open a picker or the signature maker. */
    onImage: () => void;
    onSignature: () => void;
}

export function AnnotatorToolbar({ annotator, mode, zoom, current, count, onGo, onImage, onSignature }: ToolbarProps) {
    const t = useT();
    const copy = t.documents.editor;
    const tools = mode === "sign" ? SIGN_TOOLS : EDIT_TOOLS;
    return (
        <Toolbar label={copy.toolbar}>
            <ToolbarButton icon={Undo2} label={copy.undo} onClick={annotator.undo} disabled={!annotator.canUndo} shortcut="Control+Z" />
            <ToolbarButton icon={Redo2} label={copy.redo} onClick={annotator.redo} disabled={!annotator.canRedo} shortcut="Control+Shift+Z" />
            <ToolbarDivider />
            {tools.map((tool) => (
                <ToolbarButton
                    key={tool}
                    icon={ICONS[tool]}
                    label={copy.tools[tool]}
                    pressed={annotator.tool === tool}
                    shortcut={keyOf(tool)}
                    onClick={() => (tool === "image" ? onImage() : tool === "signature" ? onSignature() : annotator.setTool(tool))}
                />
            ))}
            <div className="hidden items-center gap-0.5 lg:flex">
                <ToolbarDivider />
                <ZoomControl zoom={zoom} />
            </div>
            <span className="ml-auto hidden lg:block" />
            <div className="hidden lg:flex">
                <PageNav current={current} count={count} onGo={onGo} />
            </div>
        </Toolbar>
    );
}

interface PagesProps {
    annotator: Annotator;
    document: PDFDocumentProxy;
    sizes: { width: number; height: number }[];
    scale: number;
    area: (element: HTMLDivElement | null) => void;
    register: ReturnType<typeof usePageScroller>["register"];
    /** Pages can be removed (the editor), or not (signing). */
    removable: boolean;
}

/** Every page, one under another, with its edits over it and — in the editor — a remove switch above it. */
export function AnnotatorPages({ annotator, document, sizes, scale, area, register, removable }: PagesProps) {
    const t = useT();
    const copy = t.documents.editor;
    const today = new Intl.DateTimeFormat(t.meta.lang === "ne" ? "ne-NP" : "en-GB", { dateStyle: "medium" }).format(new Date());
    const markup = MARKUP.includes(annotator.tool);
    return (
        <div ref={area} tabIndex={-1} className="relative h-[58dvh] overflow-auto overscroll-contain rounded-xl bg-secondary outline-none lg:h-full">
            <div className="mx-auto flex w-max min-w-full flex-col items-center gap-5 p-4">
                {sizes.map((size, index) => {
                    const page = index + 1;
                    const removed = annotator.deleted.includes(page);
                    return (
                        <div key={page} ref={(node) => register(page, node)} className="flex flex-col gap-1.5" style={{ width: size.width * scale }}>
                            <div className="flex min-h-8 items-center justify-between gap-2">
                                <span className="text-xs font-medium text-tertiary tabular-nums">{copy.pageLabel(page, sizes.length)}</span>
                                {removable && (
                                    <button
                                        type="button"
                                        onClick={() => annotator.togglePage(page)}
                                        disabled={!removed && annotator.deleted.length >= sizes.length - 1}
                                        className={cn(
                                            "flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-medium outline-focus-ring focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:h-10",
                                            removed ? "text-[var(--brand)] hover:bg-[var(--brand-soft)]" : "text-tertiary hover:bg-primary_hover hover:text-error-primary",
                                        )}
                                    >
                                        {removed ? <RotateCcw className="size-3.5" aria-hidden /> : <Trash2 className="size-3.5" aria-hidden />}
                                        {removed ? copy.restorePage : copy.removePage}
                                    </button>
                                )}
                            </div>
                            <PdfPage document={document} page={page} size={size} scale={scale} textLayer textInteractive={markup && !removed} label={copy.pageLabel(page, sizes.length)} className={cn(removed && "opacity-35 grayscale")}>
                                {!removed && <AnnotationLayer annotator={annotator} page={page} size={size} scale={scale} today={today} />}
                                {removed && (
                                    <div className="absolute inset-0 z-[4] grid place-items-center">
                                        <span className="rounded-lg bg-neutral-900/80 px-3 py-1.5 text-sm font-medium text-white">{copy.pageRemoved}</span>
                                    </div>
                                )}
                            </PdfPage>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ------------------------------------------------------------------ panel

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-primary">{title}</h3>
            {children}
        </section>
    );
}

const percent = (value: number) => `${Math.round(value)}%`;
const points = (value: number) => `${value} pt`;
const degrees = (value: number) => `${Math.round(value)}°`;

/**
 * The right-hand panel: the selected edit's properties (or, with nothing selected, the active tool's
 * settings for what you make next), and what the tool does.
 */
export function AnnotatorPanel({ annotator, mode, children }: { annotator: Annotator; mode: AnnotatorMode; children?: ReactNode }) {
    const t = useT();
    const copy = t.documents.editor;
    const { selected, style, setStyle, tool } = annotator;
    const set = (key: string, change: (item: Annotation) => Annotation) => selected && annotator.update(selected.id, change, key);

    const properties = (() => {
        if (!selected) return null;
        switch (selected.kind) {
            case "text":
                return (
                    <>
                        <Range label={copy.size} value={selected.size} min={6} max={96} onChange={(value) => set("size", (item) => refit(item as typeof selected, { size: value }))} format={points} />
                        <ColourPicker label={copy.colour} value={selected.color} onChange={(value) => set("color", (item) => ({ ...item, color: value }) as Annotation)} />
                        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-secondary">
                            <input type="checkbox" checked={selected.bold} onChange={(event) => set("bold", (item) => refit(item as typeof selected, { bold: event.target.checked }))} className="size-4 accent-[var(--brand)]" />
                            {copy.bold}
                        </label>
                        <Range label={copy.rotation} value={selected.rotation + 180} min={0} max={360} onChange={(value) => set("rotation", (item) => ({ ...item, rotation: value - 180 }) as Annotation)} format={(value) => degrees(value - 180)} />
                        <Button size="sm" color="secondary" onPress={() => annotator.setEditing(selected.id)} className="self-start">
                            {copy.editText}
                        </Button>
                    </>
                );
            case "image":
                return (
                    <>
                        {selected.signature && <SignatureInk key={selected.id} annotator={annotator} item={selected} />}
                        <Range label={copy.opacity} value={selected.opacity * 100} min={5} max={100} onChange={(value) => set("opacity", (item) => ({ ...item, opacity: value / 100 }) as Annotation)} format={percent} />
                        <Range label={copy.rotation} value={selected.rotation + 180} min={0} max={360} onChange={(value) => set("rotation", (item) => ({ ...item, rotation: value - 180 }) as Annotation)} format={(value) => degrees(value - 180)} />
                        <p className="text-xs text-tertiary">{copy.imageHint}</p>
                    </>
                );
            case "ink":
                return (
                    <>
                        <ColourPicker label={copy.colour} value={selected.color} onChange={(value) => set("color", (item) => ({ ...item, color: value }) as Annotation)} />
                        <Range label={copy.thickness} value={selected.width} min={1} max={16} onChange={(value) => set("width", (item) => ({ ...item, width: value }) as Annotation)} format={points} />
                        <Range label={copy.opacity} value={selected.opacity * 100} min={5} max={100} onChange={(value) => set("opacity", (item) => ({ ...item, opacity: value / 100 }) as Annotation)} format={percent} />
                    </>
                );
            case "highlight":
            case "underline":
            case "strike":
                return <ColourPicker label={copy.colour} value={selected.color} onChange={(value) => set("color", (item) => ({ ...item, color: value }) as Annotation)} />;
            case "rect":
            case "ellipse":
                return (
                    <>
                        <ColourPicker label={copy.stroke} value={selected.stroke} onChange={(value) => set("stroke", (item) => ({ ...item, stroke: value }) as Annotation)} />
                        <Range label={copy.thickness} value={selected.strokeWidth} min={0} max={16} onChange={(value) => set("strokeWidth", (item) => ({ ...item, strokeWidth: value }) as Annotation)} format={points} />
                        <FillControl value={selected.fill} onChange={(value) => set("fill", (item) => ({ ...item, fill: value }) as Annotation)} />
                        <Range label={copy.opacity} value={selected.opacity * 100} min={5} max={100} onChange={(value) => set("opacity", (item) => ({ ...item, opacity: value / 100 }) as Annotation)} format={percent} />
                    </>
                );
            case "line":
            case "arrow":
                return (
                    <>
                        <ColourPicker label={copy.colour} value={selected.stroke} onChange={(value) => set("stroke", (item) => ({ ...item, stroke: value }) as Annotation)} />
                        <Range label={copy.thickness} value={selected.strokeWidth} min={1} max={16} onChange={(value) => set("strokeWidth", (item) => ({ ...item, strokeWidth: value }) as Annotation)} format={points} />
                        <Range label={copy.opacity} value={selected.opacity * 100} min={5} max={100} onChange={(value) => set("opacity", (item) => ({ ...item, opacity: value / 100 }) as Annotation)} format={percent} />
                    </>
                );
        }
    })();

    // Nothing selected: the settings the next edit will use.
    const defaults = (() => {
        switch (tool) {
            case "text":
            case "date":
                return (
                    <>
                        <Range label={copy.size} value={style.textSize} min={6} max={96} onChange={(value) => setStyle({ textSize: value })} format={points} />
                        <ColourPicker label={copy.colour} value={style.color} onChange={(value) => setStyle({ color: value })} />
                        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-secondary">
                            <input type="checkbox" checked={style.bold} onChange={(event) => setStyle({ bold: event.target.checked })} className="size-4 accent-[var(--brand)]" />
                            {copy.bold}
                        </label>
                    </>
                );
            case "draw":
                return (
                    <>
                        <ColourPicker label={copy.colour} value={style.inkColor} onChange={(value) => setStyle({ inkColor: value })} />
                        <Range label={copy.thickness} value={style.inkWidth} min={1} max={16} onChange={(value) => setStyle({ inkWidth: value })} format={points} />
                        <Range label={copy.opacity} value={style.opacity * 100} min={5} max={100} onChange={(value) => setStyle({ opacity: value / 100 })} format={percent} />
                    </>
                );
            case "highlight":
                return <ColourPicker label={copy.colour} value={style.markColor} onChange={(value) => setStyle({ markColor: value })} />;
            case "underline":
            case "strike":
            case "line":
            case "arrow":
            case "rect":
            case "ellipse":
                return (
                    <>
                        <ColourPicker label={copy.colour} value={style.stroke} onChange={(value) => setStyle({ stroke: value })} />
                        {tool !== "underline" && tool !== "strike" && <Range label={copy.thickness} value={style.strokeWidth} min={1} max={16} onChange={(value) => setStyle({ strokeWidth: value })} format={points} />}
                        {(tool === "rect" || tool === "ellipse") && <FillControl value={style.fill} onChange={(value) => setStyle({ fill: value })} />}
                    </>
                );
            default:
                return null;
        }
    })();

    return (
        <>
            {selected ? (
                <Section title={copy.kinds[selected.kind === "image" && selected.signature ? "signature" : selected.kind]}>
                    {properties}
                    <Button size="sm" color="secondary" iconLeading={Trash2} onPress={() => annotator.remove(selected.id)} className="self-start">
                        {copy.deleteItem}
                    </Button>
                </Section>
            ) : (
                <Section title={copy.tools[tool]}>
                    <p className="text-xs leading-relaxed text-tertiary">{copy.toolHints[tool]}</p>
                    {defaults}
                </Section>
            )}
            {children}
            {mode === "edit" && <p className="text-xs leading-relaxed text-tertiary">{copy.originalNote}</p>}
        </>
    );
}

function FillControl({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
    const copy = useT().documents.editor;
    return (
        <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-secondary">
                <input type="checkbox" checked={value !== null} onChange={(event) => onChange(event.target.checked ? "#fde68a" : null)} className="size-4 accent-[var(--brand)]" />
                {copy.fill}
            </label>
            {value !== null && <ColourPicker label={copy.fill} value={value} onChange={onChange} />}
        </div>
    );
}

/**
 * A placed signature's ink: Original, or any colour. Each colour is made from the original picture
 * (never from the last recolouring), so switching back and forth loses nothing; only the newest pick
 * is applied while the colour picker is being dragged.
 */
function SignatureInk({ annotator, item }: { annotator: Annotator; item: ImageAnnotation }) {
    const copy = useT().documents.editor;
    const latest = useRef(0);
    const source = item.source ?? item.image;

    const recolour = async (ink: string | null) => {
        const run = ++latest.current;
        if (!ink) return annotator.update(item.id, (current) => ({ ...current, image: source, source: undefined, ink: undefined }) as Annotation, "ink");
        const picture = annotator.pictures.get(source);
        if (!picture) return;
        const result = await recolourPicture(picture.blob, ink);
        if (run !== latest.current) return;
        const key = annotator.addPicture(result);
        annotator.update(item.id, (current) => ({ ...current, image: key, source, ink }) as Annotation, "ink");
    };

    return (
        <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-secondary">{copy.signatureInk}</span>
            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    aria-pressed={!item.ink}
                    onClick={() => void recolour(null)}
                    className={cn("h-7 cursor-pointer rounded-full border px-2.5 text-xs font-medium outline-focus-ring focus-visible:outline-2", !item.ink ? "border-[var(--brand)] text-[var(--brand)]" : "border-[var(--card-line)] text-secondary hover:bg-primary_hover")}
                >
                    {copy.signatureOriginal}
                </button>
                <ColourPicker label={copy.signatureInk} value={item.ink ?? "#000000"} onChange={(value) => void recolour(value)} />
            </div>
        </div>
    );
}
