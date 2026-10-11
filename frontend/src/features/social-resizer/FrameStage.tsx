import { type KeyboardEvent, type PointerEvent, useEffect, useId, useRef, useState } from "react";
import { rubberband } from "@/features/editor/spring";
import { useFitSize } from "@/hooks/useFitSize";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";
import { baseScale, clampView, clampZoom, type FitMode, focalRange, placement, type Size, type View, zoomAbout } from "./frame";
import type { SafeArea } from "./presets";
import type { Background } from "./render";

interface FrameStageProps {
    src: string;
    image: Size;
    target: Size;
    mode: FitMode;
    background: Background;
    /** What's on screen now (may be mid-spring). */
    view: View;
    /** Where the view is heading. */
    goal: View;
    /** Follow a gesture 1:1. */
    jump: (view: View) => void;
    /** Animate to a view (springs back from a rubber-banded edge). */
    animate: (view: View) => void;
    onReset: () => void;
    safe?: SafeArea;
    circle?: boolean;
    showSafe: boolean;
}

interface Gesture {
    view: View;
    /** Centroid of the pointers, client px. */
    x: number;
    y: number;
    distance: number;
}

const centroid = (points: Map<number, { x: number; y: number }>) => {
    const list = [...points.values()];
    const x = list.reduce((sum, point) => sum + point.x, 0) / list.length;
    const y = list.reduce((sum, point) => sum + point.y, 0) / list.length;
    const [a, b] = list;
    return { x, y, distance: a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0 };
};

/**
 * The target frame at its exact ratio, with the photo inside it. Drag to pan (1:1, rubber-banded at the
 * edges in Fill), pinch or scroll to zoom about the fingers / pointer, arrow keys to nudge. The part of the
 * photo outside the frame shows faintly, so you can see what's being cropped.
 */
export function FrameStage({ src, image, target, mode, background, view, goal, jump, animate, onReset, safe, circle, showSafe }: FrameStageProps) {
    const t = useT();
    const copy = t.socialResizer;
    const helpId = useId();
    const areaRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLDivElement>(null);
    const size = useFitSize(areaRef, target.width / target.height);
    const display = size ? size.width / target.width : 0;
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const gesture = useRef<Gesture | null>(null);
    const live = useRef(view);
    const [dragging, setDragging] = useState(false);

    // Latest props for the wheel listener, which is attached once.
    const latest = useRef({ goal, image, target, mode, display, jump });
    useEffect(() => {
        latest.current = { goal, image, target, mode, display, jump };
    });

    /** Client point → offset from the frame's centre, in target px. */
    const fromCentre = (x: number, y: number, scaleToTarget: number) => {
        const rect = frameRef.current?.getBoundingClientRect();
        if (!rect || !scaleToTarget) return { x: 0, y: 0 };
        return { x: (x - rect.left - rect.width / 2) / scaleToTarget, y: (y - rect.top - rect.height / 2) / scaleToTarget };
    };

    const begin = () => {
        const point = centroid(pointers.current);
        gesture.current = { view: live.current, ...point };
    };

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button > 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        // Catch the image wherever it is mid-spring: the gesture starts from what's on screen.
        live.current = view;
        jump(view);
        begin();
        setDragging(true);
    };

    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        if (!pointers.current.has(event.pointerId) || !gesture.current) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const start = gesture.current;
        const now = centroid(pointers.current);
        const zoom = clampZoom(start.distance && now.distance ? (start.view.zoom * now.distance) / start.distance : start.view.zoom);
        const base = baseScale(image, target, mode);
        const before = base * start.view.zoom;
        const after = base * zoom;
        // The image point under where the fingers started stays under the fingers.
        const from = fromCentre(start.x, start.y, display);
        const to = fromCentre(now.x, now.y, display);
        const raw = { fx: start.view.fx + from.x / before - to.x / after, fy: start.view.fy + from.y / before - to.y / after, zoom };
        const next = mode === "fill" ? resist(raw, after) : clampView(raw, image, target, mode);
        live.current = next;
        jump(next);
    };

    /** Past the edge, the image follows with growing resistance (screen px), then springs back on release. */
    const resist = (raw: View, scale: number): View => {
        const clamped = clampView(raw, image, target, mode);
        const toScreen = scale * display;
        if (!toScreen || !size) return clamped;
        const [minX, maxX] = focalRange(image.width, target.width, scale);
        const [minY, maxY] = focalRange(image.height, target.height, scale);
        const band = (value: number, min: number, max: number, dimension: number) => {
            const over = value < min ? value - min : value > max ? value - max : 0;
            return Math.min(max, Math.max(min, value)) + rubberband(over * toScreen, dimension) / toScreen;
        };
        return { zoom: clamped.zoom, fx: band(raw.fx, minX, maxX, size.width), fy: band(raw.fy, minY, maxY, size.height) };
    };

    const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
        if (!pointers.current.delete(event.pointerId)) return;
        if (pointers.current.size) return begin(); // one finger lifted: carry on panning with the rest
        gesture.current = null;
        setDragging(false);
        animate(clampView(live.current, image, target, mode));
    };

    // Wheel / trackpad pinch zoom about the pointer. Not a React handler: it must be non-passive to stop the page scrolling.
    useEffect(() => {
        const area = areaRef.current;
        if (!area) return;
        const onWheel = (event: WheelEvent) => {
            const { goal: current, image: img, target: frame, mode: fit, display: scaleToTarget, jump: move } = latest.current;
            event.preventDefault();
            // Trackpad pinches arrive as ctrl+wheel with small deltas.
            const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
            const point = fromCentre(event.clientX, event.clientY, scaleToTarget);
            move(clampView(zoomAbout(current, current.zoom * factor, point, img, frame, fit), img, frame, fit));
        };
        area.addEventListener("wheel", onWheel, { passive: false });
        return () => area.removeEventListener("wheel", onWheel);
    }, []);

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const scale = baseScale(image, target, mode) * goal.zoom * display;
        if (!scale) return;
        const step = (event.shiftKey ? 50 : 10) / scale; // screen px → image px
        const moves: Record<string, Partial<View>> = {
            ArrowLeft: { fx: goal.fx + step },
            ArrowRight: { fx: goal.fx - step },
            ArrowUp: { fy: goal.fy + step },
            ArrowDown: { fy: goal.fy - step },
            "+": { zoom: goal.zoom * 1.2 },
            "=": { zoom: goal.zoom * 1.2 },
            "-": { zoom: goal.zoom / 1.2 },
        };
        if (event.key === "0") {
            event.preventDefault();
            return onReset();
        }
        const move = moves[event.key];
        if (!move) return;
        event.preventDefault();
        animate(clampView({ ...goal, ...move }, image, target, mode));
    };

    const place = placement(view, image, target, mode);
    const imageStyle = { width: place.width * display, height: place.height * display, transform: `translate3d(${place.x * display}px, ${place.y * display}px, 0)` };
    const blurred = background.kind === "blur";

    return (
        <div className="flex flex-1 p-6 sm:p-10 lg:min-h-0">
            <div
                ref={areaRef}
                tabIndex={0}
                role="group"
                aria-roledescription="canvas"
                aria-label={copy.stage(target.width, target.height)}
                aria-describedby={helpId}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onKeyDown={onKeyDown}
                className={cn("relative flex min-h-0 flex-1 touch-none items-center justify-center rounded-lg outline-none select-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]", dragging ? "cursor-grabbing" : "cursor-grab")}
            >
                <span id={helpId} className="sr-only">
                    {copy.stageHelp}
                </span>
                {size && (
                    <div ref={frameRef} className="relative" style={size}>
                        {/* What falls outside the frame, faintly: you see what you're cropping. */}
                        <img src={src} alt="" aria-hidden draggable={false} className="pointer-events-none absolute top-0 left-0 max-w-none opacity-20" style={imageStyle} />
                        <div
                            className={cn("absolute inset-0 overflow-hidden ring-1 transition-shadow duration-150", dragging ? "ring-2 ring-[var(--brand)]" : "ring-[var(--card-line)]")}
                            style={{ background: background.kind === "color" ? background.color : undefined }}
                        >
                            {blurred && (
                                <>
                                    <img src={src} alt="" aria-hidden draggable={false} className="pointer-events-none absolute inset-0 size-full scale-110 object-cover blur-2xl" />
                                    <span aria-hidden className="absolute inset-0 bg-white/12" />
                                </>
                            )}
                            <img src={src} alt="" aria-hidden draggable={false} className="pointer-events-none absolute top-0 left-0 max-w-none" style={imageStyle} />
                            {showSafe && circle && <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full border border-dashed border-white/90 shadow-[0_0_0_9999px_rgb(0_0_0/0.4)]" />}
                            {showSafe && safe && (
                                <span
                                    aria-hidden
                                    className="pointer-events-none absolute border border-dashed border-white/90 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]"
                                    style={{ top: `${safe.top * 100}%`, right: `${safe.right * 100}%`, bottom: `${safe.bottom * 100}%`, left: `${safe.left * 100}%` }}
                                />
                            )}
                        </div>
                        <span className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 rounded-full text-xs font-medium whitespace-nowrap text-tertiary tabular-nums">
                            {target.width.toLocaleString("en-US")} × {target.height.toLocaleString("en-US")} px
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
