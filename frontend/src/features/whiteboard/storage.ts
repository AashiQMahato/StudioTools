/**
 * The whiteboard's local save: the drawing (in the native .excalidraw JSON, images included) and the
 * shape library, kept in this browser's IndexedDB — on the user's device, never sent anywhere. Every
 * call fails soft: private windows or blocked storage simply mean nothing is kept.
 */

const DB_NAME = "studio-tools-whiteboard";
const STORE = "whiteboard";
const SCENE_KEY = "scene";
/** A saved drawing that couldn't be read: kept aside (not deleted), in case it can be recovered. */
const UNREADABLE_KEY = "scene-unreadable";
const LIBRARY_KEY = "library";

export const SAVED_SCENE_VERSION = 1;

/** What's stored for the drawing. `scene` is the output of serializeAsJSON(…, "local"). */
export interface SavedScene {
    version: typeof SAVED_SCENE_VERSION;
    savedAt: number;
    scene: string;
    /** Where the canvas was scrolled and zoomed to (not part of the .excalidraw format). */
    view?: SavedView;
    /** The board's title (the .excalidraw format leaves the name out). */
    name?: string;
}

export interface SavedView {
    scrollX: number;
    scrollY: number;
    zoom: number;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function readView(value: unknown): SavedView | undefined {
    if (!value || typeof value !== "object") return undefined;
    const { scrollX, scrollY, zoom } = value as Record<string, unknown>;
    return isFiniteNumber(scrollX) && isFiniteNumber(scrollY) && isFiniteNumber(zoom) && zoom > 0 ? { scrollX, scrollY, zoom } : undefined;
}

/** A stored record, checked: anything malformed or from an unknown version reads as nothing. */
export function readSavedScene(value: unknown): SavedScene | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (record.version !== SAVED_SCENE_VERSION || typeof record.scene !== "string" || record.scene.length === 0) return null;
    return {
        version: SAVED_SCENE_VERSION,
        savedAt: isFiniteNumber(record.savedAt) ? record.savedAt : 0,
        scene: record.scene,
        view: readView(record.view),
        name: typeof record.name === "string" && record.name.trim() ? record.name.slice(0, 200) : undefined,
    };
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDb();
    try {
        return await new Promise<T>((resolve, reject) => {
            const transaction = db.transaction(STORE, mode);
            const request = action(transaction.objectStore(STORE));
            // Resolve once the write is committed, not merely queued.
            transaction.oncomplete = () => resolve(request.result);
            transaction.onerror = () => reject(transaction.error ?? request.error);
            transaction.onabort = () => reject(transaction.error ?? request.error);
        });
    } finally {
        db.close();
    }
}

/** The saved drawing's raw record (unchecked), or undefined. */
export async function loadSavedScene(): Promise<unknown> {
    try {
        return await run("readonly", (store) => store.get(SCENE_KEY));
    } catch {
        return undefined;
    }
}

export async function saveScene(scene: SavedScene): Promise<boolean> {
    try {
        await run("readwrite", (store) => store.put(scene, SCENE_KEY));
        return true;
    } catch {
        return false;
    }
}

/** Moves a record that couldn't be opened out of the way, so the next save doesn't overwrite it. */
export async function setAsideUnreadableScene(record: unknown) {
    try {
        await run("readwrite", (store) => store.put(record, UNREADABLE_KEY));
        await run("readwrite", (store) => store.delete(SCENE_KEY));
    } catch {
        // Nothing more to do: the editor starts blank either way.
    }
}

export async function loadLibrary(): Promise<unknown> {
    try {
        return await run("readonly", (store) => store.get(LIBRARY_KEY));
    } catch {
        return undefined;
    }
}

export async function saveLibrary(library: unknown) {
    // The library adapter must throw on failure, so the editor can tell the user.
    await run("readwrite", (store) => store.put(library, LIBRARY_KEY));
}
