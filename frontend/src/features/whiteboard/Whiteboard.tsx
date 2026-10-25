import "./assetPath";
import { CaptureUpdateAction, Excalidraw, languages, loadFromBlob, MIME_TYPES, useHandleLibrary, WelcomeScreen } from "@excalidraw/excalidraw";
import type { NormalizedZoomValue } from "@excalidraw/excalidraw/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, ExcalidrawInitialDataState, LibraryItems, ToolType } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { LogoMark } from "@/components/common/Logo";
import { useLocale, useT } from "@/i18n";
import { ROUTES } from "@/lib/constants/routes";
import { copyPng, exportPng, exportSvg, fileBaseName, openFile, saveExcalidrawFile } from "./fileActions";
import { loadLibrary, loadSavedScene, readSavedScene, saveLibrary, setAsideUnreadableScene } from "./storage";
import { ConfirmDialog } from "./ui";
import { useAutosave } from "./useAutosave";
import { useEditorHistory } from "./useEditorHistory";
import { ZOOM_STEP, zoomAroundCenter } from "./viewport";
import { type ExportAction, type MoreAction, WhiteboardTopBar } from "./WhiteboardTopBar";
import { WhiteboardToolbar } from "./WhiteboardToolbar";
import "./whiteboard.css";

const LANGUAGE_KEY = "whiteboard-language";
const UI_OPTIONS = { canvasActions: { toggleTheme: true } };
const THEME_KEY = "theme"; // The site's own theme setting (useTheme), so both stay in step.
/** From this width the tools sit in a rail beside the canvas; below it, in a row above it. */
const RAIL_QUERY = "(min-width: 800px)";

type Theme = "light" | "dark";
const siteTheme = (): Theme => (document.documentElement.classList.contains("dark-mode") ? "dark" : "light");

function useMediaQuery(query: string) {
    return useSyncExternalStore(
        (onChange) => {
            const media = window.matchMedia(query);
            media.addEventListener("change", onChange);
            return () => media.removeEventListener("change", onChange);
        },
        () => window.matchMedia(query).matches,
    );
}

/** The editor's language: the one picked in its menu, else the site's (it has no Nepali, so English then). */
function initialLanguage(siteLocale: string) {
    try {
        const saved = localStorage.getItem(LANGUAGE_KEY);
        if (saved && languages.some((language) => language.code === saved)) return saved;
    } catch {
        // Storage unavailable: fall through to the site's language.
    }
    return languages.some((language) => language.code === siteLocale) ? siteLocale : "en";
}

/**
 * The last board saved in this browser, restored through the package's own loader (which checks and
 * migrates it). A record that can't be read is set aside, never silently overwritten.
 */
async function restoreSavedDrawing(): Promise<(ExcalidrawInitialDataState & { name?: string }) | null> {
    const raw = await loadSavedScene();
    if (raw === undefined) return null;
    const saved = readSavedScene(raw);
    try {
        if (!saved) throw new Error("Unrecognised whiteboard save");
        const data = await loadFromBlob(new Blob([saved.scene], { type: MIME_TYPES.excalidraw }), null, null);
        const appState: Partial<AppState> = { ...data.appState };
        if (saved.view) Object.assign(appState, { scrollX: saved.view.scrollX, scrollY: saved.view.scrollY, zoom: { value: saved.view.zoom } });
        return { elements: data.elements, appState, files: data.files, scrollToContent: !saved.view, name: saved.name };
    } catch {
        await setAsideUnreadableScene(raw);
        return null;
    }
}

const libraryAdapter = {
    load: async () => {
        const stored = await loadLibrary();
        return stored && typeof stored === "object" && Array.isArray((stored as { libraryItems?: unknown }).libraryItems) ? (stored as { libraryItems: LibraryItems }) : null;
    },
    save: saveLibrary,
};

/** What the shell shows of the editor's state, updated from its change events. */
interface Snapshot {
    tool: ToolType;
    locked: boolean;
    zoom: number;
    theme: Theme;
    name: string;
    empty: boolean;
    hasSelection: boolean;
    background: string;
    grid: boolean;
    snap: boolean;
}

function snapshotOf(elements: readonly OrderedExcalidrawElement[], appState: AppState): Snapshot {
    return {
        tool: appState.activeTool.type === "custom" ? "selection" : appState.activeTool.type,
        locked: appState.activeTool.locked,
        zoom: appState.zoom.value,
        theme: appState.theme,
        name: appState.name ?? "",
        empty: !elements.some((element) => !element.isDeleted),
        hasSelection: Object.keys(appState.selectedElementIds).length > 0,
        background: appState.viewBackgroundColor,
        grid: appState.gridModeEnabled,
        snap: appState.objectsSnapModeEnabled,
    };
}

const sameSnapshot = (a: Snapshot, b: Snapshot) => (Object.keys(a) as (keyof Snapshot)[]).every((key) => a[key] === b[key]);

/**
 * Studio Tools' whiteboard: the Excalidraw drawing engine (canvas, shapes, selection, styling panel,
 * shortcuts, dialogs, library) inside a Studio Tools shell — a header with the board's title, history,
 * zoom, save state and export, and a docked tool strip — all driven through the package's public API.
 */
export function Whiteboard() {
    const t = useT();
    const copy = t.whiteboard;
    const navigate = useNavigate();
    const siteLocale = useLocale((state) => state.locale);
    const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
    const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null | undefined>(undefined);
    const [langCode, setLangCode] = useState(() => initialLanguage(siteLocale));
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);
    const [editorMobile, setEditorMobile] = useState(false);
    const [confirm, setConfirm] = useState<"new" | "open" | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const pendingFile = useRef<File | null>(null);
    const theme = useRef<Theme>(siteTheme());
    const wide = useMediaQuery(RAIL_QUERY);
    const autosave = useAutosave();
    const scheduleSave = autosave.schedule;
    // A new board's title, as it was when the page opened (restoring runs once).
    const untitled = useRef(copy.untitled);
    const history = useEditorHistory(canvas);

    useHandleLibrary({ excalidrawAPI: api, adapter: libraryAdapter });

    // Restore before the editor mounts, so its first change can never overwrite the saved board.
    useEffect(() => {
        let active = true;
        void restoreSavedDrawing().then((data) => {
            if (!active) return;
            // The site's theme wins over the one saved with the drawing; a board always has a title.
            setInitialData({ ...data, appState: { ...data?.appState, theme: theme.current, name: data?.name ?? untitled.current } });
        });
        return () => {
            active = false;
        };
    }, []);

    // The editor switches to its phone layout by its own width; the header follows it.
    useEffect(() => {
        if (!canvas) return;
        const read = () => setEditorMobile(Boolean(canvas.querySelector(".excalidraw--mobile")));
        read();
        const observer = new MutationObserver(read);
        observer.observe(canvas, { subtree: true, attributes: true, attributeFilter: ["class"], childList: true });
        return () => observer.disconnect();
    }, [canvas]);

    const onChange = useCallback(
        (elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
            if (appState.theme !== theme.current) {
                // The editor's theme toggle sets the site's theme too, so leaving keeps the same look.
                theme.current = appState.theme;
                document.documentElement.classList.toggle("dark-mode", appState.theme === "dark");
                try {
                    localStorage.setItem(THEME_KEY, appState.theme);
                } catch {
                    // Not persisted; it still applies for this visit.
                }
            }
            const next = snapshotOf(elements, appState);
            setSnapshot((previous) => (previous && sameSnapshot(previous, next) ? previous : next));
            scheduleSave({ elements, appState, files });
        },
        [scheduleSave],
    );

    const toast = useCallback((message: string) => api?.setToast({ message, closable: true, duration: 3000 }), [api]);
    const baseName = () => fileBaseName(api?.getName() ?? "", copy.untitled);

    const zoom = (action: "in" | "out" | "reset" | "fit" | "selection") => {
        if (!api) return;
        const state = api.getAppState();
        if (action === "fit") return api.scrollToContent(undefined, { fitToContent: true, animate: true });
        if (action === "selection") {
            const selected = api.getSceneElements().filter((element) => state.selectedElementIds[element.id]);
            if (selected.length) api.scrollToContent(selected, { fitToContent: true, animate: true });
            return;
        }
        const target = action === "reset" ? 1 : state.zoom.value + (action === "in" ? ZOOM_STEP : -ZOOM_STEP);
        const view = zoomAroundCenter({ scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value, width: state.width, height: state.height }, target);
        api.updateScene({ appState: { zoom: { value: view.zoom as NormalizedZoomValue }, scrollX: view.scrollX, scrollY: view.scrollY } });
    };

    const onExport = async (action: ExportAction) => {
        if (!api) return;
        if (action === "options") return api.updateScene({ appState: { openDialog: { name: "imageExport" } } });
        if (action === "file") return saveExcalidrawFile(api, baseName());
        if (snapshot?.empty) return toast(copy.nothingToExport);
        try {
            if (action === "png") await exportPng(api, baseName());
            if (action === "svg") await exportSvg(api, baseName());
            if (action === "copy") {
                await copyPng(api);
                toast(copy.copied);
            }
        } catch {
            toast(action === "copy" ? copy.copyFailed : copy.exportFailed);
        }
    };

    const newBoard = () => {
        if (!api) return;
        // Recorded in the editor's history, so Undo brings the board back.
        api.updateScene({ elements: [], appState: { name: copy.untitled }, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
        api.updateScene({ appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 as NormalizedZoomValue } } });
    };

    const open = async (file: File) => {
        if (!api) return;
        try {
            const kind = await openFile(api, file);
            if (kind === "library") toast(copy.libraryAdded);
            else api.updateScene({ appState: { name: fileBaseName(file.name.replace(/\.(excalidraw|json|png|svg)$/i, ""), copy.untitled) } });
        } catch {
            toast(copy.openFailed);
        }
    };

    const onFilePicked = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        // A library only adds to the library; a drawing replaces the board, so ask first unless it's empty.
        if (snapshot?.empty || /\.excalidrawlib$/i.test(file.name)) return void open(file);
        pendingFile.current = file;
        setConfirm("open");
    };

    const onMore = (action: MoreAction) => {
        if (!api) return;
        const state = api.getAppState();
        switch (action) {
            case "open":
                return fileInput.current?.click();
            case "new":
                return snapshot?.empty ? newBoard() : setConfirm("new");
            case "library":
                return api.toggleSidebar({ name: "default", tab: "library" });
            case "find":
                return api.toggleSidebar({ name: "default", tab: "search" });
            case "commandPalette":
                return api.updateScene({ appState: { openDialog: { name: "commandPalette" } } });
            case "shortcuts":
                return api.updateScene({ appState: { openDialog: { name: "help" } } });
            case "fit":
                return zoom("fit");
            case "resetZoom":
                return zoom("reset");
            case "theme":
                return api.updateScene({ appState: { theme: state.theme === "dark" ? "light" : "dark" } });
            case "grid":
                return api.updateScene({ appState: { gridModeEnabled: !state.gridModeEnabled } });
            case "snap":
                return api.updateScene({ appState: { objectsSnapModeEnabled: !state.objectsSnapModeEnabled } });
            case "home":
                return navigate(ROUTES.home);
        }
    };

    const changeLanguage = (code: string) => {
        setLangCode(code);
        try {
            localStorage.setItem(LANGUAGE_KEY, code);
        } catch {
            // Applies for this visit only.
        }
    };

    // Built once per language, so the shell's own re-renders (save state, zoom) don't re-render the editor.
    const welcome = useMemo(
        () => (
            <WelcomeScreen>
                <WelcomeScreen.Center>
                    <WelcomeScreen.Center.Logo>
                        <span className="whiteboard-welcome-logo">
                            <LogoMark className="size-8" />
                            {copy.title}
                        </span>
                    </WelcomeScreen.Center.Logo>
                    <WelcomeScreen.Center.Heading>
                        <span className="whiteboard-welcome-heading">{copy.welcomeHeading}</span>
                        <span className="whiteboard-welcome-text">{copy.welcome}</span>
                    </WelcomeScreen.Center.Heading>
                    <WelcomeScreen.Center.Menu>
                        <WelcomeScreen.Center.MenuItemLoadScene />
                        <WelcomeScreen.Center.MenuItemHelp />
                    </WelcomeScreen.Center.Menu>
                </WelcomeScreen.Center>
            </WelcomeScreen>
        ),
        [copy.title, copy.welcomeHeading, copy.welcome],
    );

    const toolbar = (layout: "rail" | "row") =>
        snapshot && (
            <WhiteboardToolbar
                layout={layout}
                activeTool={snapshot.tool}
                locked={snapshot.locked}
                onSelect={(type) => api?.setActiveTool({ type } as Parameters<ExcalidrawImperativeAPI["setActiveTool"]>[0])}
                onToggleLock={() => {
                    const state = api?.getAppState();
                    if (state) api?.updateScene({ appState: { activeTool: { ...state.activeTool, locked: !state.activeTool.locked } } });
                }}
                onMermaid={() => api?.updateScene({ appState: { openDialog: { name: "ttd", tab: "mermaid" } } })}
            />
        );

    return (
        <div className="whiteboard">
            <WhiteboardTopBar
                name={snapshot?.name || copy.untitled}
                onRename={(name) => api?.updateScene({ appState: { name } })}
                compact={editorMobile}
                history={history}
                zoom={snapshot?.zoom ?? 1}
                hasSelection={Boolean(snapshot?.hasSelection)}
                onZoom={zoom}
                status={autosave.status}
                savedAt={autosave.savedAt}
                empty={snapshot?.empty ?? true}
                onExport={(action) => void onExport(action)}
                onMore={onMore}
                dark={snapshot?.theme === "dark"}
                grid={Boolean(snapshot?.grid)}
                snap={Boolean(snapshot?.snap)}
                background={snapshot?.background ?? "#ffffff"}
                onBackground={(color) => api?.updateScene({ appState: { viewBackgroundColor: color } })}
                langCode={langCode}
                onLanguage={changeLanguage}
            />
            {!wide && toolbar("row")}
            <div className="whiteboard-body">
                {wide && toolbar("rail")}
                <div ref={setCanvas} className="whiteboard-canvas">
                    {initialData !== undefined && (
                        <Excalidraw
                            initialData={initialData}
                            excalidrawAPI={setApi}
                            onChange={onChange}
                            langCode={langCode}
                            autoFocus
                            handleKeyboardGlobally
                            aiEnabled={false}
                            UIOptions={UI_OPTIONS}
                        >
                            {welcome}
                        </Excalidraw>
                    )}
                </div>
            </div>
            <input ref={fileInput} type="file" hidden accept=".excalidraw,.excalidrawlib,.json,image/png,image/svg+xml" onChange={onFilePicked} />
            <ConfirmDialog
                open={confirm === "new"}
                onOpenChange={(isOpen) => !isOpen && setConfirm(null)}
                {...copy.confirmNew}
                onConfirm={newBoard}
            />
            <ConfirmDialog
                open={confirm === "open"}
                onOpenChange={(isOpen) => {
                    if (isOpen) return;
                    setConfirm(null);
                    pendingFile.current = null;
                }}
                {...copy.confirmOpen}
                onConfirm={() => {
                    const file = pendingFile.current;
                    if (file) void open(file);
                }}
            />
        </div>
    );
}
