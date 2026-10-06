import { ArrowRight, LayoutGrid, type LucideIcon, Search, ShieldCheck, X, Zap } from "lucide-react";
import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { type MenuItemKey, type MenuSectionKey, menuItemCopy, type ToolMenu } from "@/components/layout/toolMenus";
import { TOOL_CATALOG } from "@/lib/constants/toolCatalog";
import { cn } from "@/lib/utils/cn";
import { type Dictionary, useT } from "@/i18n";

/** Each section's colour: its filter icon and the label on its cards. */
const SECTION_TONE: Record<MenuSectionKey, string> = {
    aiTools: "#7C3AED",
    editAdjust: "#2563EB",
    optimize: "#E11D48",
    textOcr: "#4F46E5",
    pdfTools: "#E11D48",
    convert: "#0284C7",
    editSecure: "#7C3AED",
};

/** Each tool's own colour (icon tile, card tint, arrow). Tools without one take their section's. */
const ACCENT: Partial<Record<MenuItemKey, string>> = {
    removeBackground: "#8B5CF6",
    upscaler: "#6366F1",
    retouch: "#EC4899",
    watermarkRemover: "#F59E0B",
    photoGenerator: "#0EA5E9",
    editor: "#3B82F6",
    crop: "#10B981",
    rotateFlip: "#14B8A6",
    compressor: "#F43F5E",
    resize: "#F97316",
    ocr: "#6366F1",
    textEditor: "#3B82F6",
    textCleaner: "#10B981",
    findReplace: "#F59E0B",
    wordCounter: "#D946EF",
    caseConverter: "#14B8A6",
    organizePdf: "#F43F5E",
    pdfMerge: "#EF4444",
    pdfSplit: "#F43F5E",
    pdfCompress: "#EF4444",
    pdfRotate: "#F43F5E",
    extractPages: "#EF4444",
    pdfToWord: "#2563EB",
    pdfToText: "#0D9488",
    pdfToImages: "#0EA5E9",
    imagesToPdf: "#06B6D4",
    pdfToJpg: "#0EA5E9",
    pdfToPng: "#3B82F6",
    pdfEditor: "#8B5CF6",
    pdfSign: "#7C3AED",
    pdfWatermark: "#A855F7",
    pdfPageNumbers: "#6366F1",
    pdfProtect: "#7C3AED",
    pdfUnlock: "#8B5CF6",
};

interface Card {
    /** `section:item`, so the filters can match a card to its section. */
    key: string;
    href: string;
    search?: string;
    icon: LucideIcon;
    title: string;
    description: string;
    label: string;
    tone: string;
    accent: string;
    isNew?: boolean;
}

interface ToolSuitePageProps<K extends MenuSectionKey> {
    /** The suite this page presents. */
    menu: ToolMenu<K>;
    /** The other suite: searched too, its matches listed below. */
    other: ToolMenu;
    copy: { badge: string; titleLead: string; titleAccent: string; description: string };
    groups: { own: string; other: string };
    /** The hero's picture (decorative). */
    art: ReactNode;
}

/** A suite's front door (Image Tools, Documents): what it does, every tool by section, and a search. */
export function ToolSuitePage<K extends MenuSectionKey>({ menu, other, copy, groups, art }: ToolSuitePageProps<K>) {
    const t = useT();
    // Search, filters and the like are the same on both pages.
    const shared = t.documents.landing;
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<"all" | K>("all");
    const searchId = useId();
    const input = useRef<HTMLInputElement>(null);
    const searching = query.trim().length > 0;

    // ⌘K / Ctrl+K jumps to the search, as the hint in the field says.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                input.current?.focus();
                input.current?.select();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    const cards = useMemo(() => menuCards(t, menu), [t, menu]);
    const otherCards = useMemo(() => menuCards(t, other), [t, other]);
    const shown = searching ? matchCards(cards, query) : cards.filter((card) => filter === "all" || card.key.startsWith(`${filter}:`));
    // A search also looks across the other suite (so "compress" finds both compressors).
    const otherMatches = searching ? matchCards(otherCards, query) : [];

    return (
        <div className="relative isolate overflow-hidden">
            {/* A soft wash of the brand colours behind the hero, fading into the page. */}
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[38rem] bg-[radial-gradient(60rem_26rem_at_75%_0%,rgb(124_58_237/0.10),transparent_70%),radial-gradient(50rem_24rem_at_10%_10%,rgb(14_165_233/0.10),transparent_70%)]" />

            <div className="page-container pt-10 pb-20 md:pt-14 md:pb-28">
                <header className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
                    <div>
                        <p className="section-badge">{copy.badge}</p>
                        <h1 className="mt-5 text-hero text-balance text-primary">
                            {copy.titleLead}{" "}
                            <span className="bg-linear-to-r from-[#0EA5E9] via-[#4F46E5] to-[#C026D3] bg-clip-text text-transparent dark:from-[#38BDF8] dark:via-[#818CF8] dark:to-[#E879F9]">{copy.titleAccent}</span>
                        </h1>
                        <p className="mt-5 max-w-2xl text-lead text-pretty text-tertiary">{copy.description}</p>

                        <div role="search" className="relative mt-8 max-w-2xl">
                            <label htmlFor={searchId} className="sr-only">
                                {shared.searchLabel}
                            </label>
                            <input
                                ref={input}
                                id={searchId}
                                type="search"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                onKeyDown={(event) => event.key === "Escape" && setQuery("")}
                                placeholder={shared.search}
                                autoComplete="off"
                                aria-keyshortcuts="Meta+K Control+K"
                                className="h-14 w-full rounded-2xl border border-[var(--card-line)] bg-primary/90 pr-20 pl-12 text-md text-primary shadow-[0_1px_2px_rgb(15_23_42/0.04),0_8px_24px_-12px_rgb(15_23_42/0.12)] outline-focus-ring backdrop-blur-sm placeholder:text-quaternary focus-visible:outline-2 [&::-webkit-search-cancel-button]:hidden"
                            />
                            <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-quaternary" aria-hidden />
                            {searching ? (
                                <button type="button" onClick={() => setQuery("")} aria-label={shared.clearSearch} className="absolute top-1/2 right-3 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-lg text-tertiary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2">
                                    <X className="size-4" aria-hidden />
                                </button>
                            ) : (
                                <kbd aria-hidden className="pointer-events-none absolute top-1/2 right-3.5 hidden -translate-y-1/2 items-center gap-1 rounded-lg border border-[var(--card-line)] bg-secondary px-2 py-1 font-sans text-xs font-medium text-tertiary pointer-fine:flex">
                                    {isApple() ? "⌘" : "Ctrl"} K
                                </kbd>
                            )}
                        </div>
                    </div>

                    {art}
                </header>

                <div className="mt-12 flex flex-wrap items-center justify-between gap-4">
                    {!searching && <Filters menu={menu} value={filter} onChange={setFilter} />}
                    <p className="flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,#10B981_25%,transparent)] bg-[color-mix(in_srgb,#10B981_8%,transparent)] px-3.5 py-2 text-xs font-medium text-secondary">
                        <Zap className="size-3.5 fill-current text-[#10B981]" aria-hidden />
                        {shared.trust.join("  ·  ")}
                    </p>
                </div>

                <div className="mt-8 flex flex-col gap-10" aria-live="polite">
                    {searching && !shown.length && !otherMatches.length && <p className="text-center text-sm text-tertiary">{shared.noResults(query.trim())}</p>}
                    {shown.length > 0 && (
                        <section aria-label={groups.own}>
                            {searching && <h2 className="mb-4 text-sm font-semibold text-secondary">{groups.own}</h2>}
                            <CardGrid cards={shown} newLabel={shared.isNew} />
                        </section>
                    )}
                    {otherMatches.length > 0 && (
                        <section aria-label={groups.other}>
                            <h2 className="mb-4 text-sm font-semibold text-secondary">{groups.other}</h2>
                            <CardGrid cards={otherMatches} newLabel={shared.isNew} />
                        </section>
                    )}
                </div>

                <p className="mx-auto mt-14 flex max-w-xl items-start justify-center gap-2 text-center text-sm text-tertiary">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success-primary" aria-hidden />
                    {t.documents.privacy}
                </p>
            </div>
        </div>
    );
}

/** The section filters, as a single-choice group of pills. */
function Filters<K extends MenuSectionKey>({ menu, value, onChange }: { menu: ToolMenu<K>; value: "all" | K; onChange: (filter: "all" | K) => void }) {
    const t = useT();
    const shared = t.documents.landing;
    const options: { value: "all" | K; label: string; icon: LucideIcon; tone?: string }[] = [
        { value: "all", label: shared.allTools, icon: LayoutGrid },
        ...menu.sections.map((section) => ({ value: section.key, label: menu.sectionCopy(t, section.key).title, icon: section.icon, tone: SECTION_TONE[section.key] })),
    ];
    const refs = useRef<(HTMLButtonElement | null)[]>([]);

    // Arrow keys move the choice, like any radio group.
    const onKeyDown = (event: ReactKeyboardEvent, index: number) => {
        const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const next = (index + step + options.length) % options.length;
        onChange(options[next]!.value);
        refs.current[next]?.focus();
    };

    return (
        <div role="radiogroup" aria-label={shared.categoriesLabel} className="-mx-1 -mb-3 flex max-w-full gap-2 overflow-x-auto px-1 pt-1 pb-4 [mask-image:linear-gradient(to_right,black_88%,transparent)] [scrollbar-width:none] lg:[mask-image:none]">
            {options.map((option, index) => {
                const selected = option.value === value;
                const Icon = option.icon;
                return (
                    <button
                        key={option.value}
                        ref={(element) => {
                            refs.current[index] = element;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onChange(option.value)}
                        onKeyDown={(event) => onKeyDown(event, index)}
                        className={cn(
                            "flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full px-4.5 text-sm font-semibold whitespace-nowrap outline-focus-ring transition-[background-color,border-color,color,box-shadow,scale] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.97] active:duration-75 motion-reduce:active:scale-100",
                            selected
                                ? "bg-linear-to-b from-[#3B82F6] to-[#2563EB] text-white shadow-[0_6px_16px_-6px_rgb(37_99_235/0.6)]"
                                : "border border-[var(--card-line)] bg-primary text-secondary shadow-xs hover:bg-primary_hover hover:text-primary",
                        )}
                    >
                        <Icon className="size-4.5" strokeWidth={2} style={!selected && option.tone ? { color: option.tone } : undefined} aria-hidden />
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

function CardGrid({ cards, newLabel }: { cards: readonly Card[]; newLabel: string }) {
    return (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cards.map((card) => (
                <li key={card.key}>
                    <ToolCard card={card} newLabel={newLabel} />
                </li>
            ))}
        </ul>
    );
}

/**
 * A tool: its colour tints the card, fills the icon tile and the arrow. Feedback is immediate — the
 * card lifts on hover and presses in on touch-down; with reduced motion it only changes colour.
 */
function ToolCard({ card, newLabel }: { card: Card; newLabel: string }) {
    const Icon = card.icon;
    return (
        <Link
            to={{ pathname: card.href, search: card.search }}
            style={{ "--accent": card.accent, "--tone": card.tone } as CSSProperties}
            className="tool-card group relative flex h-full gap-4 rounded-2xl border p-5 outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2"
        >
            <span className="tool-card-icon grid size-12 shrink-0 place-items-center rounded-[0.875rem] text-white">
                <Icon className="size-6" strokeWidth={2} aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[0.6875rem] font-semibold tracking-[0.06em] text-[var(--tone)] uppercase dark:text-[color-mix(in_srgb,var(--tone)_55%,white)]">{card.label}</span>
                <span className="mt-1 text-md font-semibold text-primary">{card.title}</span>
                <span className="mt-1.5 line-clamp-2 pr-8 text-sm leading-relaxed text-tertiary">{card.description}</span>
            </span>
            {card.isNew && <span className="absolute top-3 right-3 rounded-full bg-linear-to-r from-[#8B5CF6] to-[#D946EF] px-2 py-0.5 text-[0.6875rem] font-semibold text-white">{newLabel}</span>}
            <span aria-hidden className="tool-card-arrow absolute right-4 bottom-4 grid size-8 place-items-center rounded-full">
                <ArrowRight className="size-4" strokeWidth={2.2} />
            </span>
        </Link>
    );
}

/** Every tool of a menu, in menu order. */
function menuCards<K extends MenuSectionKey>(t: Dictionary, menu: ToolMenu<K>): Card[] {
    return menu.sections.flatMap((section) =>
        section.items.map((item) => ({
            key: `${section.key}:${item.key}`,
            href: item.href,
            search: item.search,
            icon: item.icon,
            ...menuItemCopy(t, item.key),
            label: menu.sectionCopy(t, section.key).title,
            tone: SECTION_TONE[section.key],
            accent: ACCENT[item.key] ?? SECTION_TONE[section.key],
            isNew: item.isNew,
        })),
    );
}

const normalise = (value: string) => value.toLocaleLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");

/**
 * Tools matching a search, best first: every word must be in the name, description or catalog
 * keywords, and matches in the name rank first.
 */
function matchCards(cards: readonly Card[], query: string) {
    const words = normalise(query).split(/\s+/).filter(Boolean);
    return cards
        .map((card) => {
            const name = normalise(card.title);
            const keywords = TOOL_CATALOG.find((tool) => tool.key === card.key.split(":")[1])?.keywords ?? [];
            const rest = normalise([card.description, ...keywords].join(" "));
            if (!words.every((word) => name.includes(word) || rest.includes(word))) return null;
            return { card, score: words.reduce((sum, word) => sum + (name.startsWith(word) ? 3 : name.includes(word) ? 2 : 1), 0) };
        })
        .filter((match): match is { card: Card; score: number } => match !== null)
        .sort((a, b) => b.score - a.score)
        .map((match) => match.card);
}

const isApple = () => typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
