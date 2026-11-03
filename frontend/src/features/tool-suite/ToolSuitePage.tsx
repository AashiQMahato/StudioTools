import { ArrowRight, LayoutGrid, type LucideIcon, Search, ShieldCheck, X } from "lucide-react";
import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { type MenuSectionKey, menuItemCopy, type ToolMenu } from "@/components/layout/toolMenus";
import { HUES, TOOL_ACCENT } from "@/components/layout/toolRegistry";
import { TOOL_CATALOG } from "@/lib/constants/toolCatalog";
import { matchRanges } from "@/lib/utils/searchTools";
import { cn } from "@/lib/utils/cn";
import { useToolSearch } from "@/store/useToolSearch";
import { type Dictionary, useT } from "@/i18n";

/** Each section's colour: its filter icon and the dot beside its heading. */
const SECTION_TONE: Record<MenuSectionKey, string> = {
    aiTools: HUES.indigo,
    aiPhotoText: HUES.violet,
    editAdjust: HUES.amber,
    retouchRestore: HUES.violet,
    optimize: HUES.green,
    photoId: HUES.sky,
    social: HUES.coral,
    editOptimize: HUES.amber,
    pdfEditing: HUES.indigo,
    convert: HUES.sky,
    pdfTools: HUES.coral,
    securePdf: HUES.green,
    textOcr: HUES.violet,
    textUtils: HUES.indigo,
    scanning: HUES.sky,
    pdfConvert: HUES.coral,
    editSecure: HUES.violet,
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

/**
 * A suite's front door (Image Tools, Documents): what it does, a search across both suites, and every
 * tool — grouped by what it's for, or narrowed to one group with the filters.
 */
export function ToolSuitePage<K extends MenuSectionKey>({ menu, other, copy, groups, art }: ToolSuitePageProps<K>) {
    const t = useT();
    // Search, filters and the like are the same on both pages.
    const shared = t.documents.landing;
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<"all" | K>("all");
    const searchId = useId();
    const input = useRef<HTMLInputElement>(null);
    const trimmed = query.trim();
    const searching = trimmed.length > 0;

    // ⌘K / Ctrl+K jumps to this page's search (the hint in the field says so); the palette defers to it.
    const setLocalSearch = useToolSearch((state) => state.setLocalSearch);
    useEffect(() => {
        setLocalSearch(() => {
            input.current?.focus();
            input.current?.select();
        });
        return () => setLocalSearch(null);
    }, [setLocalSearch]);

    const cards = useMemo(() => menuCards(t, menu), [t, menu]);
    const otherCards = useMemo(() => menuCards(t, other), [t, other]);
    const matches = searching ? matchCards(cards, trimmed) : [];
    // A search also looks across the other suite (so "compress" finds both compressors).
    const otherMatches = searching ? matchCards(otherCards, trimmed) : [];
    const sections = menu.sections.filter((section) => filter === "all" || section.key === filter);

    return (
        <div className="relative isolate overflow-hidden">
            {/* Light from above in the brand's indigo and violet, fading into the paper. */}
            <div aria-hidden className="hero-glow pointer-events-none absolute inset-x-0 top-0 -z-10 h-[34rem]" />

            <div className="page-container pt-8 pb-20 md:pt-12 md:pb-28">
                <header className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
                    <div className="animate-enter [--i:0]">
                        <p className="section-badge">{copy.badge}</p>
                        <h1 className="mt-5 text-hero text-balance text-primary">
                            {copy.titleLead} <span className="hero-accent">{copy.titleAccent}</span>
                        </h1>
                        <p className="mt-4 max-w-2xl text-lead text-pretty text-tertiary">{copy.description}</p>

                        <div role="search" className="relative mt-8 max-w-xl">
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
                                className="glass h-13 w-full rounded-2xl pr-20 pl-12 text-md text-primary outline-focus-ring placeholder:text-quaternary focus-visible:outline-2 [&::-webkit-search-cancel-button]:hidden"
                            />
                            <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-quaternary" aria-hidden />
                            {searching ? (
                                <button type="button" onClick={() => setQuery("")} aria-label={shared.clearSearch} className="absolute top-1/2 right-3 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-lg text-tertiary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2">
                                    <X className="size-4" aria-hidden />
                                </button>
                            ) : (
                                <kbd aria-hidden className="pointer-events-none absolute top-1/2 right-3.5 hidden -translate-y-1/2 items-center gap-1 rounded-md bg-[rgb(120_113_98/0.1)] px-2 py-1 font-sans text-xs font-medium text-tertiary pointer-fine:flex dark:bg-white/8">
                                    {isApple() ? "⌘" : "Ctrl"} K
                                </kbd>
                            )}
                        </div>
                    </div>

                    {art}
                </header>

                {/* While searching, the filters step back: the results span every group. */}
                <div className={cn("mt-12 flex flex-wrap items-center justify-between gap-4 transition-opacity duration-200", searching && "pointer-events-none opacity-40")} aria-hidden={searching || undefined}>
                    <Filters menu={menu} value={filter} onChange={setFilter} />
                </div>

                <div className="mt-8" aria-live="polite">
                    {searching ? (
                        <div key="search" className="suite-fade flex flex-col gap-10">
                            {!matches.length && !otherMatches.length && (
                                <div className="card flex flex-col items-center px-6 py-14 text-center">
                                    <span className="grid size-12 place-items-center rounded-2xl bg-tertiary text-tertiary">
                                        <Search className="size-5" aria-hidden />
                                    </span>
                                    <p className="mt-4 text-md font-semibold text-primary">{shared.noResults(trimmed)}</p>
                                    <p className="mt-1 text-sm text-tertiary">{t.nav.mega.search.emptyHint}</p>
                                    <button type="button" onClick={() => setQuery("")} className="mt-5 h-10 cursor-pointer rounded-full border border-[var(--card-line)] bg-primary px-4 text-sm font-semibold text-secondary outline-focus-ring hover:bg-primary_hover focus-visible:outline-2">
                                        {shared.clearSearch}
                                    </button>
                                </div>
                            )}
                            {matches.length > 0 && <CardGroup title={groups.own} count={matches.length} cards={matches} query={trimmed} newLabel={shared.isNew} />}
                            {otherMatches.length > 0 && <CardGroup title={groups.other} count={otherMatches.length} cards={otherMatches} query={trimmed} newLabel={shared.isNew} />}
                        </div>
                    ) : (
                        <div key={filter} className="suite-fade flex flex-col gap-12">
                            {sections.map((section) => {
                                const sectionCards = cards.filter((card) => card.key.startsWith(`${section.key}:`));
                                const sectionCopy = menu.sectionCopy(t, section.key);
                                return (
                                    <CardGroup
                                        key={section.key}
                                        title={sectionCopy.title}
                                        description={sectionCopy.description}
                                        icon={section.icon}
                                        tone={SECTION_TONE[section.key]}
                                        count={sectionCards.length}
                                        cards={sectionCards}
                                        newLabel={shared.isNew}
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>

                <p className="mx-auto mt-16 flex max-w-xl items-start justify-center gap-2 text-center text-sm text-tertiary">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success-primary" aria-hidden />
                    {t.documents.privacy}
                </p>
            </div>
        </div>
    );
}

/** The section filters, as a single-choice group of pills on one glass track. */
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
        <div role="radiogroup" aria-label={shared.categoriesLabel} className="-mx-1 -mb-3 flex max-w-full gap-1.5 overflow-x-auto px-1 pt-1 pb-4 [mask-image:linear-gradient(to_right,black_88%,transparent)] [scrollbar-width:none] xl:[mask-image:none]">
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
                            "flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-medium whitespace-nowrap outline-focus-ring transition-[background-color,box-shadow,color,scale] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.97] active:duration-75 motion-reduce:active:scale-100",
                            selected ? "btn-ink" : "bg-primary text-secondary shadow-[0_0_0_1px_var(--card-line)] hover:text-primary hover:shadow-[0_0_0_1px_var(--card-line),0_4px_12px_-6px_rgb(32_33_36/0.18)]",
                        )}
                    >
                        <Icon className="size-4" strokeWidth={2} style={!selected && option.tone ? { color: option.tone } : undefined} aria-hidden />
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

/** One group of tools: a quiet heading (what the group is for, how many), then its cards. */
function CardGroup({ title, description, icon: Icon, tone, count, cards, query, newLabel }: { title: string; description?: string; icon?: LucideIcon; tone?: string; count: number; cards: readonly Card[]; query?: string; newLabel: string }) {
    const headingId = useId();
    return (
        <section aria-labelledby={headingId}>
            <div className="mb-4 flex items-end justify-between gap-4 border-b border-[var(--card-line)] pb-3">
                <div className="flex min-w-0 items-center gap-3">
                    {Icon && (
                        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-[0.625rem]" style={{ color: tone, backgroundColor: `color-mix(in srgb, ${tone} 12%, transparent)` }}>
                            <Icon className="size-4" strokeWidth={2} />
                        </span>
                    )}
                    <div className="min-w-0">
                        <h2 id={headingId} className="text-lg font-semibold tracking-[-0.01em] text-primary">
                            {title}
                        </h2>
                        {description && <p className="truncate text-sm text-tertiary">{description}</p>}
                    </div>
                </div>
                <span className="shrink-0 rounded-full bg-tertiary px-2.5 py-0.5 text-xs font-medium text-tertiary tabular-nums">{count}</span>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {cards.map((card) => (
                    <li key={card.key}>
                        <ToolCard card={card} query={query} newLabel={newLabel} />
                    </li>
                ))}
            </ul>
        </section>
    );
}

/** The query's words, marked in a card's text. */
function Highlight({ text, query }: { text: string; query?: string }) {
    const ranges = query ? matchRanges(text, query) : [];
    if (!ranges.length) return <>{text}</>;
    const parts: ReactNode[] = [];
    let at = 0;
    for (const [start, end] of ranges) {
        if (start > at) parts.push(text.slice(at, start));
        parts.push(
            <mark key={start} className="rounded-[3px] bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-inherit">
                {text.slice(start, end)}
            </mark>,
        );
        at = end;
    }
    parts.push(text.slice(at));
    return <>{parts}</>;
}

/**
 * A tool: its colour fills the icon tile on hover and leads the arrow. Feedback is immediate — the
 * card lifts on hover and presses in on touch-down; with reduced motion it only changes colour.
 */
function ToolCard({ card, query, newLabel }: { card: Card; query?: string; newLabel: string }) {
    const Icon = card.icon;
    return (
        <Link
            to={{ pathname: card.href, search: card.search }}
            style={{ "--accent": card.accent } as CSSProperties}
            className="tool-card group relative flex h-full min-h-[6.5rem] items-start gap-3.5 rounded-2xl border p-4 outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2"
        >
            <span className="tool-card-icon grid size-11 shrink-0 place-items-center rounded-xl">
                <Icon className="size-5" strokeWidth={1.9} aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col pt-0.5">
                <span className="flex items-center gap-2">
                    <span className="truncate text-[0.9375rem] font-semibold tracking-[-0.01em] text-primary">
                        <Highlight text={card.title} query={query} />
                    </span>
                    {card.isNew && <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-1.5 py-px text-[0.625rem] font-semibold tracking-[0.04em] text-[var(--accent)] uppercase">{newLabel}</span>}
                </span>
                <span className="mt-1 line-clamp-2 pr-5 text-sm leading-snug text-tertiary">
                    <Highlight text={card.description} query={query} />
                </span>
                {query && <span className="mt-2 text-xs font-medium text-quaternary">{card.label}</span>}
            </span>
            <ArrowRight aria-hidden className="tool-card-arrow absolute top-4 right-4 size-4" strokeWidth={2.2} />
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
            accent: TOOL_ACCENT[item.key] ?? SECTION_TONE[section.key],
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
