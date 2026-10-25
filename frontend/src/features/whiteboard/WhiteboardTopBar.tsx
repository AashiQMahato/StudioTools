import { languages } from "@excalidraw/excalidraw";
import {
    BookOpen,
    ChevronDown,
    ChevronLeft,
    CircleAlert,
    CircleCheck,
    Command,
    Copy,
    Download,
    Ellipsis,
    ExternalLink,
    FileCode,
    FileImage,
    FilePlus2,
    FolderOpen,
    Grid3x3,
    Keyboard,
    Languages,
    LoaderCircle,
    Magnet,
    Maximize,
    Moon,
    Palette,
    Redo2,
    Save,
    ScanSearch,
    Search,
    SlidersHorizontal,
    Undo2,
    ZoomIn,
    ZoomOut,
} from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { Button, Link, MenuTrigger, SubmenuTrigger } from "react-aria-components";
import { LogoMark } from "@/components/common/Logo";
import { useT } from "@/i18n";
import { ROUTES } from "@/lib/constants/routes";
import { cn } from "@/lib/utils/cn";
import { IconButton, MenuDivider, MenuPopover, Tip, WbMenu, WbMenuItem } from "./ui";
import type { SaveStatus } from "./useAutosave";
import { zoomLabel } from "./viewport";

const MAC = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform);
const mod = (key: string) => (MAC ? `⌘${key}` : `Ctrl+${key}`);

/** The canvas colours the editor itself offers (its dark theme inverts them). */
const CANVAS_BACKGROUNDS = ["#ffffff", "#f8f9fa", "#f5faff", "#fffce8", "#fdf8f6"] as const;

export type ExportAction = "png" | "svg" | "copy" | "file" | "options";
export type MoreAction = "open" | "new" | "library" | "find" | "commandPalette" | "shortcuts" | "fit" | "resetZoom" | "theme" | "grid" | "snap" | "home";

export interface TopBarProps {
    name: string;
    onRename: (name: string) => void;
    /** Phones: undo/redo live in the editor's bottom bar and zoom moves into the menu. */
    compact: boolean;
    history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
    zoom: number;
    hasSelection: boolean;
    onZoom: (action: "in" | "out" | "reset" | "fit" | "selection") => void;
    status: SaveStatus;
    savedAt: number | null;
    empty: boolean;
    onExport: (action: ExportAction) => void;
    onMore: (action: MoreAction) => void;
    dark: boolean;
    grid: boolean;
    snap: boolean;
    background: string;
    onBackground: (color: string) => void;
    langCode: string;
    onLanguage: (code: string) => void;
}

/** The board's title, edited in place: Enter or leaving the field keeps it, Escape puts it back. */
function TitleField({ name, onRename }: { name: string; onRename: (name: string) => void }) {
    const t = useT().whiteboard;
    // Mounted per name (see its key), so a rename from elsewhere starts a fresh draft.
    const [draft, setDraft] = useState(name);
    const commit = () => {
        const next = draft.trim() || t.untitled;
        setDraft(next);
        if (next !== name) onRename(next);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
            setDraft(name);
            // Let the blur commit the restored name, and keep Escape from reaching the editor.
            event.stopPropagation();
            requestAnimationFrame(() => (event.target as HTMLInputElement).blur());
        }
    };
    return (
        <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            onFocus={(event) => event.currentTarget.select()}
            aria-label={t.titleLabel}
            maxLength={120}
            spellCheck={false}
            className="h-8 min-w-0 max-w-[22rem] flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 text-sm font-semibold text-primary outline-none transition-colors duration-100 [field-sizing:content] hover:border-secondary focus:border-[var(--brand)] focus:bg-primary focus:shadow-[0_0_0_3px_var(--brand-soft)] sm:flex-none"
        />
    );
}

function SaveIndicator({ status, savedAt }: { status: SaveStatus; savedAt: number | null }) {
    const copy = useT().whiteboard.status;
    const hint = status === "failed" ? copy.failedHint : savedAt ? copy.savedAt(new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) : copy.savedHint;
    const Icon = status === "failed" ? CircleAlert : status === "pending" ? LoaderCircle : CircleCheck;
    return (
        <span role="status" title={hint} className={cn("flex h-9 shrink-0 items-center gap-1.5 px-1.5 text-xs font-medium", status === "failed" ? "text-[#b54708] dark:text-[#fdb022]" : "text-tertiary")}>
            <Icon className={cn("size-4", status === "pending" && "animate-spin [animation-duration:1.4s]")} strokeWidth={1.75} aria-hidden />
            <span className="hidden lg:inline">{status === "failed" ? copy.failed : status === "pending" ? copy.saving : copy.saved}</span>
            <span className="sr-only">{hint}</span>
        </span>
    );
}

const Divider = ({ className }: { className?: string }) => <span aria-hidden className={cn("mx-1 h-5 w-px shrink-0 bg-[var(--color-border-secondary)]", className)} />;

/**
 * The whiteboard's own header: where you are (Studio Tools › Whiteboard › board title), then the
 * actions used most — undo/redo, zoom, save state, export — with everything else in one menu.
 */
export function WhiteboardTopBar(props: TopBarProps) {
    const { compact, history, zoom, onZoom, empty } = props;
    const t = useT();
    const copy = t.whiteboard;

    return (
        <header className="relative z-10 flex h-13 shrink-0 items-center gap-1 border-b border-secondary bg-primary pr-2 pl-1.5 sm:pr-3 sm:pl-2">
            <Tip label={copy.back}>
                <Link href={ROUTES.home} aria-label={copy.back} className="flex h-9 shrink-0 cursor-default items-center gap-1 rounded-lg pr-1.5 pl-1 text-tertiary outline-none hovered:bg-primary_hover hovered:text-primary focus-visible:outline-2 focus-visible:outline-[var(--brand)]">
                    <ChevronLeft className="size-4" strokeWidth={2} aria-hidden />
                    <LogoMark className="size-6" />
                </Link>
            </Tip>
            <span className="hidden shrink-0 pl-1 text-sm font-semibold tracking-[-0.01em] text-primary md:inline">{copy.title}</span>
            <span aria-hidden className="hidden px-1 text-quaternary md:inline">/</span>
            <TitleField key={props.name} name={props.name} onRename={props.onRename} />

            <span className="min-w-1 flex-1" />

            {!compact && (
                <>
                    <IconButton icon={Undo2} label={copy.undo} shortcut={mod("Z")} isDisabled={!history.canUndo} onPress={history.undo} />
                    <IconButton icon={Redo2} label={copy.redo} shortcut={MAC ? "⇧⌘Z" : "Ctrl+Shift+Z"} isDisabled={!history.canRedo} onPress={history.redo} />
                    <Divider />
                    <div className="hidden items-center sm:flex">
                        <IconButton icon={ZoomOut} label={copy.zoomOut} shortcut={mod("−")} onPress={() => onZoom("out")} />
                        <MenuTrigger>
                            <Tip label={copy.zoomMenu}>
                                <Button aria-label={`${copy.zoomMenu}: ${zoomLabel(zoom)}`} className="flex h-9 w-[4.25rem] cursor-default items-center justify-center gap-0.5 rounded-lg text-xs font-semibold text-secondary tabular-nums outline-none hovered:bg-primary_hover hovered:text-primary pressed:bg-[var(--color-bg-active)] focus-visible:outline-2 focus-visible:outline-[var(--brand)]">
                                    {zoomLabel(zoom)}
                                    <ChevronDown className="size-3.5 text-quaternary" aria-hidden />
                                </Button>
                            </Tip>
                            <MenuPopover placement="bottom">
                                <WbMenu aria-label={copy.zoomMenu} disabledKeys={props.hasSelection ? [] : ["selection"]} onAction={(key) => onZoom(key as "in" | "out" | "reset" | "fit" | "selection")}>
                                    <WbMenuItem id="in" icon={ZoomIn} shortcut={mod("+")}>{copy.zoomIn}</WbMenuItem>
                                    <WbMenuItem id="out" icon={ZoomOut} shortcut={mod("−")}>{copy.zoomOut}</WbMenuItem>
                                    <MenuDivider />
                                    <WbMenuItem id="reset" shortcut={mod("0")}>{copy.resetZoom}</WbMenuItem>
                                    <WbMenuItem id="fit" icon={Maximize} shortcut="⇧1">{copy.zoomToFit}</WbMenuItem>
                                    <WbMenuItem id="selection" icon={ScanSearch} shortcut="⇧2">{copy.zoomToSelection}</WbMenuItem>
                                </WbMenu>
                            </MenuPopover>
                        </MenuTrigger>
                        <IconButton icon={ZoomIn} label={copy.zoomIn} shortcut={mod("+")} onPress={() => onZoom("in")} />
                        <Divider />
                    </div>
                </>
            )}

            <SaveIndicator status={props.status} savedAt={props.savedAt} />
            <IconButton icon={BookOpen} label={copy.library} className="hidden md:grid" onPress={() => props.onMore("library")} />

            <MenuTrigger>
                <Tip label={copy.exportMenu}>
                    <Button
                        aria-label={copy.exportMenu}
                        className="ml-1 flex h-9 shrink-0 cursor-default items-center gap-1.5 rounded-lg bg-[var(--color-bg-brand-solid)] px-2.5 text-sm font-semibold text-[var(--color-text-primary_on-brand)] outline-none hovered:bg-[var(--color-bg-brand-solid_hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] sm:px-3"
                    >
                        <Download className="size-4" strokeWidth={2} aria-hidden />
                        <span className="hidden sm:inline">{copy.exportMenu}</span>
                    </Button>
                </Tip>
                <MenuPopover placement="bottom end">
                    <WbMenu aria-label={copy.exportMenu} disabledKeys={empty ? ["png", "svg", "copy"] : []} onAction={(key) => props.onExport(key as ExportAction)}>
                        <WbMenuItem id="png" icon={FileImage}>{copy.exportPng}</WbMenuItem>
                        <WbMenuItem id="svg" icon={FileCode}>{copy.exportSvg}</WbMenuItem>
                        <WbMenuItem id="copy" icon={Copy} shortcut={MAC ? "⇧⌥C" : "Shift+Alt+C"}>{copy.copyPng}</WbMenuItem>
                        <MenuDivider />
                        <WbMenuItem id="file" icon={Save}>{copy.saveFile}</WbMenuItem>
                        <MenuDivider />
                        <WbMenuItem id="options" icon={SlidersHorizontal} shortcut={MAC ? "⇧⌘E" : "Ctrl+Shift+E"}>{copy.exportOptions}</WbMenuItem>
                    </WbMenu>
                </MenuPopover>
            </MenuTrigger>

            <MenuTrigger>
                <IconButton icon={Ellipsis} label={copy.more} />
                <MenuPopover placement="bottom end" className="min-w-64">
                    <WbMenu aria-label={copy.more} onAction={(key) => props.onMore(key as MoreAction)}>
                        <WbMenuItem id="open" icon={FolderOpen} shortcut={mod("O")}>{copy.open}</WbMenuItem>
                        <WbMenuItem id="new" icon={FilePlus2}>{copy.newBoard}</WbMenuItem>
                        <MenuDivider />
                        <WbMenuItem id="library" icon={BookOpen} className="md:hidden">{copy.library}</WbMenuItem>
                        <WbMenuItem id="find" icon={Search} shortcut={mod("F")}>{copy.find}</WbMenuItem>
                        <WbMenuItem id="commandPalette" icon={Command} shortcut={mod("/")}>{copy.commandPalette}</WbMenuItem>
                        <WbMenuItem id="shortcuts" icon={Keyboard} shortcut="?">{copy.shortcuts}</WbMenuItem>
                        {compact && (
                            <>
                                <MenuDivider />
                                <WbMenuItem id="fit" icon={Maximize}>{copy.zoomToFit}</WbMenuItem>
                                <WbMenuItem id="resetZoom" icon={ZoomIn}>{`${copy.resetZoom} (${zoomLabel(zoom)})`}</WbMenuItem>
                            </>
                        )}
                        <MenuDivider />
                        <WbMenuItem id="theme" icon={Moon} shortcut={MAC ? "⇧⌥D" : "Shift+Alt+D"} checked={props.dark}>{copy.darkMode}</WbMenuItem>
                        <WbMenuItem id="grid" icon={Grid3x3} shortcut={mod("'")} checked={props.grid}>{copy.grid}</WbMenuItem>
                        <WbMenuItem id="snap" icon={Magnet} shortcut={MAC ? "⌥S" : "Alt+S"} checked={props.snap}>{copy.snap}</WbMenuItem>
                        <SubmenuTrigger>
                            <WbMenuItem icon={Palette} submenu>{copy.canvasBackground}</WbMenuItem>
                            <MenuPopover>
                                <WbMenu aria-label={copy.canvasBackground} onAction={(key) => props.onBackground(String(key))}>
                                    {CANVAS_BACKGROUNDS.map((color) => (
                                        <WbMenuItem key={color} id={color} swatch={color} checked={props.background.toLowerCase() === color}>
                                            {copy.backgrounds[color]}
                                        </WbMenuItem>
                                    ))}
                                </WbMenu>
                            </MenuPopover>
                        </SubmenuTrigger>
                        <SubmenuTrigger>
                            <WbMenuItem icon={Languages} submenu>{copy.language}</WbMenuItem>
                            <MenuPopover className="max-h-80">
                                <WbMenu aria-label={copy.language} onAction={(key) => props.onLanguage(String(key))}>
                                    {languages.map((language) => (
                                        <WbMenuItem key={language.code} id={language.code} checked={props.langCode === language.code}>
                                            {language.label}
                                        </WbMenuItem>
                                    ))}
                                </WbMenu>
                            </MenuPopover>
                        </SubmenuTrigger>
                        <MenuDivider />
                        <WbMenuItem id="home" icon={ChevronLeft}>{copy.back}</WbMenuItem>
                        <WbMenuItem href="https://github.com/excalidraw/excalidraw" target="_blank" rel="noreferrer" icon={ExternalLink} className="text-xs text-tertiary">
                            {copy.about}
                        </WbMenuItem>
                    </WbMenu>
                </MenuPopover>
            </MenuTrigger>
        </header>
    );
}
