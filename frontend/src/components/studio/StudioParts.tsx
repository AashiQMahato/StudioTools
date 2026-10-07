import { AlertCircle, ArrowRight, CheckCircle2, ChevronDown, CircleAlert, Clipboard, CloudUpload, FileImage, FileText, Image as ImageIcon, ImagePlus, Info, Lightbulb, Lock, type LucideIcon, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useId, useRef, useState } from "react";
import { CompareSlider } from "@/components/common/CompareSlider";
import { Segmented } from "@/components/common/Segmented";
import { Button } from "@/components/ui/base/buttons/button";
import { useFitSize } from "@/hooks/useFitSize";
import { cn } from "@/lib/utils/cn";
import type { ImageDimensions } from "@/types/image";
import { useT } from "@/i18n";
import { useStudio } from "./StudioShell";

/**
 * The bordered box the image lives in. Fills the centre card on desktop; a fixed share of the screen on
 * phones — except while it holds the upload card: then it fills the card, however tall the upload card
 * is (no clipped picture, no scrolling inside a box, no empty space below).
 */
export function StudioCanvas({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn("relative flex h-[58svh] min-h-[20rem] flex-col overflow-hidden rounded-xl border border-[var(--card-line)] bg-secondary has-[.studio-drop]:max-lg:h-auto has-[.studio-drop]:max-lg:min-h-0 has-[.studio-drop]:max-lg:flex-1 lg:h-auto lg:min-h-0 lg:flex-1", className)}>{children}</div>;
}

export interface DropFeature {
    icon: LucideIcon;
    title: string;
    detail: string;
}

interface StudioDropzoneProps {
    title: string;
    hint: string;
    limits?: string;
    /** What the tool takes: picks the picture and the button's words. */
    kind?: "image" | "pdf";
    /** A headline with one word in the accent colour, instead of the plain title. */
    headline?: { lead: string; accent: string; tail?: string };
    /** The button's label (defaults to choosing an image). */
    actionLabel?: string;
    /** Several files at once (the drag hint says "files"). */
    many?: boolean;
    /** What the tool offers, as a row of chips under the button. */
    features?: readonly DropFeature[];
}

/**
 * The empty state every tool shares: a picture of what the tool does, one clear target, and the ways
 * in (drop, paste, choose). The whole card is the target; the button is what it looks like.
 */
export function StudioDropzone({ title, hint, limits, kind = "image", headline, actionLabel, many = false, features }: StudioDropzoneProps) {
    const t = useT();
    const { openPicker, uploadError } = useStudio();
    return (
        <div className="animate-enter flex flex-1 overflow-y-auto p-3 [--i:-1] sm:p-6">
            <button
                type="button"
                onClick={openPicker}
                className="studio-drop group m-auto flex w-full max-w-2xl cursor-pointer flex-col items-center rounded-3xl px-5 py-8 text-center outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-4 sm:px-10 sm:py-12"
            >
                <DropArt kind={kind} />
                <span className="mt-6 text-[1.625rem] leading-tight font-bold tracking-[-0.02em] text-balance text-primary sm:text-[2rem]">
                    {headline ? (
                        <>
                            {headline.lead} <span className="bg-linear-to-r from-[#6366F1] to-[#A855F7] bg-clip-text text-transparent dark:from-[#818CF8] dark:to-[#C084FC]">{headline.accent}</span>
                            {headline.tail && <span className="block">{headline.tail}</span>}
                        </>
                    ) : (
                        title
                    )}
                </span>
                <span className="mt-3 max-w-md text-sm leading-relaxed text-pretty text-tertiary sm:text-md">{hint}</span>
                <span className="studio-cta mt-7 inline-flex h-12 items-center gap-2.5 rounded-xl px-6 text-md font-semibold text-white">
                    {kind === "pdf" ? <CloudUpload className="size-5" aria-hidden /> : <ImagePlus className="size-5" aria-hidden />}
                    {actionLabel ?? t.common.chooseImage}
                </span>
                <span className="mt-3 text-sm text-tertiary [@media(hover:none)]:hidden">{many ? t.studio.dragHintMany : t.studio.dragHint}</span>

                {features && features.length > 0 && (
                    <span className="mt-8 grid w-full max-w-xl grid-cols-1 gap-3 rounded-2xl border border-[var(--card-line)] bg-primary/80 p-3 text-left sm:grid-cols-3 sm:p-4">
                        {features.map(({ icon: Icon, title: featureTitle, detail }) => (
                            <span key={featureTitle} className="flex items-center gap-3">
                                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,#6366F1_12%,transparent)] text-[#4F46E5] dark:text-[#A5B4FC]">
                                    <Icon className="size-[1.125rem]" strokeWidth={1.9} aria-hidden />
                                </span>
                                <span className="min-w-0">
                                    <span className="block text-sm font-semibold text-primary">{featureTitle}</span>
                                    <span className="block text-xs text-tertiary">{detail}</span>
                                </span>
                            </span>
                        ))}
                    </span>
                )}

                <span className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-quaternary">
                    <span>{limits ?? t.common.uploadHint}</span>
                    <span className="inline-flex items-center gap-1.5 [@media(hover:none)]:hidden">
                        <Clipboard className="size-3.5" aria-hidden />
                        {t.upload.pasteChip}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <Lock className="size-3.5" aria-hidden />
                        {t.upload.neverStored}
                    </span>
                </span>
            </button>
            {uploadError && (
                <p role="alert" className="sr-only">
                    {uploadError}
                </p>
            )}
        </div>
    );
}

/** The empty state's picture: a document becoming an image, or a photo being worked on. Decorative. */
function DropArt({ kind }: { kind: "image" | "pdf" }) {
    return (
        <span aria-hidden className="studio-drop-art relative block h-32 w-56 sm:h-36 sm:w-64">
            <span className="absolute top-6 left-6 size-20 rounded-full bg-[#BAE6FD]/60 blur-xl dark:bg-[#0EA5E9]/25" />
            <span className="absolute right-6 bottom-2 size-20 rounded-full bg-[#DDD6FE]/70 blur-xl dark:bg-[#8B5CF6]/25" />
            {kind === "pdf" ? (
                <>
                    <span className="absolute top-1 left-[22%] flex h-28 w-22 -rotate-6 flex-col rounded-xl border border-white/80 bg-white p-2.5 shadow-[0_16px_32px_-14px_rgb(30_41_59/0.4)] sm:h-30 dark:border-white/10 dark:bg-[#1c1f2b]">
                        <span className="grid h-12 place-items-center rounded-lg bg-linear-to-br from-[#FB7185] to-[#E11D48] text-white">
                            <FileText className="size-6" strokeWidth={1.8} />
                        </span>
                        <span className="mt-2.5 h-1.5 w-[80%] rounded-full bg-[#E2E8F0] dark:bg-white/15" />
                        <span className="mt-1.5 h-1.5 w-[60%] rounded-full bg-[#E2E8F0] dark:bg-white/15" />
                    </span>
                    <span className="absolute top-10 right-[16%] grid h-18 w-22 rotate-6 place-items-center rounded-xl bg-linear-to-br from-[#60A5FA] to-[#2563EB] shadow-[0_16px_32px_-12px_rgb(37_99_235/0.55)] ring-4 ring-white dark:ring-[#1c1f2b]">
                        <ImageIcon className="size-8 text-white" strokeWidth={1.6} />
                    </span>
                </>
            ) : (
                <>
                    <span className="absolute top-2 left-[24%] h-26 w-36 -rotate-6 overflow-hidden rounded-xl shadow-[0_16px_32px_-14px_rgb(30_41_59/0.45)] ring-4 ring-white dark:ring-[#1c1f2b]">
                        <span className="absolute inset-0 bg-linear-to-b from-[#FDE68A] via-[#F9A8D4] to-[#A5B4FC]" />
                        <span className="absolute top-3 right-6 size-6 rounded-full bg-[#FEF3C7]" />
                        <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-[55%] w-full">
                            <path d="M0 60V38l22-20 16 14 20-24 42 34v18z" fill="#6366F1" opacity="0.85" />
                            <path d="M0 60V46l30-16 22 14 18-10 30 18v8z" fill="#4338CA" />
                        </svg>
                    </span>
                    <span className="absolute top-12 right-[16%] grid size-14 rotate-6 place-items-center rounded-xl bg-linear-to-br from-[#A78BFA] to-[#7C3AED] text-white shadow-[0_16px_32px_-12px_rgb(124_58_237/0.55)]">
                        <Sparkles className="size-6" strokeWidth={1.8} />
                    </span>
                </>
            )}
        </span>
    );
}

export function StudioError({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
    const t = useT();
    return (
        <div role="alert" className="animate-enter flex flex-1 flex-col items-center justify-center p-6 text-center [--i:-1]">
            <span className="grid size-12 place-items-center rounded-2xl bg-error-primary text-error-primary">
                <AlertCircle className="size-6" aria-hidden />
            </span>
            <p className="mt-4 text-md font-semibold text-primary">{title}</p>
            <p className="mt-1 max-w-sm text-sm text-tertiary">{message}</p>
            {onRetry && (
                <Button size="md" color="primary" iconLeading={RotateCcw} onPress={onRetry} className="press-scale mt-5 pointer-coarse:min-h-11">
                    {t.common.tryAgain}
                </Button>
            )}
        </div>
    );
}

export type NoticeTone = "success" | "info" | "error";
export interface Notice {
    tone: NoticeTone;
    text: string;
}

/** One line under the canvas saying what just happened. */
export function StudioNotice({ notice }: { notice: Notice }) {
    const Icon = notice.tone === "success" ? CheckCircle2 : notice.tone === "error" ? CircleAlert : Info;
    return (
        <p
            key={notice.text}
            role={notice.tone === "error" ? "alert" : "status"}
            aria-live="polite"
            className={cn(
                "animate-enter flex min-h-11 items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm [--i:-1]",
                notice.tone === "success" && "border-transparent bg-success-primary text-success-primary",
                notice.tone === "info" && "border-[var(--card-line)] bg-secondary text-secondary",
                notice.tone === "error" && "border-error_subtle bg-error-primary text-error-primary",
            )}
        >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{notice.text}</span>
        </p>
    );
}

/** Removes the image from the studio (and every tool), back to the empty drop zone. */
export function ClearImageButton({ className }: { className?: string }) {
    const t = useT();
    const { clearImage } = useStudio();
    return (
        <Button size="lg" color="tertiary" iconLeading={Trash2} onPress={clearImage} className={cn("press-scale pointer-coarse:min-h-12", className)}>
            {t.studio.clearImage}
        </Button>
    );
}

/** The centre card's action row. */
export function StudioActions({ children }: { children: ReactNode }) {
    return <div className="flex flex-col-reverse items-stretch justify-center gap-2 sm:flex-row sm:gap-3 [&>*]:sm:min-w-48">{children}</div>;
}

export interface PanelTab<T extends string> {
    id: T;
    label: string;
    icon: ReactNode;
    disabled?: boolean;
}

/** Tabs across the top of the right-hand panel (arrow keys move between them). */
export function PanelTabs<T extends string>({ tabs, value, onChange, label }: { tabs: readonly PanelTab<T>[]; value: T; onChange: (tab: T) => void; label: string }) {
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const enabled = tabs.filter((tab) => !tab.disabled);
        const index = enabled.findIndex((tab) => tab.id === value);
        const next = enabled[(index + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length];
        if (!next) return;
        onChange(next.id);
        (event.currentTarget.querySelector(`[data-tab="${next.id}"]`) as HTMLElement | null)?.focus();
    };
    return (
        <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex shrink-0 gap-1 border-b border-[var(--card-line)] bg-secondary p-1.5">
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    data-tab={tab.id}
                    aria-selected={value === tab.id}
                    tabIndex={value === tab.id ? 0 : -1}
                    disabled={tab.disabled}
                    onClick={() => onChange(tab.id)}
                    className={cn(
                        "relative flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl px-2 text-sm font-medium transition-colors duration-150 outline-focus-ring focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-40",
                        value === tab.id ? "bg-primary text-[var(--brand)] shadow-xs" : "text-tertiary hover:text-primary",
                    )}
                >
                    {/* Phones keep the words, which say more than the icons in the space there is. */}
                    <span className="hidden shrink-0 sm:inline-flex">{tab.icon}</span>
                    <span className="truncate">{tab.label}</span>
                    {value === tab.id && <span aria-hidden className="absolute inset-x-5 -bottom-1.5 h-0.5 rounded-full bg-[var(--brand)]" />}
                </button>
            ))}
        </div>
    );
}

/** The scrolling body of the right-hand panel. */
export function PanelBody({ children, id }: { children: ReactNode; id?: string }) {
    return (
        <div key={id} className="animate-enter flex flex-col gap-6 p-4 [--i:-1] sm:p-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {children}
        </div>
    );
}

/** What the panel says before there's an image: the tool, in three steps. */
export type GuideStep = string | { title: string; detail: string };

interface PanelIntroProps {
    title: string;
    steps: readonly GuideStep[];
    /** A picture above the steps (decorative). */
    art?: ReactNode;
    /** The file types the tool takes or makes, as chips. */
    formats?: readonly string[];
    /** One practical tip, which can be dismissed. */
    tip?: string;
}

/** The panel before there's anything to work on: how the tool works, what it takes, and a tip. */
export function PanelIntro({ title, steps, art, formats, tip }: PanelIntroProps) {
    const t = useT();
    const [tipShown, setTipShown] = useState(true);
    return (
        <>
            {art}
            <section>
                <h3 className="text-md font-semibold text-primary">{title}</h3>
                <ol className="mt-4 flex flex-col gap-4">
                    {steps.map((step, index) => {
                        const { title: stepTitle, detail } = typeof step === "string" ? { title: step, detail: null } : step;
                        return (
                            <li key={stepTitle} className="flex gap-3">
                                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-linear-to-b from-[#818CF8] to-[#6366F1] text-xs font-semibold text-white tabular-nums shadow-[0_3px_8px_-3px_rgb(99_102_241/0.7)]">{index + 1}</span>
                                <span className="min-w-0 pt-0.5">
                                    <span className={cn("block text-sm", detail ? "font-semibold text-primary" : "text-secondary")}>{stepTitle}</span>
                                    {detail && <span className="mt-0.5 block text-sm leading-relaxed text-tertiary">{detail}</span>}
                                </span>
                            </li>
                        );
                    })}
                </ol>
            </section>
            {formats && formats.length > 0 && (
                <section>
                    <h3 className="text-sm font-semibold text-primary">{t.studio.supportedFormats}</h3>
                    <ul className="mt-3 flex flex-wrap gap-2">
                        {formats.map((format, index) => (
                            <li key={format} className="flex items-center gap-1.5 rounded-lg border border-[var(--card-line)] bg-primary px-2.5 py-1.5 text-xs font-semibold text-secondary">
                                <FileImage className="size-3.5" style={{ color: FORMAT_TONES[index % FORMAT_TONES.length] }} aria-hidden />
                                {format}
                            </li>
                        ))}
                    </ul>
                </section>
            )}
            {tip && tipShown && (
                <aside className="relative rounded-2xl border border-[color-mix(in_srgb,#A855F7_18%,transparent)] bg-[color-mix(in_srgb,#A855F7_7%,transparent)] p-4 pr-10">
                    <p className="flex items-center gap-2 text-sm font-semibold text-primary">
                        <Lightbulb className="size-4 text-[#F59E0B]" aria-hidden />
                        {t.studio.proTip}
                    </p>
                    <p className="mt-1.5 text-sm leading-relaxed text-tertiary">{tip}</p>
                    <button type="button" onClick={() => setTipShown(false)} aria-label={t.studio.dismissTip} className="absolute top-3 right-3 grid size-7 cursor-pointer place-items-center rounded-lg text-quaternary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 pointer-coarse:size-10">
                        <X className="size-4" aria-hidden />
                    </button>
                </aside>
            )}
        </>
    );
}

const FORMAT_TONES = ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B"];

/** A picture for the panel's top: what goes in, an arrow, what comes out. Decorative. */
export function PanelArt({ from, to }: { from: "pdf" | "image"; to: "pdf" | "images" | "text" }) {
    const tile = "grid place-items-center rounded-xl text-white";
    return (
        <div aria-hidden className="flex h-32 items-center justify-center gap-4 rounded-2xl bg-linear-to-br from-[color-mix(in_srgb,#6366F1_8%,var(--color-bg-primary))] to-[color-mix(in_srgb,#0EA5E9_8%,var(--color-bg-primary))]">
            {from === "pdf" ? (
                <span className="flex h-20 w-16 -rotate-3 flex-col items-center justify-center gap-1.5 rounded-lg border border-white/80 bg-white shadow-md dark:border-white/10 dark:bg-[#1c1f2b]">
                    <span className="rounded-md bg-linear-to-br from-[#FB7185] to-[#E11D48] px-1.5 py-0.5 text-[0.625rem] font-bold text-white">PDF</span>
                    <span className="h-1 w-8 rounded-full bg-[#E2E8F0] dark:bg-white/15" />
                    <span className="h-1 w-6 rounded-full bg-[#E2E8F0] dark:bg-white/15" />
                </span>
            ) : (
                <span className={cn(tile, "size-16 -rotate-3 bg-linear-to-br from-[#60A5FA] to-[#2563EB] shadow-md")}>
                    <ImageIcon className="size-7" strokeWidth={1.6} />
                </span>
            )}
            <ArrowRight className="size-6 text-[#818CF8]" strokeWidth={2.4} />
            {to === "images" ? (
                <span className="relative h-20 w-20">
                    <span className={cn(tile, "absolute top-0 left-0 size-11 bg-linear-to-br from-[#93C5FD] to-[#3B82F6] shadow-md")}>
                        <ImageIcon className="size-5" />
                    </span>
                    <span className={cn(tile, "absolute top-3 right-0 size-11 bg-linear-to-br from-[#A5B4FC] to-[#6366F1] shadow-md")}>
                        <ImageIcon className="size-5" />
                    </span>
                    <span className={cn(tile, "absolute bottom-0 left-4 size-11 bg-linear-to-br from-[#7DD3FC] to-[#0EA5E9] shadow-md")}>
                        <ImageIcon className="size-5" />
                    </span>
                </span>
            ) : (
                <span className={cn(tile, "size-16 rotate-3 shadow-md", to === "pdf" ? "bg-linear-to-br from-[#FB7185] to-[#E11D48]" : "bg-linear-to-br from-[#5EEAD4] to-[#0D9488]")}>
                    <FileText className="size-7" strokeWidth={1.6} />
                </span>
            )}
        </div>
    );
}

// ------------------------------------------------------------------ fitted images

const ZOOM_LEVELS = [1, 2, 4] as const;
type Zoom = (typeof ZOOM_LEVELS)[number];

/** Sizes children to the largest box with the image's aspect ratio that fits the canvas. */
export function Fitted({ dimensions, children }: { dimensions: ImageDimensions; children: (size: { width: number; height: number }) => ReactNode }) {
    const areaRef = useRef<HTMLDivElement>(null);
    const size = useFitSize(areaRef, dimensions.width / dimensions.height);
    return (
        <div className="flex flex-1 p-3 sm:p-6 lg:min-h-0">
            <div ref={areaRef} className="relative flex min-h-0 flex-1 items-center justify-center">
                {size && children(size)}
            </div>
        </div>
    );
}

/** The result beside the original: a draggable divider, with 2× and 4× magnification that follows the pointer. */
export function CompareView({
    before,
    after,
    beforeLabel,
    afterLabel,
    size,
    transparentBefore,
}: {
    before: { src: string; alt: string };
    after: { src: string; alt: string };
    beforeLabel: string;
    afterLabel: string;
    size: { width: number; height: number };
    transparentBefore?: boolean;
}) {
    const t = useT();
    const [position, setPosition] = useState(50);
    const [zoom, setZoom] = useState<Zoom>(1);
    const [origin, setOrigin] = useState({ x: 50, y: 50 });
    const follow = (event: PointerEvent<HTMLDivElement>) => {
        if (zoom === 1 || (event.pointerType !== "mouse" && event.type === "pointermove")) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setOrigin({ x: Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)), y: Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100)) });
    };
    const imageClass = "absolute inset-0 size-full object-contain";
    return (
        <div className="animate-enter relative [--i:-1]" style={size} onPointerMove={follow} onPointerDown={follow}>
            <CompareSlider
                value={position}
                onChange={setPosition}
                beforeLabel={beforeLabel}
                afterLabel={afterLabel}
                className="rounded-lg"
                style={size}
                zoom={zoom > 1 ? { scale: zoom, origin } : undefined}
                before={
                    <>
                        {transparentBefore && <div className="absolute inset-0 bg-checkerboard" />}
                        <img src={before.src} alt={before.alt} className={imageClass} draggable={false} />
                    </>
                }
                after={<img src={after.src} alt={after.alt} className={imageClass} draggable={false} />}
            />
            <div className="absolute bottom-3 left-3 rounded-xl border border-[var(--card-line)] bg-primary p-0.5 shadow-sm">
                <Segmented
                    size="sm"
                    label={t.workspace.zoom}
                    value={zoom}
                    onChange={setZoom}
                    options={ZOOM_LEVELS.map((level) => ({ value: level, label: level === 1 ? t.workspace.fit : `${level}×`, ariaLabel: level === 1 ? t.workspace.fitAria : t.workspace.zoomAria(level) }))}
                />
            </div>
        </div>
    );
}

// ------------------------------------------------------------------ toolbar

interface ToolbarSelectProps<T extends string | number> {
    icon: LucideIcon;
    label: string;
    value: T;
    options: readonly { value: T; label: string }[];
    onChange: (value: T) => void;
}

/**
 * A quick setting in a tool's toolbar: its name above its value, opening the platform's own picker
 * (a native select underneath — familiar on every device, and accessible as is).
 */
export function ToolbarSelect<T extends string | number>({ icon: Icon, label, value, options, onChange }: ToolbarSelectProps<T>) {
    const id = useId();
    const current = options.find((option) => option.value === value);
    return (
        <span className="studio-select relative flex h-12 min-w-[8.5rem] items-center gap-2.5 rounded-xl border border-[var(--card-line)] bg-primary pr-9 pl-3 focus-within:outline-2 focus-within:outline-focus-ring hover:bg-primary_hover">
            <Icon className="size-[1.125rem] shrink-0 text-tertiary" strokeWidth={1.9} aria-hidden />
            <span aria-hidden className="flex min-w-0 flex-col leading-tight">
                <span className="text-[0.6875rem] text-tertiary">{label}</span>
                <span className="truncate text-sm font-semibold text-primary">{current?.label}</span>
            </span>
            <ChevronDown className="pointer-events-none absolute right-3 size-4 text-quaternary" aria-hidden />
            <select
                id={id}
                aria-label={label}
                value={String(value)}
                onChange={(event) => {
                    const next = options.find((option) => String(option.value) === event.target.value);
                    if (next) onChange(next.value);
                }}
                className="absolute inset-0 cursor-pointer appearance-none rounded-xl opacity-0"
            >
                {options.map((option) => (
                    <option key={String(option.value)} value={String(option.value)}>
                        {option.label}
                    </option>
                ))}
            </select>
        </span>
    );
}
