import { useEffect, useState } from "react";
import { ImageProcessingPreview } from "@/components/studio/ImageProcessingPreview";
import type { FrameSize } from "@/features/retouch/ImageCanvas";
import { useT } from "@/i18n";

/** How long "Analyzing image" shows before the second stage; the last waits for the real result. */
const FIRST_STAGE_MS = 900;

/**
 * While detection runs: the shared processing effect (as in Remove Background) over the photo, and the
 * words say what's happening. No progress numbers — the server doesn't report any.
 */
export function AnalyzingOverlay({ src, alt, frame }: { src: string; alt: string; frame: FrameSize }) {
    const t = useT();
    const stages = t.watermark.analyzing;
    const [stage, setStage] = useState(0);
    useEffect(() => {
        const timer = window.setTimeout(() => setStage(1), FIRST_STAGE_MS);
        return () => window.clearTimeout(timer);
    }, []);
    return (
        <div className="absolute inset-0">
            <ImageProcessingPreview src={src} alt={alt} size={frame} status="processing" label={stages[stage]} className="rounded-none" />
        </div>
    );
}
