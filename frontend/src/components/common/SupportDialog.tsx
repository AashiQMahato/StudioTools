import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import qr from "@/assets/support/esewa-qr.png";
import { useSupport } from "@/store/useSupport";
import { useT } from "@/i18n";

/** The four scanner corners that frame the code (inside the QR's own quiet zone, so they never touch it). */
const corners = ["top-4 left-4 border-t-2 border-l-2 rounded-tl-xl", "top-4 right-4 border-t-2 border-r-2 rounded-tr-xl", "bottom-4 left-4 border-b-2 border-l-2 rounded-bl-xl", "bottom-4 right-4 border-b-2 border-r-2 rounded-br-xl"];

/**
 * The support dialog: just the eSewa QR, on a white tile with a soft colour glow and scanner corners, over a
 * blurred page (native <dialog>: focus is trapped, Escape closes, focus returns to the button that opened it).
 */
export function SupportDialog() {
    const t = useT();
    const copy = t.support;
    const open = useSupport((state) => state.open);
    const setOpen = useSupport((state) => state.setOpen);
    const dialog = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        if (open && !element.open) element.showModal();
        if (!open && element.open) element.close();
    }, [open]);

    return (
        <dialog
            ref={dialog}
            aria-label={copy.label}
            onClose={() => setOpen(false)}
            // A press on the backdrop (the dialog element itself, outside the card) closes it.
            onClick={(event) => event.target === event.currentTarget && setOpen(false)}
            className="m-auto w-[min(21rem,calc(100vw-2.5rem))] overflow-visible bg-transparent p-0 backdrop:bg-neutral-950/55 backdrop:backdrop-blur-md"
        >
            <div className="animate-enter relative isolate [--i:-1]">
                <span aria-hidden className="absolute -inset-3 -z-10 rounded-[2.5rem] bg-[conic-gradient(from_0deg,#14E6FF,#2F6BFF,#8A1CFF,#14E6FF)] opacity-70 blur-2xl motion-safe:animate-[spin_9s_linear_infinite]" />
                <div className="relative rounded-[1.75rem] bg-white p-3 shadow-2xl ring-1 ring-white/40">
                    <img src={qr} alt={copy.label} width={772} height={772} draggable={false} className="block aspect-square w-full rounded-2xl select-none" />
                    {corners.map((position) => (
                        <span key={position} aria-hidden className={`absolute size-6 border-[#2F6BFF] motion-safe:animate-pulse ${position}`} />
                    ))}
                </div>
                <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label={copy.close}
                    className="press-scale absolute -top-4 -right-4 grid size-10 cursor-pointer place-items-center rounded-full bg-neutral-900/80 text-white shadow-lg ring-1 ring-white/25 backdrop-blur-xl outline-focus-ring transition-colors duration-150 hover:bg-neutral-900 focus-visible:outline-2 pointer-coarse:size-11"
                >
                    <X className="size-4" strokeWidth={2.25} aria-hidden />
                </button>
            </div>
        </dialog>
    );
}
