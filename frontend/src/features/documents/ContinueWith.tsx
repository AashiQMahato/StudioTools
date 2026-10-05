import { ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TOOL_ICONS } from "@/components/layout/toolIcons";
import { ORGANIZE_MODES, type ToolKey } from "@/lib/constants/navigation";
import { TOOL_CATALOG } from "@/lib/constants/toolCatalog";
import { cn } from "@/lib/utils/cn";
import { useHandoff } from "@/store/useHandoff";
import { useT } from "@/i18n";
import { type HandoffKind, NEXT } from "./handoff";

/**
 * "Continue with…": the result opened straight in the next tool — no download, no upload from the
 * device. The files move in memory, never stored.
 */
/** Shown before "More tools". */
const FIRST = 5;

/** One list row. Feedback is on press (no delay), the highlight eases out on release. */
const ROW =
    "relative flex min-h-11 w-full cursor-pointer items-center gap-3 px-3 py-2 text-left outline-focus-ring -outline-offset-2 transition-colors duration-150 hover:bg-primary_hover focus-visible:outline-2 active:bg-secondary active:duration-0 disabled:cursor-wait disabled:opacity-70";

/** The hairline between rows, inset to the label like a grouped list. */
function Separator() {
    return <span aria-hidden className="pointer-events-none absolute top-0 right-0 left-[3.25rem] h-px bg-[var(--card-line)]" />;
}

export function ContinueWith({ kind, current, files, className }: { kind: HandoffKind; current: ToolKey; files: () => Promise<File[]>; className?: string }) {
    const t = useT();
    const copy = t.documents.handoff;
    const navigate = useNavigate();
    const [busy, setBusy] = useState<ToolKey | null>(null);
    const [failed, setFailed] = useState(false);
    const [more, setMore] = useState(false);
    const titleId = useId();
    // Organize PDF's modes are pages of one feature, not catalog entries of their own.
    const destinations = [...TOOL_CATALOG, ...ORGANIZE_MODES];
    const tools = NEXT[kind].filter((key) => key !== current).flatMap((key) => destinations.filter((tool) => tool.key === key).slice(0, 1));
    if (!tools.length) return null;
    const shown = more ? tools : tools.slice(0, FIRST);

    const go = async (key: ToolKey, href: string) => {
        setBusy(key);
        setFailed(false);
        try {
            useHandoff.getState().send(await files(), current);
            navigate(href);
        } catch {
            setFailed(true);
            setBusy(null);
        }
    };

    return (
        <section aria-labelledby={titleId} className={cn("flex flex-col gap-3", className)}>
            <h3 id={titleId} className="text-sm font-semibold text-primary">
                {copy.title}
            </h3>
            {/* A grouped list, not a grid: one row per tool, so names never wrap at any panel width. */}
            <ul className="overflow-hidden rounded-xl border border-[var(--card-line)] bg-primary">
                {shown.map((tool, index) => {
                    const Icon = TOOL_ICONS[tool.key];
                    return (
                        <li key={tool.key}>
                            <button type="button" disabled={busy !== null} onClick={() => void go(tool.key, tool.href)} className={ROW}>
                                {index > 0 && <Separator />}
                                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-secondary text-secondary">
                                    {busy === tool.key ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Icon className="size-4" aria-hidden />}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">{t.nav.toolItems[tool.key].title}</span>
                                <ChevronRight className="size-4 shrink-0 text-quaternary" aria-hidden />
                            </button>
                        </li>
                    );
                })}
                {tools.length > FIRST && (
                    <li>
                        <button type="button" onClick={() => setMore((value) => !value)} aria-expanded={more} className={cn(ROW, "text-sm font-medium text-[var(--brand)]")}>
                            <Separator />
                            <span className="grid size-7 shrink-0 place-items-center">
                                <ChevronDown className={cn("size-4 transition-transform duration-300 ease-[var(--ease-spring)] motion-reduce:transition-none", more && "rotate-180")} aria-hidden />
                            </span>
                            <span className="flex-1">{more ? copy.fewer : copy.more(tools.length - FIRST)}</span>
                        </button>
                    </li>
                )}
            </ul>
            {failed && (
                <p role="alert" className="px-1 text-xs text-error-primary">
                    {copy.failed}
                </p>
            )}
            <p className="px-1 text-xs leading-relaxed text-tertiary">{copy.note}</p>
        </section>
    );
}
