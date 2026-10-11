import { Camera, CameraOff, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/base/buttons/button";
import { useT } from "@/i18n";

type CameraState = { kind: "starting" } | { kind: "live" } | { kind: "problem"; reason: "insecure" | "unsupported" | "denied" | "missing" | "failed" };

/** Why the camera can't be used yet, before asking for it. */
function blocker(): "insecure" | "unsupported" | null {
    if (!window.isSecureContext) return "insecure";
    if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
    return null;
}

/**
 * A live camera view with a shutter. Stays open for page after page; every capture becomes a page.
 * The camera is released whenever the dialog closes. Where the camera can't be used, it says why and
 * offers the phone's own camera app instead.
 */
export function CameraDialog({ onClose, onCapture, onCameraApp }: { onClose: () => void; onCapture: (file: File) => void; onCameraApp: () => void }) {
    const t = useT();
    const copy = t.scanner.camera;
    const video = useRef<HTMLVideoElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const [state, setState] = useState<CameraState>(() => {
        const reason = blocker();
        return reason ? { kind: "problem", reason } : { kind: "starting" };
    });
    const [captured, setCaptured] = useState(0);
    const [flash, setFlash] = useState(false);

    useEffect(() => {
        if (blocker()) return;
        let stream: MediaStream | null = null;
        let cancelled = false;
        navigator.mediaDevices
            .getUserMedia({ video: { facingMode: "environment", width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false })
            .then(async (media) => {
                stream = media;
                if (cancelled || !video.current) return media.getTracks().forEach((track) => track.stop());
                video.current.srcObject = media;
                await video.current.play().catch(() => undefined);
                setState({ kind: "live" });
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                const name = error instanceof DOMException ? error.name : "";
                setState({ kind: "problem", reason: name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" || name === "OverconstrainedError" ? "missing" : "failed" });
            });
        return () => {
            cancelled = true;
            stream?.getTracks().forEach((track) => track.stop());
        };
    }, []);

    useEffect(() => {
        const returnTo = document.activeElement as HTMLElement | null;
        closeRef.current?.focus();
        const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("keydown", onKey);
            returnTo?.focus?.();
        };
    }, [onClose]);

    const capture = () => {
        const source = video.current;
        if (!source?.videoWidth) return;
        const canvas = document.createElement("canvas");
        canvas.width = source.videoWidth;
        canvas.height = source.videoHeight;
        canvas.getContext("2d")!.drawImage(source, 0, 0);
        canvas.toBlob(
            (blob) => {
                if (!blob) return;
                setCaptured((count) => count + 1);
                onCapture(new File([blob], `scan-${Date.now()}.jpg`, { type: "image/jpeg" }));
            },
            "image/jpeg",
            0.95,
        );
        // A brief white flash says "taken" (a cross-fade, so it's fine with reduced motion too).
        setFlash(true);
        window.setTimeout(() => setFlash(false), 120);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
            <div aria-hidden className="absolute inset-0 bg-neutral-950/60" onClick={onClose} />
            <div role="dialog" aria-modal="true" aria-labelledby="scanner-camera-title" className="relative flex max-h-dvh w-full max-w-2xl flex-col overflow-hidden bg-primary sm:rounded-2xl sm:border sm:border-[var(--card-line)]">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--card-line)] px-4 py-2">
                    <h2 id="scanner-camera-title" className="text-md font-semibold text-primary">
                        {copy.title}
                    </h2>
                    <button ref={closeRef} type="button" onClick={onClose} aria-label={copy.close} className="grid size-10 cursor-pointer place-items-center rounded-lg text-secondary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 pointer-coarse:size-11">
                        <X className="size-5" aria-hidden />
                    </button>
                </div>

                <div className="relative grid min-h-[16rem] flex-1 place-items-center bg-neutral-950">
                    {/* Kept mounted so the stream has somewhere to go as soon as it starts. */}
                    <video ref={video} playsInline muted aria-label={copy.preview} className={state.kind === "live" ? "max-h-[65dvh] w-full object-contain" : "hidden"} />
                    <span aria-hidden className={`pointer-events-none absolute inset-0 bg-white transition-opacity duration-150 ${flash ? "opacity-70" : "opacity-0"}`} />
                    {state.kind === "starting" && (
                        <p role="status" className="flex items-center gap-2 text-sm text-white/80">
                            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                            {copy.starting}
                        </p>
                    )}
                    {state.kind === "problem" && (
                        <div role="alert" className="flex max-w-sm flex-col items-center gap-3 p-6 text-center">
                            <CameraOff className="size-8 text-white/70" aria-hidden />
                            <p className="text-md font-semibold text-white">{copy.problems[state.reason].title}</p>
                            <p className="text-sm text-white/70">{copy.problems[state.reason].detail}</p>
                        </div>
                    )}
                </div>

                <div className="flex flex-col-reverse gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center">
                    <Button size="md" color="secondary" onPress={onCameraApp} className="pointer-coarse:min-h-11">
                        {copy.cameraApp}
                    </Button>
                    <span role="status" className="text-sm text-tertiary tabular-nums sm:ml-auto">
                        {captured > 0 && copy.captured(captured)}
                    </span>
                    {captured > 0 && (
                        <Button size="md" color="secondary" onPress={onClose} className="pointer-coarse:min-h-11">
                            {copy.done}
                        </Button>
                    )}
                    <Button size="lg" color="primary" iconLeading={Camera} onPress={capture} isDisabled={state.kind !== "live"} className="press-scale pointer-coarse:min-h-12">
                        {copy.capture}
                    </Button>
                </div>
            </div>
        </div>
    );
}
