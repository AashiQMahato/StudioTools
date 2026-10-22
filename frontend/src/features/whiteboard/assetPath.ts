// Imported before @excalidraw/excalidraw: the fonts come from this site (vite.config.ts copies them),
// not from the package's CDN fallback. Kept relative to the base URL, so it also works under a sub-path.
window.EXCALIDRAW_ASSET_PATH = `${import.meta.env.BASE_URL}${import.meta.env.VITE_EXCALIDRAW_ASSET_DIR}`;

export {};
