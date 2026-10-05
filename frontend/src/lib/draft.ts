/**
 * The working image survives a reload: the file is kept in this browser's IndexedDB (on the user's device,
 * never sent anywhere) until the user replaces or closes it. Every call fails soft — private windows or
 * blocked storage simply mean no draft.
 */

const DB_NAME = "image-tools";
const STORE = "draft";
/** Image tools and text tools each keep their own image. */
export type DraftSection = "image" | "text";
const KEYS: Record<DraftSection, string> = { image: "current", text: "text-current" };

export interface DraftImage {
    id: string;
    file: File;
    width: number;
    height: number;
    editedBy?: string;
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
            const request = action(db.transaction(STORE, mode).objectStore(STORE));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally {
        db.close();
    }
}

export async function saveDraftImage(draft: DraftImage, section: DraftSection = "image") {
    try {
        await run("readwrite", (store) => store.put(draft, KEYS[section]));
    } catch {
        // No storage available: the image just won't survive a reload.
    }
}

export async function clearDraftImage(section: DraftSection = "image") {
    try {
        await run("readwrite", (store) => store.delete(KEYS[section]));
    } catch {
        // Nothing to clear.
    }
    if (section === "text") return clearDraftOcr();
    clearDraftEdits();
    await clearDraftPhoto();
}

// The photo generator's finished photo (the files themselves, not links to them), so a reload shows
// the same photo — including any crop adjustment — without making it again.
const PHOTO_KEY = "photo-generator";

export interface DraftPhoto<T = unknown> {
    /** The image it was made from; it's only restored for that image. */
    imageId: string;
    result: T;
    jpg: Blob;
    png: Blob;
}

export async function saveDraftPhoto<T>(photo: DraftPhoto<T>) {
    try {
        await run("readwrite", (store) => store.put(photo, PHOTO_KEY));
    } catch {
        // No storage: the photo just won't survive a reload.
    }
}

export async function loadDraftPhoto<T>(imageId: string): Promise<DraftPhoto<T> | null> {
    try {
        const photo = (await run("readonly", (store) => store.get(PHOTO_KEY))) as DraftPhoto<T> | undefined;
        return photo?.imageId === imageId && photo.jpg instanceof Blob && photo.png instanceof Blob ? photo : null;
    } catch {
        return null;
    }
}

export async function clearDraftPhoto() {
    try {
        await run("readwrite", (store) => store.delete(PHOTO_KEY));
    } catch {
        // Nothing to clear.
    }
}

// The OCR editor's document and the text as edited, one per image (each page of a PDF is one), so a
// reload opens the same text. On this device only, like the image itself.
const OCR_PREFIX = "ocr:";

export interface DraftOcr<T = unknown, C = unknown> {
    imageId: string;
    /** The file it came from: the image itself, or the PDF its page belongs to. */
    sourceId: string;
    result: T;
    content: C;
    settings: unknown;
}

async function ocrKeys(): Promise<string[]> {
    const keys = await run("readonly", (store) => store.getAllKeys());
    return keys.map(String).filter((key) => key === "ocr" || key.startsWith(OCR_PREFIX));
}

export async function saveDraftOcr<T, C>(draft: DraftOcr<T, C>) {
    try {
        await run("readwrite", (store) => store.put(draft, OCR_PREFIX + draft.imageId));
        // Text from other files is no longer needed: only the current file's pages are kept.
        for (const key of await ocrKeys()) {
            const other = (await run("readonly", (store) => store.get(key))) as DraftOcr | undefined;
            if (!other || other.sourceId !== draft.sourceId) await run("readwrite", (store) => store.delete(key));
        }
    } catch {
        // No storage: the text just won't survive a reload.
    }
}

export async function loadDraftOcr<T, C>(imageId: string): Promise<DraftOcr<T, C> | null> {
    try {
        const draft = (await run("readonly", (store) => store.get(OCR_PREFIX + imageId))) as DraftOcr<T, C> | undefined;
        return draft?.imageId === imageId ? draft : null;
    } catch {
        return null;
    }
}

/** The images (pages) of a file that already have text. */
export async function loadDraftOcrIds(sourceId: string): Promise<string[]> {
    try {
        const ids: string[] = [];
        for (const key of await ocrKeys()) {
            const draft = (await run("readonly", (store) => store.get(key))) as DraftOcr | undefined;
            if (draft?.sourceId === sourceId) ids.push(draft.imageId);
        }
        return ids;
    } catch {
        return [];
    }
}

async function clearDraftOcr() {
    try {
        for (const key of await ocrKeys()) await run("readwrite", (store) => store.delete(key));
        await run("readwrite", (store) => store.delete(PDF_KEY));
    } catch {
        // Nothing to clear.
    }
}

// A PDF open in the OCR editor (the file itself), so a reload keeps every page.
const PDF_KEY = "text-pdf";

export interface DraftPdf {
    id: string;
    file: File;
    name: string;
    pageCount: number;
}

export async function saveDraftPdf(pdf: DraftPdf | null) {
    try {
        if (pdf) await run("readwrite", (store) => store.put(pdf, PDF_KEY));
        else await run("readwrite", (store) => store.delete(PDF_KEY));
    } catch {
        // No storage: the PDF just won't survive a reload.
    }
}

export async function loadDraftPdf(): Promise<DraftPdf | null> {
    try {
        const pdf = (await run("readonly", (store) => store.get(PDF_KEY))) as DraftPdf | undefined;
        return pdf?.file instanceof Blob ? pdf : null;
    } catch {
        return null;
    }
}

export async function loadDraftImage(section: DraftSection = "image"): Promise<DraftImage | null> {
    try {
        const draft = (await run("readonly", (store) => store.get(KEYS[section]))) as DraftImage | undefined;
        return draft?.file instanceof Blob ? draft : null;
    } catch {
        return null;
    }
}

// Edits are small JSON, kept in localStorage so the editor can read them synchronously when it opens.
const EDITS_KEY = "draft-edits";

export function saveDraftEdits<T>(imageId: string, edits: T) {
    try {
        localStorage.setItem(EDITS_KEY, JSON.stringify({ imageId, edits }));
    } catch {
        // Storage full or blocked.
    }
}

export function loadDraftEdits<T>(imageId: string): T | null {
    try {
        const saved = JSON.parse(localStorage.getItem(EDITS_KEY) ?? "null") as { imageId: string; edits: T } | null;
        return saved?.imageId === imageId ? saved.edits : null;
    } catch {
        return null;
    }
}

function clearDraftEdits() {
    try {
        localStorage.removeItem(EDITS_KEY);
    } catch {
        // Ignore.
    }
}

// The text editor's document (its content as JSON), so a reload — or moving between the text tools —
// keeps it. On this device only.
const TEXT_KEY = "text-editor";

export async function saveDraftText(content: unknown) {
    try {
        await run("readwrite", (store) => store.put({ content, savedAt: Date.now() }, TEXT_KEY));
    } catch {
        // No storage: the text just won't survive a reload.
    }
}

export async function loadDraftText<T>(): Promise<T | null> {
    try {
        const draft = (await run("readonly", (store) => store.get(TEXT_KEY))) as { content: T } | undefined;
        return draft?.content ?? null;
    } catch {
        return null;
    }
}
