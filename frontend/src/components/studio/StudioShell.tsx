import { ChevronDown, CircleHelp, ImagePlus, LoaderCircle, Menu } from "lucide-react";
import { createContext, type CSSProperties, type ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LogoMark } from "@/components/common/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { TOOL_ICONS } from "@/components/layout/toolIcons";
import { TOOL_ACCENT } from "@/components/layout/toolRegistry";
import { useImageUpload } from "@/hooks/useImageUpload";
import { isDocumentTool, studioToolGroups, type ToolKey } from "@/lib/constants/navigation";
import { ROUTES } from "@/lib/constants/routes";
import { cn } from "@/lib/utils/cn";
import { useHandoff } from "@/store/useHandoff";
import { useSectionImageStore } from "@/store/useImageStore";
import { useImmersiveLayout } from "@/store/useLayoutStore";
import { useT } from "@/i18n";
import { StudioSidebar } from "./StudioSidebar";
import { usePopover } from "./usePopover";

interface StudioContextValue {
    /** Opens the file picker for a new image. */
    openPicker: () => void;
    /** The last problem with a picked, dropped or pasted file. */
    uploadError: string | null;
    /** Clears the image (asking first when there are edits that would be lost). */
    clearImage: () => void;
    /** An image is open: canvases show the round remove button. */
    hasImage: boolean;
}

const StudioContext = createContext<StudioContextValue>({ openPicker: () => undefined, uploadError: null, clearImage: () => undefined, hasImage: false });
export const useStudio = () => useContext(StudioContext);

interface StudioShellProps {
    tool: ToolKey;
    /** Buttons in the top bar, before Help (undo, redo…). */
    actions?: ReactNode;
    /** The primary export control, top right. */
    exportSlot?: ReactNode;
    /** The right-hand panel. */
    panel: ReactNode;
    /**
     * There's something to work on. Until there is, the panel and the export button stay hidden and the
     * drop zone takes the width. Defaults to: an image is open.
     */
    hasWork?: boolean;
    panelLabel: string;
    /** The centre card: canvas, status and actions. */
    children: ReactNode;
    /** There are edits that would be lost: ask before starting over, and warn before leaving the page. */
    dirty?: boolean;
    /** Below desktop width the panel stacks under the canvas, unless the tool shows it its own way (a bottom sheet). */
    mobilePanel?: "stack" | "none";
    /** "compact" gives the canvas more room when the panel only holds a summary and links (the PDF viewer). */
    panelWidth?: "default" | "compact";
    /**
     * A tool that takes several images at once (the compressor) receives every picked, dropped or pasted
     * file here instead of the shared single image.
     */
    onFiles?: (files: File[]) => void;
    /** A tool that also takes other files (the OCR editor's PDFs) claims them here first: true = handled. */
    interceptFile?: (file: File) => boolean;
    /** The picker's file types, when the tool takes more than images. */
    accept?: string;
}

/**
 * The frame every tool shares: a top bar, the tools on the left, the image in the middle and the
 * tool's controls on the right. An image can be dropped or pasted anywhere on it.
 */
export function StudioShell({ tool, actions, exportSlot, panel, panelLabel, children, dirty = false, mobilePanel = "stack", panelWidth = "default", hasWork, onFiles, interceptFile, accept }: StudioShellProps) {
    useImmersiveLayout();
    const t = useT();
    const copy = t.studio;
    const store = useSectionImageStore();
    const original = store((state) => state.original);
    const clearImage = store((state) => state.clear);
    const customName = store((state) => state.customName);
    const rename = store((state) => state.rename);
    const upload = useImageUpload({ navigateTo: null, intercept: interceptFile, accept });
    const multiInput = useRef<HTMLInputElement>(null);
    const { acceptFile } = upload;
    const receive = useCallback((files: File[]) => (onFiles ? onFiles(files) : files[0] && void acceptFile(files[0])), [onFiles, acceptFile]);
    const dragging = usePageDrop(receive);
    // A result carried on from another tool opens here as if it had been dropped in.
    useEffect(() => {
        const handoff = useHandoff.getState().take();
        if (handoff?.files.length) receive(handoff.files);
        // Once, when the tool opens.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const openPicker = onFiles ? () => multiInput.current?.click() : upload.openPicker;
    const { clearError } = upload;
    const [confirming, setConfirming] = useState(false);
    const sidebar = useSidebar();
    const sidebarId = useId();
    const headingId = useId();
    const requestNewImage = () => (dirty ? setConfirming(true) : clearImage());
    const working = hasWork ?? Boolean(original);

    // Closing or reloading the tab would throw the edits away too; let the browser ask first.
    useEffect(() => {
        if (!dirty) return;
        const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [dirty]);

    useEffect(() => {
        if (!upload.error) return;
        const timer = window.setTimeout(clearError, 6000);
        return () => window.clearTimeout(timer);
    }, [upload.error, clearError]);

    const iconButton = STUDIO_ICON_BUTTON;

    return (
        <StudioContext.Provider value={{ openPicker, uploadError: upload.error, clearImage: requestNewImage, hasImage: Boolean(original) }}>
            <div className="studio-shell flex min-h-dvh flex-col lg:h-dvh" style={{ "--accent": TOOL_ACCENT[tool] ?? "var(--brand-solid)" } as CSSProperties}>
                <input {...upload.inputProps} aria-hidden />
                {onFiles && (
                    <input
                        ref={multiInput}
                        type="file"
                        multiple
                        accept={upload.inputProps.accept}
                        hidden
                        tabIndex={-1}
                        aria-hidden
                        onChange={(event) => {
                            const files = Array.from(event.target.files ?? []);
                            event.target.value = "";
                            if (files.length) onFiles(files);
                        }}
                    />
                )}

                <header className="studio-topbar sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 px-2.5 sm:gap-3 sm:px-4 lg:static">
                    {/* The tool list: folds away beside the work on wide screens, slides in as a drawer on narrow ones. */}
                    <button
                        type="button"
                        onClick={sidebar.toggle}
                        aria-controls={sidebarId}
                        aria-expanded={sidebar.shown}
                        aria-label={sidebar.shown ? copy.hideTools : copy.showTools}
                        title={sidebar.shown ? copy.hideTools : copy.showTools}
                        className={cn(iconButton, "-ml-1")}
                    >
                        <Menu className="size-[1.125rem]" aria-hidden />
                    </button>
                    <Link to={ROUTES.home} aria-label={t.common.homeAria} className="flex shrink-0 items-center gap-2 rounded-lg text-[0.9375rem] font-semibold tracking-[-0.015em] text-primary outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2">
                        <LogoMark className="size-6" />
                        <span className="hidden sm:inline">
                            {copy.name} <span className="text-tertiary">{copy.suffix}</span>
                        </span>
                    </Link>
                    <span aria-hidden className="mx-0.5 hidden h-5 w-px bg-[var(--card-line)] md:block" />
                    <ToolBreadcrumb tool={tool} fileName={customName ?? original?.name} onRename={original ? rename : undefined} onNewImage={original ? requestNewImage : undefined} />

                    <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
                        {actions}
                        {original && (
                            <>
                                {actions && <span aria-hidden className="mx-1 hidden h-6 w-px bg-[var(--card-line)] sm:block" />}
                                <button type="button" className={cn(iconButton, "hidden sm:grid")} onClick={requestNewImage} aria-label={copy.newImage} title={copy.newImage}>
                                    <ImagePlus className="size-[1.125rem]" aria-hidden />
                                </button>
                            </>
                        )}
                        <ShortcutsHelp className="hidden sm:block" />
                        {/* grid, not flex: the sun and moon share one cell and swap in place, as on the home page. */}
                        <ThemeToggle className="hidden size-9! rounded-lg! sm:grid" />
                        {working && exportSlot && <div className="ml-1">{exportSlot}</div>}
                    </div>
                </header>

                <div className="flex flex-1 flex-col gap-2.5 p-2 pt-0 sm:p-2.5 sm:pt-0 lg:min-h-0 lg:flex-row lg:pl-0">
                    <StudioSidebar current={tool} id={sidebarId} collapsed={sidebar.collapsed} drawerOpen={sidebar.drawerOpen} onCloseDrawer={sidebar.closeDrawer} />

                    {/* A section, not <main>: the page's <main> (AppLayout) already contains the whole studio. */}
                    <section aria-labelledby={headingId} className="studio-surface flex min-w-0 flex-1 flex-col gap-3 rounded-[1.25rem] p-2 max-lg:has-[.studio-drop]:flex-none sm:p-2.5 lg:min-h-0">
                        {/* The page's heading: the tool's name (shown in the header bar; here for search engines and screen readers). */}
                        <h1 id={headingId} className="sr-only">
                            {t.nav.toolItems[tool].title}
                        </h1>
                        {children}
                    </section>

                    {working && (
                        <aside aria-label={panelLabel} className={cn("studio-surface studio-panel-in flex shrink-0 flex-col overflow-hidden rounded-[1.25rem] lg:min-h-0", panelWidth === "compact" ? "lg:w-[17rem] xl:w-[18rem]" : isDocumentTool(tool) ? "lg:w-[20rem] xl:w-[21.5rem]" : "lg:w-[22.5rem] xl:w-[24rem]", mobilePanel === "none" && "hidden lg:flex")}>
                            {/* The panel's own heading, so its sections' headings sit under it in the outline. */}
                            <h2 className="sr-only">{panelLabel}</h2>
                            {panel}
                        </aside>
                    )}
                </div>

                {/* Drop anywhere: the whole studio is the target. */}
                <div aria-hidden={!dragging} className={cn("pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6 transition-opacity duration-200", dragging ? "opacity-100" : "opacity-0")}>
                    <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--page-bg)_72%,transparent)] backdrop-blur-md" />
                    <div className="relative flex size-full items-center justify-center rounded-[1.75rem] border-2 border-dashed border-[var(--accent)]">
                        <p className="glass flex items-center gap-2.5 rounded-full px-5 py-3 text-tile text-primary">
                            <ImagePlus className="size-5 text-[var(--accent)]" aria-hidden />
                            {t.upload.dropToOpen}
                        </p>
                    </div>
                </div>
                {confirming && (
                    <ConfirmDiscard
                        onKeep={() => setConfirming(false)}
                        onDiscard={() => {
                            setConfirming(false);
                            clearImage();
                        }}
                    />
                )}
                <p
                    role="alert"
                    className={cn(
                        "glass-strong fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2.5 text-sm font-medium text-error-primary transition-[opacity,translate] duration-200",
                        upload.error ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
                    )}
                >
                    {upload.error}
                </p>
                {/* A file on its way in, e.g. a HEIC photo being converted. */}
                <p
                    role="status"
                    className={cn(
                        "glass-strong fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-secondary transition-[opacity,translate] duration-200",
                        upload.status && !upload.error ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
                    )}
                >
                    {upload.status && <LoaderCircle className="size-4 animate-spin text-[var(--brand)] motion-reduce:animate-none" aria-hidden />}
                    {upload.status}
                </p>
            </div>
        </StudioContext.Provider>
    );
}

/** Square toolbar buttons in the studio's top bar (and in tools' own `actions`). */
export const STUDIO_ICON_BUTTON =
    "grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-secondary transition-[background-color,color,scale] duration-150 outline-focus-ring hover:nav-fill hover:text-primary active:scale-95 focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-35 disabled:active:scale-100 pointer-coarse:size-11";

const IS_APPLE = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

/** Help: the keyboard shortcuts that work across the studio, in a small glass popover. */
function ShortcutsHelp({ className }: { className?: string }) {
    const t = useT();
    const copy = t.studio.help;
    const { open, setOpen, wrap, trigger } = usePopover();
    const mod = IS_APPLE ? "⌘" : "Ctrl";
    const rows: [string, string[]][] = [
        [copy.search, [mod, "K"]],
        [copy.paste, [mod, "V"]],
        [copy.drop, [copy.dropKey]],
        [copy.undo, [mod, "Z"]],
        [copy.redo, IS_APPLE ? [mod, "⇧", "Z"] : [mod, "Y"]],
        [copy.close, ["Esc"]],
    ];
    return (
        <div ref={wrap} className={cn("relative", className)}>
            <button ref={trigger} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog" aria-label={copy.label} title={copy.label} className={STUDIO_ICON_BUTTON}>
                <CircleHelp className="size-[1.125rem]" aria-hidden />
            </button>
            {open && (
                <div role="dialog" aria-label={copy.title} className="material-popover absolute top-full right-0 z-50 mt-2 w-72 origin-top-right rounded-2xl p-2">
                    <p className="px-2.5 pt-1.5 pb-2 text-[0.6875rem] font-semibold tracking-[0.06em] text-quaternary uppercase">{copy.title}</p>
                    <dl className="flex flex-col">
                        {rows.map(([label, keys]) => (
                            <div key={label} className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-sm">
                                <dt className="text-secondary">{label}</dt>
                                <dd className="flex shrink-0 gap-1">
                                    {keys.map((key) => (
                                        <kbd key={key} className="inline-grid h-6 min-w-6 place-items-center rounded-md bg-[rgb(120_113_98/0.1)] px-1.5 font-sans text-xs font-medium text-secondary shadow-[inset_0_-1px_0_rgb(0_0_0/0.08)] dark:bg-white/8">
                                            {key}
                                        </kbd>
                                    ))}
                                </dd>
                            </div>
                        ))}
                    </dl>
                    <p className="mt-1 border-t border-[var(--card-line)] px-2.5 pt-2 pb-1 text-xs text-tertiary">{copy.undoNote}</p>
                </div>
            )}
        </div>
    );
}

const SIDEBAR_KEY = "studio-sidebar-collapsed";
const wide = () => window.matchMedia("(min-width: 1024px)").matches;

/**
 * The tool list's state. Wide screens: shown or folded away — remembered across tools and visits.
 * Narrow screens: a drawer, closed until the menu button opens it.
 */
function useSidebar() {
    const [collapsed, setCollapsed] = useState(() => {
        try {
            return localStorage.getItem(SIDEBAR_KEY) === "1";
        } catch {
            return false;
        }
    });
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [isWide, setIsWide] = useState(wide);
    useEffect(() => {
        const query = window.matchMedia("(min-width: 1024px)");
        const onChange = () => {
            setIsWide(query.matches);
            if (query.matches) setDrawerOpen(false);
        };
        query.addEventListener("change", onChange);
        return () => query.removeEventListener("change", onChange);
    }, []);
    const toggle = useCallback(() => {
        if (!wide()) return setDrawerOpen((open) => !open);
        setCollapsed((value) => {
            try {
                localStorage.setItem(SIDEBAR_KEY, value ? "0" : "1");
            } catch {
                // Not remembered; still toggles.
            }
            return !value;
        });
    }, []);
    const closeDrawer = useCallback(() => setDrawerOpen(false), []);
    return { collapsed, drawerOpen, toggle, closeDrawer, shown: isWide ? !collapsed : drawerOpen };
}

/** Drag-and-drop and paste for the whole page. Returns whether a file is being dragged over it. */
function usePageDrop(receive: (files: File[]) => void) {
    const [dragging, setDragging] = useState(false);
    useEffect(() => {
        let depth = 0;
        const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
        const onEnter = (event: DragEvent) => {
            if (!hasFiles(event)) return;
            depth++;
            setDragging(true);
        };
        const onLeave = (event: DragEvent) => {
            if (!hasFiles(event)) return;
            depth = Math.max(0, depth - 1);
            if (depth === 0) setDragging(false);
        };
        const onOver = (event: DragEvent) => {
            if (hasFiles(event)) event.preventDefault();
        };
        const onDrop = (event: DragEvent) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            depth = 0;
            setDragging(false);
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (files.length) receive(files);
        };
        const onPaste = (event: ClipboardEvent) => {
            const files = Array.from(event.clipboardData?.files ?? []).filter((item) => item.type.startsWith("image/"));
            if (!files.length) return;
            event.preventDefault();
            receive(files);
        };
        window.addEventListener("dragenter", onEnter);
        window.addEventListener("dragleave", onLeave);
        window.addEventListener("dragover", onOver);
        window.addEventListener("drop", onDrop);
        window.addEventListener("paste", onPaste);
        return () => {
            window.removeEventListener("dragenter", onEnter);
            window.removeEventListener("dragleave", onLeave);
            window.removeEventListener("dragover", onOver);
            window.removeEventListener("drop", onDrop);
            window.removeEventListener("paste", onPaste);
        };
    }, [receive]);
    return dragging;
}

/** "Tool › file". On small screens, where the sidebar is hidden, the tool name also switches tools. */
function ToolBreadcrumb({ tool, fileName, onRename, onNewImage }: { tool: ToolKey; fileName?: string; onRename?: (name: string) => void; onNewImage?: () => void }) {
    const t = useT();
    const copy = t.studio;
    const { open, setOpen, wrap, trigger } = usePopover();
    const Icon = TOOL_ICONS[tool];
    const menuRef = useRef<HTMLDivElement>(null);

    return (
        <nav aria-label={copy.breadcrumb} className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
            <span className="hidden shrink-0 items-center gap-2 lg:flex">
                <span className="grid size-6 shrink-0 place-items-center rounded-md bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]">
                    <Icon className="size-3.5" strokeWidth={2} aria-hidden />
                </span>
                <span className="truncate font-medium text-primary" aria-current="page">
                    {t.nav.toolItems[tool].title}
                </span>
            </span>
            <div ref={wrap} className="relative min-w-0 lg:hidden">
                <button
                    ref={trigger}
                    type="button"
                    onClick={() => setOpen((value) => !value)}
                    aria-expanded={open}
                    aria-haspopup="true"
                    aria-label={`${copy.switchTool}: ${t.nav.toolItems[tool].title}`}
                    className="flex h-9 max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 font-medium text-primary outline-focus-ring hover:bg-primary_hover focus-visible:outline-2 pointer-coarse:h-11"
                >
                    <Icon className="size-4 shrink-0 text-tertiary" aria-hidden />
                    <span className="truncate">{t.nav.toolItems[tool].title}</span>
                    <ChevronDown className={cn("size-4 shrink-0 text-quaternary transition-transform duration-200", open && "rotate-180")} aria-hidden />
                </button>
                {open && (
                    <div ref={menuRef} className="material-popover absolute top-full left-0 z-50 mt-2 max-h-[min(32rem,calc(100dvh-5rem))] w-64 max-w-[calc(100vw-1.5rem)] origin-top-left overflow-y-auto rounded-2xl p-1.5">
                        {studioToolGroups(tool).flatMap((group) => group.items).map((item) => {
                            const ItemIcon = TOOL_ICONS[item.key];
                            const current = !item.alias && (item.key === tool || Boolean(item.members?.some((member) => member.key === tool)));
                            return (
                                <Link
                                    key={item.key}
                                    to={item.href}
                                    onClick={() => setOpen(false)}
                                    aria-current={current ? "page" : undefined}
                                    className={cn(
                                        "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium outline-focus-ring focus-visible:outline-2",
                                        current ? "nav-fill text-primary" : "text-secondary hover:nav-fill hover:text-primary",
                                    )}
                                >
                                    <ItemIcon className="size-4 shrink-0" style={{ color: TOOL_ACCENT[item.key] }} aria-hidden />
                                    {t.nav.toolItems[item.key].title}
                                </Link>
                            );
                        })}
                        {onNewImage && (
                            <button
                                type="button"
                                onClick={() => {
                                    setOpen(false);
                                    onNewImage();
                                }}
                                className="mt-1 flex h-11 w-full cursor-pointer items-center gap-3 rounded-xl border-t border-[var(--card-line)] px-3 text-sm font-medium text-secondary outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2"
                            >
                                <ImagePlus className="size-4 shrink-0" aria-hidden />
                                {copy.newImage}
                            </button>
                        )}
                    </div>
                )}
            </div>
            {fileName && (
                <>
                    <span aria-hidden className="hidden text-quaternary md:inline">
                        ›
                    </span>
                    <FileName name={fileName} onRename={onRename} />
                </>
            )}
        </nav>
    );
}

/**
 * The image's name in the top bar: shown in full when there's room (it truncates only when the bar is tight,
 * with the whole name on hover), and a click turns it into a field. Enter or leaving the field keeps the
 * new name, Escape cancels, and the file extension is kept unless a new one is typed.
 */
function FileName({ name, onRename }: { name: string; onRename?: (name: string) => void }) {
    const t = useT();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(name);
    const field = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!editing) return;
        const dot = name.lastIndexOf(".");
        field.current?.focus();
        field.current?.setSelectionRange(0, dot > 0 ? dot : name.length);
    }, [editing, name]);

    const commit = () => {
        setEditing(false);
        // No path or reserved characters: the name becomes the download's file name.
        const next = draft.replace(/[\\/:*?"<>|]/g, "").trim();
        if (!next || next === name) return;
        const dot = name.lastIndexOf(".");
        onRename?.(/\.[a-z0-9]{2,5}$/i.test(next) || dot <= 0 ? next : next + name.slice(dot));
    };

    if (!onRename) {
        return (
            <span className="hidden min-w-0 truncate text-tertiary md:block" title={name}>
                {name}
            </span>
        );
    }
    if (editing) {
        return (
            <input
                ref={field}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === "Enter") commit();
                    if (event.key === "Escape") setEditing(false);
                }}
                aria-label={t.studio.renameImage}
                spellCheck={false}
                maxLength={120}
                style={{ width: `${Math.min(Math.max(draft.length, 8) + 2, 48)}ch` }}
                className="hidden h-8 max-w-full min-w-0 rounded-lg border border-[var(--brand-line)] bg-primary px-2 text-sm text-primary outline-focus-ring focus-visible:outline-2 md:block"
            />
        );
    }
    return (
        <button
            type="button"
            onClick={() => {
                setDraft(name);
                setEditing(true);
            }}
            title={`${name} — ${t.studio.renameImage}`}
            aria-label={`${t.studio.renameImage}: ${name}`}
            className="hidden h-8 min-w-0 cursor-text truncate rounded-lg px-2 text-left text-tertiary outline-focus-ring transition-colors duration-150 hover:bg-primary_hover hover:text-primary focus-visible:outline-2 md:block"
        >
            {name}
        </button>
    );
}

/** Asks before throwing edits away. The safe choice is focused, and Escape keeps editing. */
function ConfirmDiscard({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
    const t = useT();
    const copy = t.studio;
    const keepRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        keepRef.current?.focus();
        const onKey = (event: KeyboardEvent) => event.key === "Escape" && onKeep();
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onKeep]);
    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
            <div aria-hidden className="absolute inset-0 bg-[rgb(17_19_24/0.32)] backdrop-blur-[2px]" onClick={onKeep} />
            <div role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-body" className="studio-dialog glass-strong relative w-full max-w-sm rounded-[1.375rem] p-5">
                <h2 id="discard-title" className="text-md font-semibold text-primary">
                    {copy.discardTitle}
                </h2>
                <p id="discard-body" className="mt-1.5 text-sm text-tertiary">
                    {copy.discardBody}
                </p>
                <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button ref={keepRef} type="button" onClick={onKeep} className="h-10 cursor-pointer rounded-full bg-primary px-4 text-sm font-semibold text-secondary shadow-[0_0_0_1px_var(--card-line)] outline-focus-ring hover:text-primary focus-visible:outline-2 pointer-coarse:h-11">
                        {copy.keepEditing}
                    </button>
                    <button type="button" onClick={onDiscard} className="h-10 cursor-pointer rounded-full bg-error-solid px-4 text-sm font-semibold text-white outline-focus-ring hover:bg-error-solid_hover focus-visible:outline-2 pointer-coarse:h-11">
                        {copy.discard}
                    </button>
                </div>
            </div>
        </div>
    );
}
