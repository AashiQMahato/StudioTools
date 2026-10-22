/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_BASE_URL?: string;
    /** A separate server for the AI tools (background removal, passport photos, upscaling). */
    readonly VITE_AI_API_BASE_URL?: string;
    /** Where the whiteboard's fonts are served from, relative to the site root (set by vite.config.ts). */
    readonly VITE_EXCALIDRAW_ASSET_DIR: string;
}

interface Window {
    /** Read by @excalidraw/excalidraw when it loads its fonts. */
    EXCALIDRAW_ASSET_PATH?: string | string[];
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
