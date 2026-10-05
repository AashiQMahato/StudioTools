import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils/cn";

const outlinePill =
    "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-primary bg-primary px-5 text-[0.9375rem] font-medium text-primary transition-[background-color,border-color,scale] duration-200 hover:border-[var(--brand-line)] hover:bg-[var(--brand-soft)] active:scale-[0.98] outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2";

/** The reference's secondary action: a quiet outline pill. */
export function OutlineLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
    return (
        <Link to={to} className={cn(outlinePill, className)}>
            {children}
        </Link>
    );
}
