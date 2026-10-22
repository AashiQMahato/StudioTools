import "./assetPath";
import { Excalidraw, languages, loadFromBlob, MainMenu, MIME_TYPES, serializeAsJSON, useHandleLibrary, WelcomeScreen } from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, ExcalidrawInitialDataState, LibraryItems } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import { ArrowLeft, Languages } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/lib/constants/routes";
import { useLocale, useT } from "@/i18n";
import { loadLibrary, loadSavedScene, readSavedScene, saveLibrary, saveScene, SAVED_SCENE_VERSION, setAsideUnreadableScene } from "./storage";
import "./whiteboard.css";

/** Saves wait for a pause in editing, but never longer than this while you keep drawing. */
const SAVE_DELAY = 400;
const SAVE_MAX_WAIT = 3000;
const LANGUAGE_KEY = "whiteboard-language";
const THEME_KEY = "theme"; // The site's own theme setting (useTheme), so both stay in step.

type Theme = "light" | "dark";
const siteTheme = (): Theme => (document.documentElement.classList.contains("dark-mode") ? "dark" : "light");

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
 * The last drawing saved in this browser, restored through the package's own loader (which checks
 * and migrates it). A record that can't be read is set aside, never silently overwritten.
 */
async function restoreSavedDrawing(): Promise<ExcalidrawInitialDataState | null> {
    const raw = await loadSavedScene();
    if (raw === undefined) return null;
    const saved = readSavedScene(raw);
    try {
        if (!saved) throw new Error("Unrecognised whiteboard save");
        const data = await loadFromBlob(new Blob([saved.scene], { type: MIME_TYPES.excalidraw }), null, null);
        const appState: Partial<AppState> = { ...data.appState };
        if (saved.view) Object.assign(appState, { scrollX: saved.view.scrollX, scrollY: saved.view.scrollY, zoom: { value: saved.view.zoom } });
        return { elements: data.elements, appState, files: data.files, scrollToContent: !saved.view };
    } catch {
        await setAsideUnreadableScene(raw);
        return null;
    }
}

interface PendingSave {
    elements: readonly OrderedExcalidrawElement[];
    appState: AppState;
    files: BinaryFiles;
}

/** Debounced local autosave (with a maximum wait), flushed when the page is hidden or the editor closes. */
function useAutosave() {
    const pending = useRef<PendingSave | null>(null);
    const timer = useRef<number | undefined>(undefined);
    const firstChange = useRef<number | null>(null);
    const lastSaved = useRef<string | null>(null);

    const flush = useCallback(() => {
        window.clearTimeout(timer.current);
        timer.current = undefined;
        firstChange.current = null;
        const next = pending.current;
        pending.current = null;
        if (!next) return;
        const scene = serializeAsJSON(next.elements, next.appState, next.files, "local");
        const view = { scrollX: next.appState.scrollX, scrollY: next.appState.scrollY, zoom: next.appState.zoom.value };
        const key = `${scene}\n${view.scrollX},${view.scrollY},${view.zoom}`;
        if (key === lastSaved.current) return;
        lastSaved.current = key;
        void saveScene({ version: SAVED_SCENE_VERSION, savedAt: Date.now(), scene, view }).then((ok) => {
            if (!ok && lastSaved.current === key) lastSaved.current = null;
        });
    }, []);

    const schedule = useCallback(
        (change: PendingSave) => {
            pending.current = change;
            const now = Date.now();
            firstChange.current ??= now;
            window.clearTimeout(timer.current);
            const wait = Math.max(0, Math.min(SAVE_DELAY, firstChange.current + SAVE_MAX_WAIT - now));
            timer.current = window.setTimeout(flush, wait);
        },
        [flush],
    );

    useEffect(() => {
        const onHide = () => document.visibilityState === "hidden" && flush();
        window.addEventListener("pagehide", flush);
        document.addEventListener("visibilitychange", onHide);
        return () => {
            window.removeEventListener("pagehide", flush);
            document.removeEventListener("visibilitychange", onHide);
            flush();
        };
    }, [flush]);

    return schedule;
}

const libraryAdapter = {
    load: async () => {
        const stored = await loadLibrary();
        return stored && typeof stored === "object" && Array.isArray((stored as { libraryItems?: unknown }).libraryItems) ? (stored as { libraryItems: LibraryItems }) : null;
    },
    save: saveLibrary,
};

/**
 * Studio Tools' whiteboard: the official Excalidraw editor, full screen, with its own toolbars,
 * menus, shortcuts, export and shape library. What this adds is local autosave, the way back to the
 * site, and the site's theme and language as starting points.
 */
export function Whiteboard() {
    const t = useT();
    const navigate = useNavigate();
    const siteLocale = useLocale((state) => state.locale);
    const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
    const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null | undefined>(undefined);
    const [langCode, setLangCode] = useState(() => initialLanguage(siteLocale));
    const theme = useRef<Theme>(siteTheme());
    const scheduleSave = useAutosave();

    useHandleLibrary({ excalidrawAPI: api, adapter: libraryAdapter });

    // Restore before the editor mounts, so its first change can never overwrite the saved drawing.
    useEffect(() => {
        let active = true;
        void restoreSavedDrawing().then((data) => {
            if (!active) return;
            // The site's theme wins over the one saved with the drawing.
            setInitialData({ ...data, appState: { ...data?.appState, theme: theme.current } });
        });
        return () => {
            active = false;
        };
    }, []);

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
            scheduleSave({ elements, appState, files });
        },
        [scheduleSave],
    );

    const changeLanguage = (code: string) => {
        setLangCode(code);
        try {
            localStorage.setItem(LANGUAGE_KEY, code);
        } catch {
            // Applies for this visit only.
        }
    };

    const goHome = useCallback(() => navigate(ROUTES.home), [navigate]);
    const languageOptions = useMemo(() => languages.map((language) => <option key={language.code} value={language.code}>{language.label}</option>), []);

    return (
        <div className="whiteboard">
            {initialData !== undefined && (
                <Excalidraw
                    initialData={initialData}
                    excalidrawAPI={setApi}
                    onChange={onChange}
                    langCode={langCode}
                    autoFocus
                    handleKeyboardGlobally
                    aiEnabled={false}
                    UIOptions={{ canvasActions: { toggleTheme: true } }}
                    renderTopRightUI={(isMobile) =>
                        isMobile ? null : (
                            <button type="button" className="whiteboard-home" onClick={goHome} title={t.whiteboard.backTitle} aria-label={t.whiteboard.backTitle}>
                                <ArrowLeft aria-hidden />
                                <span>{t.whiteboard.brand}</span>
                            </button>
                        )
                    }
                >
                    <MainMenu>
                        <MainMenu.Item icon={<ArrowLeft aria-hidden />} onSelect={goHome}>
                            {t.whiteboard.back}
                        </MainMenu.Item>
                        <MainMenu.Separator />
                        <MainMenu.DefaultItems.LoadScene />
                        <MainMenu.DefaultItems.SaveToActiveFile />
                        <MainMenu.DefaultItems.Export />
                        <MainMenu.DefaultItems.SaveAsImage />
                        <MainMenu.DefaultItems.CommandPalette />
                        <MainMenu.DefaultItems.SearchMenu />
                        <MainMenu.DefaultItems.Help />
                        <MainMenu.DefaultItems.ClearCanvas />
                        <MainMenu.Separator />
                        <MainMenu.DefaultItems.ToggleTheme />
                        <MainMenu.ItemCustom>
                            <label className="whiteboard-language">
                                <Languages aria-hidden />
                                <span className="sr-only">{t.common.language}</span>
                                <select className="dropdown-select dropdown-select__language" value={langCode} onChange={(event) => changeLanguage(event.target.value)}>
                                    {languageOptions}
                                </select>
                            </label>
                        </MainMenu.ItemCustom>
                        <MainMenu.DefaultItems.ChangeCanvasBackground />
                    </MainMenu>
                    <WelcomeScreen>
                        <WelcomeScreen.Hints.MenuHint />
                        <WelcomeScreen.Hints.ToolbarHint />
                        <WelcomeScreen.Hints.HelpHint />
                        <WelcomeScreen.Center>
                            <WelcomeScreen.Center.Logo>
                                <span className="whiteboard-title">{t.whiteboard.title}</span>
                            </WelcomeScreen.Center.Logo>
                            <WelcomeScreen.Center.Heading>{t.whiteboard.welcome}</WelcomeScreen.Center.Heading>
                            <WelcomeScreen.Center.Menu>
                                <WelcomeScreen.Center.MenuItemLoadScene />
                                <WelcomeScreen.Center.MenuItemHelp />
                            </WelcomeScreen.Center.Menu>
                        </WelcomeScreen.Center>
                    </WelcomeScreen>
                </Excalidraw>
            )}
        </div>
    );
}
