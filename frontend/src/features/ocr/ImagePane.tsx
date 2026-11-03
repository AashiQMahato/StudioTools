import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";
import { Fitted } from "@/components/studio/StudioParts";
import type { Box, DocBlock, OcrRegion } from "@/lib/api/ocrApi";
import { cn } from "@/lib/utils/cn";
import type { RegionTool } from "./settings";


/** The server accepts up to 2000 points; a freehand outline never needs that many. */
const MAX_POINTS = 600;

interface ImagePaneProps {
    src: string;
    alt: string;
    size: { width: number; height: number };
    /** Drawing the area to read (rect / free); "full" draws nothing. */
    tool: RegionTool;
    region: OcrRegion | null;
    onRegion: (region: OcrRegion | null) => void;
    /** The recognised blocks, outlined where they are (after a reading). */
    blocks?: readonly DocBlock[];
    /** Where the blocks' coordinates start (the region that was read). */
    offset?: Box | null;
    activeBlock?: string | null;
    onBlockClick?: (id: string) => void;
}

/** A path for the area outside a region (the dimmed part), from the image's edge inwards. */
function outsidePath(region: OcrRegion, width: number, height: number) {
    const outer = `M0,0H${width}V${height}H0Z`;
    if (region.type === "rect") {
        const { x, y, width: w, height: h } = region.box;
        return `${outer} M${x},${y}h${w}v${h}h${-w}Z`;
    }
    return `${outer} M${region.points.map(([x, y]) => `${x},${y}`).join(" L")}Z`;
}

/**
 * The original image, fitted to the pane. Before reading it's where the area to read is drawn (a
 * rectangle, or freehand); after, each recognised block is outlined, and choosing one jumps to it
 * in the editor. Coordinates are the image's own pixels.
 */
export function ImagePane({ src, alt, size, tool, region, onRegion, blocks, offset, activeBlock, onBlockClick }: ImagePaneProps) {
    const { width, height } = size;
    const svgRef = useRef<SVGSVGElement>(null);
    const [draft, setDraft] = useState<OcrRegion | null>(null);
    const start = useRef<[number, number] | null>(null);
    const drawing = tool !== "full";

    const toImage = (event: ReactPointerEvent): [number, number] => {
        const rect = svgRef.current!.getBoundingClientRect();
        return [Math.min(width, Math.max(0, ((event.clientX - rect.left) / rect.width) * width)), Math.min(height, Math.max(0, ((event.clientY - rect.top) / rect.height) * height))];
    };
    const onDown = (event: ReactPointerEvent<SVGSVGElement>) => {
        if (!drawing || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = toImage(event);
        start.current = point;
        setDraft(tool === "rect" ? { type: "rect", box: { x: point[0], y: point[1], width: 0, height: 0 } } : { type: "polygon", points: [point] });
    };
    const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
        if (!start.current || !draft) return;
        const point = toImage(event);
        if (draft.type === "rect") {
            const [x0, y0] = start.current;
            setDraft({ type: "rect", box: { x: Math.min(x0, point[0]), y: Math.min(y0, point[1]), width: Math.abs(point[0] - x0), height: Math.abs(point[1] - y0) } });
        } else {
            const last = draft.points.at(-1)!;
            // A point every few screen pixels is plenty for an outline.
            const rect = svgRef.current!.getBoundingClientRect();
            if (Math.hypot(point[0] - last[0], point[1] - last[1]) * (rect.width / width) >= 3) setDraft({ type: "polygon", points: [...draft.points, point] });
        }
    };
    const onUp = () => {
        if (!start.current) return;
        start.current = null;
        const shape = draft;
        setDraft(null);
        if (!shape) return;
        const minimum = Math.max(8, Math.min(width, height) * 0.01);
        if (shape.type === "rect") {
            onRegion(shape.box.width >= minimum && shape.box.height >= minimum ? { type: "rect", box: roundBox(shape.box) } : null);
            return;
        }
        const xs = shape.points.map(([x]) => x);
        const ys = shape.points.map(([, y]) => y);
        const big = Math.max(...xs) - Math.min(...xs) >= minimum && Math.max(...ys) - Math.min(...ys) >= minimum;
        if (shape.points.length < 3 || !big) return onRegion(null);
        const stride = Math.ceil(shape.points.length / MAX_POINTS);
        onRegion({ type: "polygon", points: shape.points.filter((_, index) => index % stride === 0).map(([x, y]) => [Math.round(x), Math.round(y)]) });
    };

    const shown = draft ?? region;
    const stroke = Math.max(width, height) / 400;

    return (
        <Fitted dimensions={size}>
            {(fit) => (
                <div className="relative overflow-hidden rounded-lg shadow-sm" style={fit}>
                    <img src={src} alt={alt} className="absolute inset-0 size-full select-none" draggable={false} />
                    <svg
                        ref={svgRef}
                        viewBox={`0 0 ${width} ${height}`}
                        preserveAspectRatio="none"
                        className={cn("absolute inset-0 size-full", drawing && "cursor-crosshair touch-none")}
                        onPointerDown={onDown}
                        onPointerMove={onMove}
                        onPointerUp={onUp}
                        onPointerCancel={onUp}
                    >
                        {shown && (
                            <>
                                <path d={outsidePath(shown, width, height)} fillRule="evenodd" fill="rgb(9 9 11 / 0.45)" />
                                {shown.type === "rect" ? (
                                    <rect x={shown.box.x} y={shown.box.y} width={shown.box.width} height={shown.box.height} fill="none" stroke="white" strokeWidth={stroke} strokeDasharray={`${stroke * 4} ${stroke * 3}`} />
                                ) : (
                                    <polygon points={shown.points.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="white" strokeWidth={stroke} strokeLinejoin="round" />
                                )}
                            </>
                        )}
                        {!drawing &&
                            blocks?.map((block) => {
                                const x = block.bbox.x + (offset?.x ?? 0);
                                const y = block.bbox.y + (offset?.y ?? 0);
                                const active = block.id === activeBlock;
                                const pad = stroke * 2;
                                return (
                                    <rect
                                        key={block.id}
                                        x={x - pad}
                                        y={y - pad}
                                        width={block.bbox.width + pad * 2}
                                        height={block.bbox.height + pad * 2}
                                        rx={stroke * 2}
                                        fill={active ? "rgb(37 99 235 / 0.14)" : "transparent"}
                                        stroke={active ? "rgb(37 99 235)" : "rgb(37 99 235 / 0.4)"}
                                        strokeWidth={active ? stroke * 1.5 : stroke}
                                        className={cn(onBlockClick && "cursor-pointer hover:fill-[rgb(83_103_232/0.08)]")}
                                        onClick={() => onBlockClick?.(block.id)}
                                    />
                                );
                            })}
                    </svg>
                </div>
            )}
        </Fitted>
    );
}

const roundBox = (box: Box): Box => ({ x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) });
