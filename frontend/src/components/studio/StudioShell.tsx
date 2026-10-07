import { ChevronDown, ImagePlus, LoaderCircle, Menu } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LogoMark } from "@/components/common/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { TOOL_ICONS } from "@/components/layout/toolIcons";
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
}

const StudioContext = createContext<StudioContextValue>({ openPicker: () => undefined, uploadError: null, clearImage: () => undefined });
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

    const iconButton =
        "grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-secondary transition-colors duration-150 outline-focus-ring hover:bg-primary_hover hover:text-primary focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-35 pointer-coarse:size-11";

    return (
        <StudioContext.Provider value={{ openPicker, uploadError: upload.error, clearImage: requestNewImage }}>
            <div className="flex min-h-dvh flex-col bg-secondary lg:h-dvh">
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

                <header className="flex h-16 shrink-0 items-center gap-2 border-b border-secondary bg-primary px-3 sm:gap-3 sm:px-5">
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
                    <Link to={ROUTES.home} aria-label={t.common.homeAria} className="flex shrink-0 items-center gap-2 rounded-lg text-md font-semibold tracking-[-0.01em] text-primary outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2">
                        <LogoMark />
                        <span className="hidden sm:inline">
                            {copy.name} <span className="text-[var(--brand)]">{copy.suffix}</span>
                        </span>
                    </Link>
                    <span aria-hidden className="mx-1 hidden h-6 w-px bg-[var(--card-line)] md:block" />
                    <ToolBreadcrumb tool={tool} fileName={original?.name} onNewImage={original ? requestNewImage : undefined} />

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
                        {/* grid, not flex: the sun and moon share one cell and swap in place, as on the home page. */}
                        <ThemeToggle className="hidden sm:grid" />
                        {working && exportSlot && <div className="ml-1">{exportSlot}</div>}
                    </div>
                </header>

                <div className="flex flex-1 flex-col gap-3 p-2 sm:p-3 lg:min-h-0 lg:flex-row">
                    <StudioSidebar current={tool} id={sidebarId} collapsed={sidebar.collapsed} drawerOpen={sidebar.drawerOpen} onCloseDrawer={sidebar.closeDrawer} />

                    {/* A section, not <main>: the page's <main> (AppLayout) already contains the whole studio. */}
                    <section aria-labelledby={headingId} className="flex min-w-0 flex-1 flex-col gap-3 rounded-2xl border border-[var(--card-line)] bg-primary p-2 sm:p-3 lg:min-h-0">
                        {/* The page's heading: the tool's name (shown in the header bar; here for search engines and screen readers). */}
                        <h1 id={headingId} className="sr-only">
                            {t.nav.toolItems[tool].title}
                        </h1>
                        {children}
                    </section>

                    {working && (
                        <aside aria-label={panelLabel} className={cn("flex shrink-0 flex-col overflow-hidden rounded-2xl border border-[var(--card-line)] bg-primary lg:min-h-0", panelWidth === "compact" ? "lg:w-[17rem] xl:w-[18rem]" : isDocumentTool(tool) ? "lg:w-[20rem] xl:w-[21.5rem]" : "lg:w-[22.5rem] xl:w-[24rem]", mobilePanel === "none" && "hidden lg:flex")}>
                            {/* The panel's own heading, so its sections' headings sit under it in the outline. */}
                            <h2 className="sr-only">{panelLabel}</h2>
                            {panel}
                        </aside>
                    )}
                </div>

                {/* Drop anywhere: the whole studio is the target. */}
                <div aria-hidden={!dragging} className={cn("pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6 transition-opacity duration-200", dragging ? "opacity-100" : "opacity-0")}>
                    <div className="absolute inset-0 bg-primary/70 backdrop-blur-sm" />
                    <div className="relative flex size-full items-center justify-center rounded-3xl border-2 border-dashed border-[var(--color-focus-ring)]">
                        <p className="text-tile text-primary">{t.upload.dropToOpen}</p>
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
                        "fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-error_subtle bg-primary px-4 py-2.5 text-sm font-medium text-error-primary shadow-lg transition-[opacity,translate] duration-200",
                        upload.error ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
                    )}
                >
                    {upload.error}
                </p>
                {/* A file on its way in, e.g. a HEIC photo being converted. */}
                <p
                    role="status"
                    className={cn(
                        "fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-[var(--card-line)] bg-primary px-4 py-2.5 text-sm font-medium text-secondary shadow-lg transition-[opacity,translate] duration-200",
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
function ToolBreadcrumb({ tool, fileName, onNewImage }: { tool: ToolKey; fileName?: string; onNewImage?: () => void }) {
    const t = useT();
    const copy = t.studio;
    const { open, setOpen, wrap, trigger } = usePopover();
    const Icon = TOOL_ICONS[tool];
    const menuRef = useRef<HTMLDivElement>(null);

    return (
        <nav aria-label={copy.breadcrumb} className="flex min-w-0 flex-1 items-center gap-1.5 text-sm lg:flex-none">
            <span className="hidden min-w-0 items-center gap-1.5 lg:flex">
                <Icon className="size-4 shrink-0 text-tertiary" aria-hidden />
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
                    <div ref={menuRef} className="absolute top-full left-0 z-50 mt-2 w-64 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-[var(--card-line)] bg-primary p-1.5 shadow-xl">
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
                                        current ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-secondary hover:bg-primary_hover hover:text-primary",
                                    )}
                                >
                                    <ItemIcon className="size-4 shrink-0" aria-hidden />
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
                    <span className="hidden max-w-56 truncate text-tertiary md:block" title={fileName}>
                        {fileName}
                    </span>
                </>
            )}
        </nav>
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
            <div aria-hidden className="absolute inset-0 bg-neutral-950/40" onClick={onKeep} />
            <div role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-body" className="animate-enter relative w-full max-w-sm rounded-2xl border border-[var(--card-line)] bg-primary p-5 shadow-xl [--i:-1]">
                <h2 id="discard-title" className="text-md font-semibold text-primary">
                    {copy.discardTitle}
                </h2>
                <p id="discard-body" className="mt-1.5 text-sm text-tertiary">
                    {copy.discardBody}
                </p>
                <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button ref={keepRef} type="button" onClick={onKeep} className="h-10 cursor-pointer rounded-lg border border-[var(--card-line)] px-4 text-sm font-semibold text-secondary outline-focus-ring hover:bg-primary_hover focus-visible:outline-2 pointer-coarse:h-11">
                        {copy.keepEditing}
                    </button>
                    <button type="button" onClick={onDiscard} className="h-10 cursor-pointer rounded-lg bg-error-solid px-4 text-sm font-semibold text-white outline-focus-ring hover:bg-error-solid_hover focus-visible:outline-2 pointer-coarse:h-11">
                        {copy.discard}
                    </button>
                </div>
            </div>
        </div>
    );
}
