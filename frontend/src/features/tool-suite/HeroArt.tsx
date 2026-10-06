import { Crop, FileText, Image as ImageIcon, UserRound, ZoomIn } from "lucide-react";
import type { ReactNode } from "react";

/*
 * The suite pages' hero pictures: a few tiles resting on a soft ring, with a handwritten note. Purely
 * decorative; they materialize once (no looping motion) and stay still. Hidden on small screens.
 */

const tile = "absolute rounded-2xl";
const paper = "border border-white/70 bg-white shadow-[0_20px_40px_-16px_rgb(30_41_59/0.35)] dark:border-white/10 dark:bg-[#1c1f2b]";

function ArtFrame({ note, children }: { note: string; children: ReactNode }) {
    return (
        <div aria-hidden className="relative mx-auto hidden aspect-[6/5] w-full max-w-[30rem] select-none lg:block">
            <div className="hero-art absolute inset-0">
                {/* The ring and its glow */}
                <div className="absolute inset-x-[6%] top-[38%] h-[44%] rotate-[-8deg] rounded-[50%] border border-[color-mix(in_srgb,#6366F1_30%,transparent)] bg-[radial-gradient(closest-side,rgb(129_140_248/0.22),transparent)]" />
                <div className="absolute top-[30%] left-[4%] size-16 rounded-full bg-[#7DD3FC]/45 blur-xl" />
                <div className="absolute right-[2%] bottom-[24%] size-20 rounded-full bg-[#C4B5FD]/50 blur-xl" />
                {children}
            </div>

            {/* The handwritten note and its arrow */}
            <p className="absolute -top-10 -right-12 w-44 rotate-[-8deg] text-center font-[Caveat,'Bradley_Hand','Segoe_Print',cursive] text-lg leading-snug text-tertiary">{note}</p>
            <svg viewBox="0 0 60 40" className="absolute -top-[1%] right-[27%] w-12 rotate-[-6deg] text-quaternary" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M56 6C40 4 22 10 10 30" />
                <path d="M6 20l4 11 11-3" />
            </svg>
        </div>
    );
}

/** A page of text, a photo, a PDF and an OCR frame. */
export function DocumentsArt({ note }: { note: string }) {
    return (
        <ArtFrame note={note}>
            <div className={`${tile} ${paper} top-[6%] left-[34%] h-[54%] w-[34%] rotate-[-10deg] p-[6%] shadow-[0_24px_48px_-20px_rgb(30_41_59/0.35)]`}>
                <span className="block font-serif text-[2.6rem] leading-none font-bold text-[#3B82F6]">T</span>
                <span className="mt-4 block h-2 w-[85%] rounded-full bg-[#BFDBFE] dark:bg-[#3B82F6]/40" />
                <span className="mt-2.5 block h-2 w-[70%] rounded-full bg-[#DBEAFE] dark:bg-[#3B82F6]/30" />
                <span className="mt-2.5 block h-2 w-[80%] rounded-full bg-[#BFDBFE] dark:bg-[#3B82F6]/40" />
                <span className="mt-2.5 block h-2 w-[55%] rounded-full bg-[#DBEAFE] dark:bg-[#3B82F6]/30" />
            </div>

            <div className={`${tile} top-[32%] left-[14%] grid h-[30%] w-[25%] rotate-[-14deg] place-items-center bg-linear-to-br from-[#60A5FA] to-[#2563EB] shadow-[0_20px_40px_-16px_rgb(37_99_235/0.55)] ring-4 ring-white dark:ring-[#1c1f2b]`}>
                <ImageIcon className="size-[45%] text-white" strokeWidth={1.6} />
            </div>

            <div className={`${tile} top-[14%] right-[8%] grid size-[24%] rotate-[12deg] place-items-center bg-linear-to-br from-[#FB7185] to-[#E11D48] shadow-[0_20px_40px_-16px_rgb(225_29_72/0.55)]`}>
                <span className="flex flex-col items-center text-white">
                    <FileText className="size-9" strokeWidth={1.6} />
                    <span className="mt-0.5 text-xs font-bold tracking-wider">PDF</span>
                </span>
            </div>

            <div className={`${tile} ${paper} bottom-[14%] left-[46%] grid size-[24%] rotate-[4deg] place-items-center`}>
                <Corners className="px-2 py-1 text-xl font-extrabold tracking-tight text-[#2563EB] dark:text-[#60A5FA]">OCR</Corners>
            </div>
        </ArtFrame>
    );
}

/** A photo, its cut-out on a transparent checkerboard, a 4× upscale chip and a crop frame. */
export function ImagesArt({ note }: { note: string }) {
    return (
        <ArtFrame note={note}>
            {/* The photo: a little landscape at golden hour */}
            <div className={`${tile} top-[8%] left-[30%] h-[52%] w-[40%] rotate-[-9deg] overflow-hidden ring-[6px] ring-white shadow-[0_24px_48px_-20px_rgb(30_41_59/0.45)] dark:ring-[#1c1f2b]`}>
                <div className="absolute inset-0 bg-linear-to-b from-[#FDE68A] via-[#F9A8D4] to-[#A5B4FC]" />
                <div className="absolute top-[22%] right-[20%] size-[22%] rounded-full bg-[#FEF3C7] shadow-[0_0_40px_rgb(254_243_199/0.9)]" />
                <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-[55%] w-full">
                    <path d="M0 60V38l22-20 16 14 20-24 42 34v18z" fill="#6366F1" opacity="0.85" />
                    <path d="M0 60V46l30-16 22 14 18-10 30 18v8z" fill="#4338CA" />
                </svg>
            </div>

            {/* The cut-out: the subject on a transparent checkerboard */}
            <div
                className={`${tile} top-[34%] left-[10%] grid h-[32%] w-[27%] rotate-[-14deg] place-items-end justify-center overflow-hidden ring-4 ring-white shadow-[0_20px_40px_-16px_rgb(124_58_237/0.5)] dark:ring-[#1c1f2b]`}
                style={{ backgroundColor: "#fff", backgroundImage: "conic-gradient(#e5e7eb 25%, transparent 0 50%, #e5e7eb 0 75%, transparent 0)", backgroundSize: "14px 14px" }}
            >
                <UserRound className="size-[80%] translate-y-[12%] text-[#8B5CF6]" strokeWidth={1.4} fill="#C4B5FD" />
            </div>

            {/* Upscale */}
            <div className={`${tile} top-[12%] right-[6%] grid size-[24%] rotate-[12deg] place-items-center bg-linear-to-br from-[#818CF8] to-[#6366F1] shadow-[0_20px_40px_-16px_rgb(99_102_241/0.6)]`}>
                <span className="flex flex-col items-center text-white">
                    <ZoomIn className="size-8" strokeWidth={1.8} />
                    <span className="mt-0.5 text-sm font-extrabold">4×</span>
                </span>
            </div>

            {/* Crop */}
            <div className={`${tile} ${paper} bottom-[13%] left-[48%] grid size-[24%] rotate-[4deg] place-items-center`}>
                <Corners className="p-2 text-[#10B981] dark:text-[#34D399]">
                    <Crop className="size-8" strokeWidth={1.8} />
                </Corners>
            </div>
        </ArtFrame>
    );
}

/** A selection frame: four corner marks around its content. */
function Corners({ className, children }: { className?: string; children: ReactNode }) {
    return (
        <span className={`relative ${className ?? ""}`}>
            <span className="absolute -top-1.5 -left-1.5 size-3 rounded-tl-md border-t-[3px] border-l-[3px] border-current" />
            <span className="absolute -top-1.5 -right-1.5 size-3 rounded-tr-md border-t-[3px] border-r-[3px] border-current" />
            <span className="absolute -bottom-1.5 -left-1.5 size-3 rounded-bl-md border-b-[3px] border-l-[3px] border-current" />
            <span className="absolute -right-1.5 -bottom-1.5 size-3 rounded-br-md border-r-[3px] border-b-[3px] border-current" />
            {children}
        </span>
    );
}
