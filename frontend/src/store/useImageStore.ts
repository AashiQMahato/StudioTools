import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { clearDraftImage, type DraftSection, loadDraftImage, saveDraftImage } from "@/lib/draft";
import type { ImageDimensions, ImageFile, UpscaleFactor } from "@/types/image";

/**
 * State shared across pages: the image the user is working on and their preferred upscale factor.
 *
 * The image follows the user everywhere — from the landing page into any tool, from one tool to the
 * next, and across a reload (as a local draft). Tools write their results back (`publish`), so the
 * next tool, and the page after a reload, always open the latest version.
 *
 * A *new* image (upload, "new image") starts a new `session`; a tool publishing its result does not.
 * That's how the tool you're in keeps its own session while its output updates everything else.
 */
interface ImageState {
    original: ImageFile | null;
    /** A name the user typed in the top bar; it replaces the file's name in every tool until a different image is chosen. */
    customName: string | null;
    /** Changes only when a different image is chosen, never when a tool publishes a result. */
    session: string;
    selectedScale: UpscaleFactor;

    setOriginal: (image: ImageFile | null) => void;
    /**
     * A tool's result becomes the working image, which is returned. Ignored (null) if a different image
     * has been chosen since `session`.
     */
    publish: (session: string, result: { blob: Blob; name: string; dimensions: ImageDimensions }, editedBy: string | undefined) => ImageFile | null;
    setSelectedScale: (scale: UpscaleFactor) => void;
    rename: (name: string) => void;
    clear: () => void;
}

/** Object URLs a mounted tool is still showing, with how many tools hold each. */
const pinned = new Map<string, number>();
/** URLs replaced while pinned: revoked as soon as the last tool lets go. */
const retired = new Set<string>();

function retire(url: string) {
    if (pinned.has(url)) retired.add(url);
    else URL.revokeObjectURL(url);
}

function persist(image: ImageFile | null, section: DraftSection | null) {
    if (!section) return;
    if (image) void saveDraftImage({ id: image.id, file: image.file, width: image.dimensions.width, height: image.dimensions.height, editedBy: image.editedBy }, section);
    else void clearDraftImage(section);
}

const createImageStore = (section: DraftSection | null) =>
    create<ImageState>()((set, get) => ({
        original: null,
        customName: null,
        session: crypto.randomUUID(),
        selectedScale: 2,

        setOriginal: (image) => {
            const previous = get().original;
            if (previous && previous.previewUrl !== image?.previewUrl) retire(previous.previewUrl);
            set({ original: image, customName: null, session: crypto.randomUUID() });
            persist(image, section);
        },
        publish: (session, { blob, name, dimensions }, editedBy) => {
            const { original: previous, session: current } = get();
            if (session !== current) return null;
            const file = blob instanceof File && blob.name === name ? blob : new File([blob], name, { type: blob.type });
            const image: ImageFile = { id: crypto.randomUUID(), file, name, size: file.size, mimeType: file.type, previewUrl: URL.createObjectURL(file), dimensions, editedBy };
            if (previous) retire(previous.previewUrl);
            set({ original: image });
            persist(image, section);
            return image;
        },
        setSelectedScale: (selectedScale) => set({ selectedScale }),
        rename: (customName) => set({ customName }),
        clear: () => get().setOriginal(null),
    }));

/** The image tools' image: it travels between every image tool. */
export const useImageStore = createImageStore("image");
/** The text tools' image, kept apart — opening one in either section never replaces the other's. */
export const useTextImageStore = createImageStore("text");
/** For tools that manage their own files (the document tools): never holds, shows or saves an image. */
export const useNoImageStore = createImageStore(null);

type ImageStore = typeof useImageStore;
/** Which section's image the studio below works with (image tools unless a text tool says otherwise). */
export const ImageStoreContext = createContext<ImageStore>(useImageStore);
export const useSectionImageStore = () => useContext(ImageStoreContext);

/**
 * The image a tool works on: the shared image as it was when the tool opened (or when a new image was
 * chosen while it's open). Results this tool — or any — publishes don't swap it out underneath the
 * tool; they're picked up the next time a tool opens. Its preview URL stays valid while in use.
 */
export function useToolImage() {
    const store = useSectionImageStore();
    const original = store((state) => state.original);
    const session = store((state) => state.session);
    const [snapshot, setSnapshot] = useState({ session, image: original });
    let current = snapshot;
    if (snapshot.session !== session) {
        current = { session, image: original };
        setSnapshot(current);
    }
    const customName = store((state) => state.customName);
    const image = useMemo(() => (current.image && customName ? { ...current.image, name: customName } : current.image), [current.image, customName]);
    useEffect(() => {
        if (!image) return;
        const url = image.previewUrl;
        pinned.set(url, (pinned.get(url) ?? 0) + 1);
        return () => {
            const left = (pinned.get(url) ?? 1) - 1;
            if (left > 0) return void pinned.set(url, left);
            pinned.delete(url);
            if (retired.delete(url)) URL.revokeObjectURL(url);
        };
    }, [image]);
    return { image, session: current.session };
}

/** A tool's current output: a result to publish, or null for "unchanged" (the image as the tool opened it). */
export interface ToolOutput {
    blob: Blob;
    name: string;
    dimensions: ImageDimensions;
}

/**
 * Keeps the shared image in step with a tool's output: every new result is published; going back to
 * "unchanged" (undo, reset, discard) publishes the image the tool started from again. `undefined`
 * means a result is still being made — nothing changes until it's ready.
 */
export function usePublishOutput(tool: { image: ImageFile | null; session: string }, output: ToolOutput | null | undefined, editedBy: string) {
    const publish = useImageStore((state) => state.publish);
    const published = useRef<ToolOutput | null>(null);
    const { image, session } = tool;
    useEffect(() => {
        if (!image || output === undefined || output === published.current) return;
        published.current = output;
        if (output) publish(session, output, editedBy);
        else publish(session, { blob: image.file, name: image.name, dimensions: image.dimensions }, image.editedBy);
    }, [image, session, output, publish, editedBy]);
}

/** Bring back the image from the last visit, before the first render so pages open with it in place. */
export async function restoreDraftImage() {
    await Promise.all([restore(useImageStore, "image"), restore(useTextImageStore, "text")]);
}

async function restore(store: ImageStore, section: DraftSection) {
    const draft = await loadDraftImage(section);
    if (!draft || store.getState().original) return;
    const file = draft.file instanceof File ? draft.file : new File([draft.file], "image", { type: (draft.file as Blob).type });
    store.setState({
        original: {
            id: draft.id,
            file,
            name: file.name,
            size: file.size,
            mimeType: file.type,
            previewUrl: URL.createObjectURL(file),
            dimensions: { width: draft.width, height: draft.height },
            editedBy: draft.editedBy,
        },
        session: crypto.randomUUID(),
    });
}
