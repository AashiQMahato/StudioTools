import { exportToBlob, exportToClipboard, exportToSvg, loadSceneOrLibraryFromBlob, MIME_TYPES, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { downloadBlob } from "@/lib/utils/download";

/*
 * The top bar's file actions, built only on the package's documented utilities (exportToBlob,
 * exportToSvg, exportToClipboard, serializeAsJSON, loadSceneOrLibraryFromBlob). The editor's own
 * export dialogs stay available for the finer options (scale, background, only selected, embed scene).
 */

const EXPORT_PADDING = 16;

/** A file name from the board's title: no characters file systems reject, never empty. */
export function fileBaseName(name: string, fallback: string) {
    const printable = [...name].filter((character) => character >= " ").join("");
    const clean = printable.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    return clean || fallback;
}

function scene(api: ExcalidrawImperativeAPI) {
    return { elements: api.getSceneElements(), appState: api.getAppState(), files: api.getFiles() };
}

export async function exportPng(api: ExcalidrawImperativeAPI, baseName: string) {
    const { elements, appState, files } = scene(api);
    const blob = await exportToBlob({ elements, files, mimeType: MIME_TYPES.png, exportPadding: EXPORT_PADDING, appState: { ...appState, exportBackground: true } });
    downloadBlob(blob, `${baseName}.png`);
}

export async function exportSvg(api: ExcalidrawImperativeAPI, baseName: string) {
    const { elements, appState, files } = scene(api);
    const svg = await exportToSvg({ elements, files, exportPadding: EXPORT_PADDING, appState: { ...appState, exportBackground: true } });
    downloadBlob(new Blob([svg.outerHTML], { type: MIME_TYPES.svg }), `${baseName}.svg`);
}

export async function copyPng(api: ExcalidrawImperativeAPI) {
    const { elements, appState, files } = scene(api);
    await exportToClipboard({ elements, files, type: "png", appState: { ...appState, exportBackground: true } });
}

/** The board as a native .excalidraw file (images included), the format Open reads back. */
export function saveExcalidrawFile(api: ExcalidrawImperativeAPI, baseName: string) {
    const { elements, appState, files } = scene(api);
    const json = serializeAsJSON(elements, appState, files, "local");
    downloadBlob(new Blob([json], { type: MIME_TYPES.excalidraw }), `${baseName}.excalidraw`);
}

/**
 * Opens a drawing (.excalidraw, or a PNG/SVG exported with the scene embedded) in place of the
 * current one, or adds a library file (.excalidrawlib) to the library. Throws if the file is neither.
 */
export async function openFile(api: ExcalidrawImperativeAPI, file: File): Promise<"scene" | "library"> {
    const loaded = await loadSceneOrLibraryFromBlob(file, api.getAppState(), api.getSceneElements());
    if (loaded.type === MIME_TYPES.excalidrawlib) {
        await api.updateLibrary({ libraryItems: loaded.data.libraryItems ?? loaded.data.library ?? [], merge: true, openLibraryMenu: true });
        return "library";
    }
    const { elements, appState, files } = loaded.data;
    if (files) api.addFiles(Object.values(files));
    api.updateScene({ elements, appState: { viewBackgroundColor: appState.viewBackgroundColor } });
    api.scrollToContent(undefined, { fitToContent: true });
    return "scene";
}
