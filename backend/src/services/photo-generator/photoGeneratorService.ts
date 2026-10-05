import sharp, { type Sharp } from "sharp";
import { env } from "../../config/env.js";
import type { ProcessingContext } from "../../types/image.js";
import { AppError } from "../../utils/AppError.js";
import { ConcurrencyLimiter } from "../../utils/concurrency.js";
import { createWhiteBackground, removeBackground } from "./backgroundRemovalService.js";
import { analyzeHead, calculateCrop, cropImage, fromRaw, type HeadGeometry, transformRect } from "./cropService.js";
import { detectFaces, type Rect } from "./faceDetectionService.js";
import { convertImage, detectFormat, normalizeImage, type SourceFormat } from "./formatConversionService.js";
import { describePreset, mmToPixels, outputSize, PAPER, PHOTO_PRESETS, type PhotoPreset, sizeLabel } from "./presets.js";
import { inspectFaces, inspectPose, type QualityReport, validateOutput, type WarningCode } from "./qualityService.js";
import { checkResolution, resizeImage, setDpi, type UpscaleMethod, upscaleImage } from "./resizeService.js";
import { fileUrl, tempStore } from "./tempStore.js";

// ------------------------------------------------------------------ progress events

export type StepId = "format" | "orientation" | "face" | "background" | "white" | "composition" | "resolution" | "finalize";

export type ProgressEvent =
    | { type: "step"; step: StepId; status: "active" | "done" | "skipped"; detail?: Record<string, unknown> }
    | { type: "preview"; stage: "original" | "cutout" | "white"; url: string; width: number; height: number }
    /** The crop, as fractions of the preview images. */
    | { type: "crop"; rect: Rect }
    | { type: "warning"; code: WarningCode };

type Emit = (event: ProgressEvent) => void;

// ------------------------------------------------------------------ results

type HeadMarks = Pick<HeadGeometry, "crownY" | "chinY" | "eyeY" | "centerX">;

/** Kept with the working image, so a manual crop can be rendered and checked the same way. */
interface WorkMeta {
    presetId: string;
    head: HeadMarks;
    autoCrop: Rect;
    width: number;
    height: number;
    baseName: string;
}

interface PhotoMeta {
    presetId: string;
}

export interface RenderedPhoto {
    imageUrl: string;
    pngUrl: string;
    photoId: string;
    width: number;
    height: number;
    widthMm: number;
    heightMm: number;
    size: PhotoPreset["size"];
    dpi: number;
    format: "jpeg";
    quality: QualityReport;
}

export interface GeneratedPhoto extends RenderedPhoto {
    preset: ReturnType<typeof describePreset>;
    work: { id: string; url: string; width: number; height: number; crop: Rect; autoCrop: Rect; head: HeadMarks };
    warnings: WarningCode[];
    source: { format: SourceFormat; converted: boolean; orientationCorrected: boolean; width: number; height: number; upscaled: UpscaleMethod | null };
}

// ------------------------------------------------------------------ helpers

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };
const PREVIEW_SIDE = 900;

function getPreset(id: unknown): PhotoPreset {
    const preset = typeof id === "string" && Object.hasOwn(PHOTO_PRESETS, id) ? PHOTO_PRESETS[id] : undefined;
    if (!preset) throw new AppError("Choose a photo type.", 400, "INVALID_PRESET");
    return preset;
}

async function storePreview(image: Sharp, format: "jpeg" | "png", name: string) {
    const small = image.resize(PREVIEW_SIDE, PREVIEW_SIDE, { fit: "inside", withoutEnlargement: true });
    const { data, info } = await (format === "png" ? small.png() : small.jpeg({ quality: 88 })).toBuffer({ resolveWithObject: true });
    return { url: fileUrl(tempStore.put(data, `image/${format}`, `${name}.${format}`)), width: info.width, height: info.height };
}

/** `crop` grown for room to adjust by hand, kept inside the photo — but never smaller than `crop` itself. */
function workingRegion(crop: Rect, width: number, height: number): Rect {
    const left = Math.min(crop.x, Math.max(0, crop.x - crop.width * 0.3));
    const top = Math.min(crop.y, Math.max(0, crop.y - crop.height * 0.2));
    const right = Math.max(crop.x + crop.width, Math.min(width, crop.x + crop.width * 1.3));
    const bottom = Math.max(crop.y + crop.height, Math.min(height, crop.y + crop.height * 1.2));
    return { x: Math.floor(left), y: Math.floor(top), width: Math.ceil(right) - Math.floor(left), height: Math.ceil(bottom) - Math.floor(top) };
}

const moveHead = (head: HeadMarks, origin: { x: number; y: number }, scale: number): HeadMarks => ({
    crownY: (head.crownY - origin.y) * scale,
    chinY: (head.chinY - origin.y) * scale,
    eyeY: (head.eyeY - origin.y) * scale,
    centerX: (head.centerX - origin.x) * scale,
});

const safeName = (name: string) =>
    name
        .replace(/\.[^.]*$/, "")
        .normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/[\s_]+/g, "-")
        .toLowerCase()
        .slice(0, 50) || "photo";

// ------------------------------------------------------------------ steps composed

/**
 * Crop → exact size → DPI → checks. Shared by the automatic result and every manual adjustment, so
 * both are made (and judged) the same way.
 */
async function renderPhoto(working: Buffer, meta: WorkMeta, crop: Rect): Promise<RenderedPhoto> {
    const preset = getPreset(meta.presetId);
    const target = outputSize(preset);
    const cropped = await cropImage(working, meta, crop, WHITE);
    const resized = resizeImage(fromRaw(cropped), cropped.info, target);
    const [jpeg, png] = await Promise.all([setDpi(resized.clone(), preset.dpi, "jpeg"), setDpi(resized.clone(), preset.dpi, "png")]);
    const quality = await validateOutput(jpeg, preset, meta.head, crop);
    const name = `${meta.baseName}-${preset.id}-${sizeLabel(preset)}`;
    const photoId = tempStore.put(jpeg, "image/jpeg", `${name}.jpg`, { presetId: preset.id } satisfies PhotoMeta);
    const pngId = tempStore.put(png, "image/png", `${name}.png`);
    return { imageUrl: fileUrl(photoId), pngUrl: fileUrl(pngId), photoId, ...target, widthMm: preset.widthMm, heightMm: preset.heightMm, size: preset.size, dpi: preset.dpi, format: "jpeg", quality };
}

/**
 * Upload → print-ready ID photo. Each step is its own function; this only puts them in order and says
 * what happened at each, as it happens.
 */
async function generate(upload: Buffer, fileName: string, presetId: unknown, emit: Emit, context: ProcessingContext): Promise<GeneratedPhoto> {
    const preset = getPreset(presetId);
    const target = outputSize(preset);
    const { signal } = context;
    const warnings: WarningCode[] = [];
    const warn = (codes: WarningCode[]) => {
        for (const code of codes) {
            warnings.push(code);
            emit({ type: "warning", code });
        }
    };

    // 1–4. Detect the real format, convert what can't be read directly, turn it upright.
    emit({ type: "step", step: "format", status: "active" });
    const format = detectFormat(upload);
    if (!format) throw new AppError("This image format isn't supported. Please use a JPG, PNG, WebP or HEIC photo.", 415, "UNSUPPORTED_MEDIA_TYPE");
    const conversion = await convertImage(upload, format, signal);
    emit({ type: "step", step: "format", status: "done", detail: { format, converted: conversion.converted } });

    emit({ type: "step", step: "orientation", status: "active" });
    const photo = await normalizeImage(conversion.buffer, conversion.orientation);
    emit({ type: "step", step: "orientation", status: "done", detail: { corrected: photo.orientationCorrected } });
    emit({ type: "preview", stage: "original", ...(await storePreview(sharp(photo.buffer), "jpeg", "original")) });

    // 5–6. Exactly one person, and how good the photo of them is.
    emit({ type: "step", step: "face", status: "active" });
    const { face, warnings: faceWarnings } = inspectFaces((await detectFaces(photo.buffer, signal)).faces);
    warn(faceWarnings);
    emit({ type: "step", step: "face", status: "done" });

    // 7–8. The person, then the person on white.
    emit({ type: "step", step: "background", status: "active" });
    const cutout = await removeBackground(photo, context);
    emit({ type: "preview", stage: "cutout", ...(await storePreview(sharp(cutout.png), "png", "cutout")) });
    emit({ type: "step", step: "background", status: "done" });

    emit({ type: "step", step: "white", status: "active" });
    emit({ type: "preview", stage: "white", ...(await storePreview(createWhiteBackground(sharp(cutout.png), preset.background), "jpeg", "white")) });
    emit({ type: "step", step: "white", status: "done" });

    // 9–11. Where the head is, and the composition around it.
    emit({ type: "step", step: "composition", status: "active" });
    const head = analyzeHead(face, cutout.alpha, photo.width, photo.height);
    warn(inspectPose(head));
    const crop = calculateCrop(head, preset);
    emit({ type: "crop", rect: { x: crop.x / photo.width, y: crop.y / photo.height, width: crop.width / photo.width, height: crop.height / photo.height } });
    const region = workingRegion(crop, photo.width, photo.height);
    const regionCutout = await cropImage(cutout.png, photo, region, CLEAR);
    emit({ type: "step", step: "composition", status: "done" });

    // 12–13. Enough pixels for the output? Only if not, double them.
    emit({ type: "step", step: "resolution", status: "active" });
    const resolution = checkResolution(crop.height, target.height);
    let working: Buffer;
    let scale: number;
    let upscaled: UpscaleMethod | null = null;
    if (!resolution.sufficient) {
        warn(["LOW_RESOLUTION"]);
        emit({ type: "step", step: "resolution", status: "active", detail: { upscaling: true } });
        // The person's own colours are enlarged, and the edge (alpha) with them, then laid on white
        // again — so the background stays pure white and the edges stay clean.
        const colour = await fromRaw(regionCutout).removeAlpha().jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
        const enlarged = await upscaleImage(colour, region, context);
        const alpha = await fromRaw(regionCutout).extractChannel(3).resize(enlarged.width, enlarged.height, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer();
        // Separate passes on purpose: within one sharp pipeline, removeAlpha and flatten run *after*
        // joinChannel whatever the call order — the new edge would be dropped or ignored.
        const colourRaw = await sharp(enlarged.buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const rgba = await fromRaw(colourRaw)
            .joinChannel(alpha, { raw: { width: enlarged.width, height: enlarged.height, channels: 1 } })
            .raw()
            .toBuffer({ resolveWithObject: true });
        working = await createWhiteBackground(fromRaw(rgba), preset.background).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
        scale = enlarged.width / region.width;
        upscaled = enlarged.method;
    } else {
        // Plenty of pixels: keep up to twice what the output needs — more only costs time.
        scale = Math.min(1, (target.height * 2) / crop.height);
        working = await createWhiteBackground(
            fromRaw(regionCutout).resize(Math.max(1, Math.round(region.width * scale)), Math.max(1, Math.round(region.height * scale)), { fit: "fill", kernel: "lanczos3" }),
            preset.background,
        )
            .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
            .toBuffer();
    }
    emit({ type: "step", step: "resolution", status: upscaled ? "done" : "skipped", detail: { upscaled, factor: Number(resolution.factor.toFixed(2)) } });

    // 14–16. Exact size, DPI, final checks.
    emit({ type: "step", step: "finalize", status: "active" });
    const { width: workWidth, height: workHeight } = await sharp(working).metadata();
    const meta: WorkMeta = {
        presetId: preset.id,
        head: moveHead(head, region, scale),
        autoCrop: transformRect(crop, region, scale),
        width: workWidth ?? 0,
        height: workHeight ?? 0,
        baseName: safeName(fileName),
    };
    const rendered = await renderPhoto(working, meta, meta.autoCrop);
    const workId = tempStore.put(working, "image/jpeg", "working.jpg", meta);
    emit({ type: "step", step: "finalize", status: "done" });

    return {
        ...rendered,
        preset: describePreset(preset),
        work: { id: workId, url: fileUrl(workId), width: meta.width, height: meta.height, crop: meta.autoCrop, autoCrop: meta.autoCrop, head: meta.head },
        warnings,
        source: { format, converted: conversion.converted, orientationCorrected: photo.orientationCorrected, width: photo.width, height: photo.height, upscaled },
    };
}

// ------------------------------------------------------------------ sheets

function sheetLayout(preset: PhotoPreset) {
    const paper = PAPER.a4;
    const columns = Math.floor((paper.widthMm - paper.marginMm * 2 + paper.gapMm) / (preset.widthMm + paper.gapMm));
    const rows = Math.floor((paper.heightMm - paper.marginMm * 2 + paper.gapMm) / (preset.heightMm + paper.gapMm));
    return { paper, columns, rows, maxCopies: columns * rows };
}

/** Copies of a finished photo on A4, at the photo's own DPI (so each prints at exactly its stated size), with light cut guides. */
async function createSheet(photoId: unknown, copies: unknown) {
    const entry = typeof photoId === "string" ? tempStore.get(photoId) : null;
    const meta = entry?.meta as PhotoMeta | undefined;
    if (!entry || !meta?.presetId) throw new AppError("This photo has expired. Please create it again.", 404, "FILE_EXPIRED");
    const preset = getPreset(meta.presetId);
    const { paper, columns, maxCopies } = sheetLayout(preset);
    const count = Math.floor(Number(copies));
    if (!Number.isFinite(count) || count < 1 || count > maxCopies) throw new AppError(`Choose between 1 and ${maxCopies} copies.`, 400, "INVALID_REQUEST");

    const px = (mm: number) => mmToPixels(mm, preset.dpi);
    const sheet = { width: px(paper.widthMm), height: px(paper.heightMm) };
    const photo = outputSize(preset);
    const used = Math.min(columns, count);
    const blockWidth = used * preset.widthMm + (used - 1) * paper.gapMm;
    const startX = (paper.widthMm - blockWidth) / 2;
    const places = Array.from({ length: count }, (_, index) => ({
        left: px(startX + (index % columns) * (preset.widthMm + paper.gapMm)),
        top: px(paper.marginMm + Math.floor(index / columns) * (preset.heightMm + paper.gapMm)),
    }));
    const stroke = Math.max(1, Math.round(preset.dpi / 300));
    const guides = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.width}" height="${sheet.height}">${places
            .map(({ left, top }) => `<rect x="${left - stroke}" y="${top - stroke}" width="${photo.width + stroke * 2}" height="${photo.height + stroke * 2}" fill="none" stroke="#c8c8c8" stroke-width="${stroke}"/>`)
            .join("")}</svg>`,
    );
    const jpeg = await sharp({ create: { ...sheet, channels: 3, background: "#ffffff" } })
        .composite([{ input: guides, left: 0, top: 0 }, ...places.map((place) => ({ input: entry.buffer, ...place }))])
        .withMetadata({ density: preset.dpi })
        .jpeg({ quality: 95, chromaSubsampling: "4:4:4", mozjpeg: true })
        .toBuffer();
    const id = tempStore.put(jpeg, "image/jpeg", entry.fileName.replace(/\.jpg$/, `-sheet-${count}.jpg`));
    return { url: fileUrl(id), width: sheet.width, height: sheet.height, copies: count, maxCopies, paper: paper.name, dpi: preset.dpi };
}

// ------------------------------------------------------------------ manual crop

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3;

/** A hand-adjusted crop: same shape as the preset, a sensible size, near the photo. */
async function adjustCrop(workId: unknown, crop: unknown): Promise<RenderedPhoto & { crop: Rect }> {
    const entry = typeof workId === "string" ? tempStore.get(workId) : null;
    const meta = entry?.meta as WorkMeta | undefined;
    if (!entry || !meta?.presetId) throw new AppError("This photo has expired. Please create it again.", 404, "FILE_EXPIRED");
    const rect = crop as Partial<Rect> | null;
    const values = [rect?.x, rect?.y, rect?.width, rect?.height];
    if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) throw new AppError("That crop isn't valid. Please reset it and try again.", 400, "INVALID_CROP");
    const next = rect as Rect;
    const preset = getPreset(meta.presetId);
    const shapeOff = Math.abs(next.width / next.height / (preset.widthMm / preset.heightMm) - 1);
    const zoom = meta.autoCrop.width / next.width;
    const centreX = next.x + next.width / 2;
    const centreY = next.y + next.height / 2;
    const nearPhoto = centreX > -next.width * 0.5 && centreX < meta.width + next.width * 0.5 && centreY > -next.height * 0.5 && centreY < meta.height + next.height * 0.5;
    if (shapeOff > 0.01 || zoom < MIN_ZOOM || zoom > MAX_ZOOM || !nearPhoto) throw new AppError("That crop isn't valid. Please reset it and try again.", 400, "INVALID_CROP");
    return { ...(await renderPhoto(entry.buffer, meta, next)), crop: next };
}

// ------------------------------------------------------------------ service

const limiter = new ConcurrencyLimiter(env.photoGenerator.concurrency, env.maxQueuedJobs);

export const photoGenerator = {
    presets: () => Object.values(PHOTO_PRESETS).map((preset) => ({ ...describePreset(preset), sheet: { paper: sheetLayout(preset).paper.name, maxCopies: sheetLayout(preset).maxCopies } })),
    generate: (upload: Buffer, fileName: string, presetId: unknown, emit: Emit, context: ProcessingContext) => limiter.run(() => generate(upload, fileName, presetId, emit, context), context.signal),
    adjustCrop,
    createSheet,
    file: (id: string) => tempStore.get(id),
};
