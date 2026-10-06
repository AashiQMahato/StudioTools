import logo128 from "@/assets/brand/logo-128.png";
import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/constants/routes";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";

/** The brand mark (transparent PNG, sharp up to 64 px on 2× screens). */
export function LogoMark({ className }: { className?: string }) {
    return <img src={logo128} alt="" aria-hidden width={128} height={128} draggable={false} className={cn("size-7 shrink-0 select-none", className)} />;
}

/**
 * The wordmark as real text: the first word in the primary text colour, the rest with the logo's
 * cyan → blue → violet gradient (sampled from the logo artwork; a touch lighter in dark mode).
 */
export function Wordmark({ name, className }: { name: string; className?: string }) {
    const split = name.indexOf(" ");
    const first = split === -1 ? name : name.slice(0, split);
    const rest = split === -1 ? "" : name.slice(split + 1);
    return (
        <span className={cn("whitespace-nowrap font-bold tracking-[-0.025em] text-primary", className)}>
            {first}
            {rest && (
                <>
                    {/* Keeps the space in the accessible name / copied text without widening the wordmark. */}
                    <span className="sr-only"> </span>
                    <span className="bg-linear-to-r from-[#00A8FB] via-[#1A63FB] to-[#723FEF] bg-clip-text text-transparent dark:from-[#22B8FF] dark:via-[#4F86FF] dark:to-[#9B6BFF]">
                        {rest}
                    </span>
                </>
            )}
        </span>
    );
}

export function Logo({ className }: { className?: string }) {
    const t = useT();
    return (
        <Link
            to={ROUTES.home}
            aria-label={t.common.homeAria}
            className={cn(
                "flex items-center gap-2 rounded-md text-md text-primary outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-4",
                className,
            )}
        >
            <LogoMark />
            <Wordmark name={t.common.appName} />
        </Link>
    );
}
