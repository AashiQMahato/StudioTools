import { Crop, Eraser, LayoutGrid, type LucideIcon, Pause, Play, RotateCw, SlidersHorizontal, ZoomIn } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import poster from "@/assets/video/hero-poster.webp";
import heroVideo from "@/assets/video/hero.mp4";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { ROUTES } from "@/lib/constants/routes";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";

type StepKey = "remove" | "upscale" | "crop" | "rotate" | "edit" | "all";

/** The reel's scenes: when each starts (seconds) and the tool it shows. */
const STEPS: readonly { key: StepKey; start: number; href: string; icon: LucideIcon }[] = [
    { key: "remove", start: 0.5, href: ROUTES.removeBackground, icon: Eraser },
    { key: "upscale", start: 1.9, href: ROUTES.upscale, icon: ZoomIn },
    { key: "crop", start: 2.9, href: ROUTES.crop, icon: Crop },
    { key: "rotate", start: 4.4, href: ROUTES.crop, icon: RotateCw },
    { key: "edit", start: 6.0, href: ROUTES.editor, icon: SlidersHorizontal },
    { key: "all", start: 7.5, href: "#tools", icon: LayoutGrid },
];

const stepAt = (time: number) => {
    let index = -1;
    STEPS.forEach((step, i) => {
        if (time >= step.start) index = i;
    });
    return index;
};

/**
 * The product reel in an app-window frame. Steps beneath it light up with each scene and lead to that
 * tool; a hairline shows the loop's progress. It plays muted and inline, pauses when scrolled away
 * or on request, and — when the system asks for less motion — waits on its poster for a Play press.
 */
export function HeroShowcase({ className }: { className?: string }) {
    const t = useT();
    const copy = t.hero.showcase;
    const reduceMotion = usePrefersReducedMotion();
    const frame = useRef<HTMLDivElement>(null);
    const video = useRef<HTMLVideoElement>(null);
    const bar = useRef<HTMLSpanElement>(null);
    const steps = useRef<HTMLUListElement>(null);
    const [thumb, setThumb] = useState<{ x: number; width: number } | null>(null);
    const [active, setActive] = useState(-1);
    const [playing, setPlaying] = useState(false);
    // Paused by the person (not by scrolling away): stays paused until they press play.
    const userPaused = useRef(false);

    // Progress and the lit step follow the clip frame by frame, without re-rendering every frame.
    useEffect(() => {
        const element = video.current;
        if (!element) return;
        let raf = 0;
        let current = -1;
        const update = () => {
            const progress = element.duration ? element.currentTime / element.duration : 0;
            if (bar.current) bar.current.style.transform = `scaleX(${progress})`;
            const index = stepAt(element.currentTime);
            if (index !== current) {
                current = index;
                setActive(index);
            }
        };
        const loop = () => {
            update();
            raf = requestAnimationFrame(loop);
        };
        const onPlay = () => {
            setPlaying(true);
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(loop);
        };
        const onPause = () => {
            setPlaying(false);
            cancelAnimationFrame(raf);
            update();
        };
        element.addEventListener("play", onPlay);
        element.addEventListener("pause", onPause);
        element.addEventListener("seeked", update);
        if (!element.paused) onPlay();
        return () => {
            cancelAnimationFrame(raf);
            element.removeEventListener("play", onPlay);
            element.removeEventListener("pause", onPause);
            element.removeEventListener("seeked", update);
        };
    }, []);

    // Plays while on screen (unless motion is reduced or it was paused on purpose); rests when scrolled away.
    useEffect(() => {
        const element = video.current;
        const target = frame.current;
        if (!element || !target) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (!entry) return;
                if (entry.isIntersecting && !reduceMotion && !userPaused.current) void element.play().catch(() => undefined);
                else if (!entry.isIntersecting) element.pause();
            },
            { threshold: 0.25 },
        );
        observer.observe(target);
        return () => observer.disconnect();
    }, [reduceMotion]);

    // The highlight follows the lit step — measured, so it fits each label and survives resizes.
    useLayoutEffect(() => {
        const list = steps.current;
        if (!list) return;
        const measure = () => {
            const item = active >= 0 ? list.querySelectorAll<HTMLElement>("[data-step]")[active] : null;
            if (!item) return setThumb(null);
            setThumb({ x: item.offsetLeft, width: item.offsetWidth });
            // Phones: keep the lit step in view by scrolling the row sideways (never the page).
            const left = item.offsetLeft - (list.clientWidth - item.offsetWidth) / 2;
            if (list.scrollWidth > list.clientWidth) list.scrollTo({ left, behavior: "smooth" });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(list);
        return () => observer.disconnect();
    }, [active]);

    const toggle = () => {
        const element = video.current;
        if (!element) return;
        if (element.paused) {
            userPaused.current = false;
            void element.play().catch(() => undefined);
        } else {
            userPaused.current = true;
            element.pause();
        }
    };

    return (
        <div className={cn("relative mx-auto w-full max-w-5xl", className)}>
            {/* Light behind the frame: a soft brand glow, so the reel sits in the page rather than on it. */}
            <div aria-hidden className="hero-showcase-glow pointer-events-none absolute -inset-x-8 top-[8%] -bottom-6 -z-10 rounded-[3rem] blur-3xl sm:-inset-x-16" />

            {/* The reel itself is the frame: rounded, with a hairline edge and long, soft depth. */}
            <figure ref={frame} className="hero-frame group relative aspect-video overflow-hidden rounded-[1.5rem] bg-[#efe9df]">
                <video ref={video} className="absolute inset-0 size-full object-cover" src={heroVideo} poster={poster} muted loop playsInline preload="metadata" aria-label={copy.label} />
                {/* The whole reel is the play / pause control (moving content must be pausable). Invisible at
                    rest; a small glyph shows on hover or keyboard focus — and the Play prompt when motion is reduced. */}
                <button type="button" onClick={toggle} aria-label={playing ? copy.pause : copy.play} className="absolute inset-0 cursor-pointer outline-none">
                    <span
                        aria-hidden
                        className={cn(
                            "absolute grid place-items-center rounded-full bg-white/85 text-[var(--brand)] shadow-lg ring-1 ring-black/5 backdrop-blur transition-[opacity,scale] duration-200 group-focus-visible:opacity-100",
                            !playing && reduceMotion ? "top-1/2 left-1/2 size-16 -translate-x-1/2 -translate-y-1/2 opacity-100" : "top-3 right-3 size-9 scale-90 opacity-0 group-hover:scale-100 group-hover:opacity-100",
                        )}
                    >
                        {playing ? <Pause className="size-4 fill-current" /> : <Play className={cn("translate-x-px fill-current", !playing && reduceMotion ? "size-6" : "size-4")} />}
                    </span>
                    <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[1.5rem] ring-[var(--brand)] group-has-[:focus-visible]:ring-2" />
                </button>
                <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-black/5">
                    <span ref={bar} className="block h-full origin-left scale-x-0 bg-[var(--brand)]" />
                </span>
            </figure>

            {/* The steps, in the reel's order: the one on screen lit, each a way into its tool. */}
            <nav aria-label={copy.stepsLabel} className="relative z-10 -mt-5 flex justify-center px-3 sm:-mt-6">
                <ul ref={steps} className="hero-steps relative flex max-w-full items-center gap-1 overflow-x-auto rounded-full p-1 [scrollbar-width:none]">
                    {/* One highlight that glides to the step on screen. */}
                    <span
                        aria-hidden
                        className="hero-step-thumb pointer-events-none absolute top-1 bottom-1 left-0 rounded-full bg-brand-solid shadow-[0_6px_16px_-6px_rgb(3_105_161/0.6)]"
                        style={{ transform: `translateX(${thumb?.x ?? 0}px)`, width: thumb?.width ?? 0, opacity: thumb ? 1 : 0 }}
                    />
                    {STEPS.map((step, index) => {
                        const Icon = step.icon;
                        const lit = index === active;
                        const inner = (
                            <>
                                <Icon className="size-3.5 shrink-0 sm:size-4" aria-hidden />
                                {/* Phones, and small laptops beside the text: only the lit step is named, so the bar fits
                                    without scrolling (the rest stay icons, named for screen readers). */}
                                <span className={cn(!lit && "max-sm:sr-only lg:max-xl:sr-only")}>{copy.steps[step.key]}</span>
                            </>
                        );
                        const classes = cn(
                            "relative flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium whitespace-nowrap outline-focus-ring transition-[color,background-color,scale] duration-200 focus-visible:outline-2 active:scale-[0.96] sm:h-10 sm:px-3.5 sm:text-sm lg:h-9 lg:gap-1 lg:px-2.5 lg:text-[0.8125rem]",
                            lit ? "text-white" : "text-secondary hover:bg-[var(--hero-address)] hover:text-primary",
                        );
                        return (
                            <li key={step.key} data-step>
                                {step.href.startsWith("#") ? (
                                    <a href={step.href} className={classes} aria-current={lit ? "step" : undefined}>
                                        {inner}
                                    </a>
                                ) : (
                                    <Link to={step.href} className={classes} aria-current={lit ? "step" : undefined}>
                                        {inner}
                                    </Link>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </nav>
        </div>
    );
}
