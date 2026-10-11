import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { Fitted } from "@/components/studio/StudioParts";
import { useSprings } from "@/features/editor/spring";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";
import type { Point, Quad } from "./geometry";

interface CornerEditorProps {
    src: string;
    alt: string;
    width: number;
    height: number;
    quad: Quad;
    /** `when`: render now (a drag ended), once nudges settle (keys), or not yet (mid-drag). */
    onChange: (quad: Quad, when: "now" | "settle" | "never") => void;
}

const KEYS = ["x0", "y0", "x1", "y1", "x2", "y2", "x3", "y3"] as const;
type Key = (typeof KEYS)[number];
const flatten = (quad: Quad) => Object.fromEntries(quad.flatMap((p, i) => [[`x${i}`, p.x], [`y${i}`, p.y]])) as Record<Key, number>;
const LOUPE = 120;
const ZOOM = 3;

/**
 * The photo with the page's outline over it and a handle on each corner. Handles follow the pointer
 * 1:1 from wherever they were grabbed, show a magnifier while dragging, and move with arrow keys.
 */
export function CornerEditor({ src, alt, width, height, quad, onChange }: CornerEditorProps) {
    return <Fitted dimensions={{ width, height }}>{(size) => <Editor src={src} alt={alt} width={width} height={height} quad={quad} onChange={onChange} size={size} />}</Fitted>;
}

function Editor({ src, alt, width, height, quad, onChange, size }: CornerEditorProps & { size: { width: number; height: number } }) {
    const t = useT();
    const copy = t.scanner;
    const reduced = usePrefersReducedMotion();
    const surface = useRef<HTMLDivElement>(null);
    const grab = useRef({ dx: 0, dy: 0 });
    const [active, setActive] = useState<number | null>(null);
    const scale = size.width / width;

    // The outline glides to corners set from outside (auto-detect, full image) and tracks the hand exactly.
    const { values, set, jump } = useSprings(flatten(quad), reduced);
    const fromHand = useRef(false);
    const seen = useRef(quad);
    useEffect(() => {
        // Only on a real change: starting a spring on mount would leave its frame cancelled by StrictMode's remount.
        if (seen.current === quad) return;
        seen.current = quad;
        if (fromHand.current) jump(flatten(quad));
        else set(flatten(quad));
        fromHand.current = false;
    }, [quad, set, jump]);
    const shown: Point[] = [0, 1, 2, 3].map((i) => ({ x: values[`x${i}` as Key] * scale, y: values[`y${i}` as Key] * scale }));

    const move = (index: number, point: Point, when: "now" | "settle" | "never") => {
        const next = quad.map((p, i) => (i === index ? { x: Math.min(width, Math.max(0, point.x)), y: Math.min(height, Math.max(0, point.y)) } : p)) as Quad;
        fromHand.current = true;
        onChange(next, when);
    };

    const onPointerDown = (event: PointerEvent<HTMLButtonElement>, index: number) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const rect = surface.current!.getBoundingClientRect();
        grab.current = { dx: event.clientX - (rect.left + quad[index]!.x * scale), dy: event.clientY - (rect.top + quad[index]!.y * scale) };
        setActive(index);
    };
    const onPointerMove = (event: PointerEvent<HTMLButtonElement>, index: number) => {
        if (active !== index) return;
        const rect = surface.current!.getBoundingClientRect();
        move(index, { x: (event.clientX - grab.current.dx - rect.left) / scale, y: (event.clientY - grab.current.dy - rect.top) / scale }, "never");
    };
    const onPointerUp = () => {
        if (active === null) return;
        setActive(null);
        onChange(quad, "now");
    };
    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const step = (event.shiftKey ? 10 : 1) / scale;
        const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
        if (!delta) return;
        event.preventDefault();
        move(index, { x: quad[index]!.x + delta[0]!, y: quad[index]!.y + delta[1]! }, "settle");
    };

    const outline = shown.map((p) => `${p.x},${p.y}`).join(" ");
    const loupeAt = active === null ? null : shown[active]!;

    return (
        // Out of flow and centred, so the fitted area can shrink as well as grow.
        <div ref={surface} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 touch-none select-none" style={size}>
            <img src={src} alt={alt} draggable={false} className="absolute inset-0 size-full rounded-md object-fill" />
            <svg aria-hidden className="pointer-events-none absolute inset-0 overflow-visible" width={size.width} height={size.height}>
                <path d={`M0 0H${size.width}V${size.height}H0Z M${outline.replaceAll(" ", " L")}Z`} fillRule="evenodd" fill="rgb(10 10 20 / 0.45)" />
                <polygon points={outline} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinejoin="round" />
            </svg>
            {shown.map((p, index) => (
                <button
                    key={index}
                    type="button"
                    aria-label={copy.corners[index]!}
                    aria-describedby="scanner-corner-hint"
                    onPointerDown={(event) => onPointerDown(event, index)}
                    onPointerMove={(event) => onPointerMove(event, index)}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onKeyDown={(event) => onKeyDown(event, index)}
                    className="group absolute grid size-9 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none place-items-center rounded-full outline-none active:cursor-grabbing pointer-coarse:size-12"
                    style={{ left: p.x, top: p.y }}
                >
                    <span
                        className={cn(
                            "block size-4 rounded-full border-2 border-[var(--brand)] bg-white shadow-sm transition-transform duration-150 group-focus-visible:ring-4 group-focus-visible:ring-[var(--color-focus-ring)] motion-reduce:transition-none pointer-coarse:size-5",
                            active === index && "scale-125",
                        )}
                    />
                </button>
            ))}
            <p id="scanner-corner-hint" className="sr-only">
                {copy.cornerKeys}
            </p>
            {loupeAt && (
                <div
                    aria-hidden
                    className="pointer-events-none absolute overflow-hidden rounded-full border-2 border-white bg-secondary shadow-lg ring-1 ring-[var(--card-line)]"
                    style={{
                        width: LOUPE,
                        height: LOUPE,
                        left: Math.min(size.width - LOUPE / 2, Math.max(LOUPE / 2, loupeAt.x)) - LOUPE / 2,
                        // Above the finger, or below it near the top edge.
                        top: loupeAt.y > LOUPE + 40 ? loupeAt.y - LOUPE - 40 : loupeAt.y + 40,
                        backgroundImage: `url("${src}")`,
                        backgroundSize: `${size.width * ZOOM}px ${size.height * ZOOM}px`,
                        backgroundPosition: `${LOUPE / 2 - loupeAt.x * ZOOM}px ${LOUPE / 2 - loupeAt.y * ZOOM}px`,
                        backgroundRepeat: "no-repeat",
                    }}
                >
                    <span className="absolute top-1/2 left-0 h-px w-full bg-[var(--brand)]" />
                    <span className="absolute top-0 left-1/2 h-full w-px bg-[var(--brand)]" />
                </div>
            )}
        </div>
    );
}
