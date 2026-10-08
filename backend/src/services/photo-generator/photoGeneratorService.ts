import sharp, { type Sharp } from "sharp";
import { env } from "../../config/env.js";
import type { ProcessingContext } from "../../types/image.js";
import { AppError } from "../../utils/AppError.js";
import { ConcurrencyLimiter } from "../../utils/concurrency.js";
import { type AlignedCutout, checkRoll, detectFacesTolerant, measureRoll, RESIDUAL_TOLERANCE_DEG, rotateCutout, rotateFace } from "./alignmentService.js";
import { createWhiteBackground, type Cutout, removeBackground } from "./backgroundRemovalService.js";
import { analyzeHead, calculateCrop, cropImage, fromRaw, type HeadGeometry, transformRect } from "./cropService.js";
import { type DetectedFace, detectFaces, type Rect } from "./faceDetectionService.js";
import { convertImage, detectFormat, normalizeImage, type SourceFormat } from "./formatConversionService.js";
import { describePreset, mmToPixels, outputSize, PAPER, PHOTO_PRESETS, type PhotoPreset, sizeLabel } from "./presets.js";
import { inspectFaces, inspectPose, type QualityReport, validateOutput, type WarningCode } from "./qualityService.js";
import { checkResolution, resizeImage, setDpi, type UpscaleMethod, upscaleImage } from "./resizeService.js";
import { fileUrl, tempStore } from "./tempStore.js";

// ------------------------------------------------------------------ progress events

export type StepId = "format" | "orientation" | "face" | "background" | "align" | "white" | "composition" | "resolution" | "finalize";

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

/** The person cut out of the upright, unturned photo — kept so a hand-set angle is one turn from it, not a second. */
interface SourceMeta {
    presetId: string;
    face: DetectedFace;
    width: number;
    height: number;
    autoAngle: number;
    baseName: string;
}

export interface Alignment {
    /** Kept by the server for a while: turning by hand starts again from this. */
    sourceId: string;
    /** Degrees the photo was turned (positive = clockwise on screen). */
    angle: number;
    /** What the automatic straightening chose. */
    autoAngle: number;
    /** The eye line's angle after turning (≈ 0 when straightened). */
    residual: number;
    maxAngle: number;
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
    alignment: Alignment;
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
    const { signal } = context;
    const warnings: WarningCode[] = [];
    const warn = (codes: WarningCode[]) => {
        for (const code of codes) {
            if (warnings.includes(code)) continue;
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

    // 5–6. One person (the dominant face), how good the photo of them is, and how tilted their head is.
    emit({ type: "step", step: "face", status: "active" });
    const found = await detectFacesTolerant(photo.buffer, photo.width, photo.height, async (image) => (await detectFaces(image, signal)).faces);
    const { face, warnings: faceWarnings } = inspectFaces(found);
    warn(faceWarnings);
    const roll = measureRoll(face);
    checkRoll(roll);
    emit({ type: "step", step: "face", status: "done" });

    // 7. The person, from the photo as it is (BiRefNet sees the real pixels, not a turned copy).
    emit({ type: "step", step: "background", status: "active" });
    const cutout = await removeBackground(photo, context);
    emit({ type: "step", step: "background", status: "done" });
    const sourceId = tempStore.put(cutout.png, "image/png", "source.png", { presetId: preset.id, face, width: photo.width, height: photo.height, autoAngle: -roll, baseName: safeName(fileName) } satisfies SourceMeta);

    // 8. Level the eyes: the whole cut-out turned once, then checked on the result.
    emit({ type: "step", step: "align", status: "active" });
    const aligned = await alignAutomatically(cutout, face, -roll, signal);
    emit({ type: "step", step: "align", status: aligned.angle === 0 ? "skipped" : "done", detail: { angle: round1(aligned.angle) } });

    const { upscaled, ...composed } = await composePhoto(aligned, preset, safeName(fileName), emit, warn, context);
    return {
        ...composed,
        warnings,
        source: { format, converted: conversion.converted, orientationCorrected: photo.orientationCorrected, width: photo.width, height: photo.height, upscaled },
        alignment: { sourceId, angle: round1(aligned.angle), autoAngle: round1(aligned.angle), residual: round1(aligned.residual), maxAngle: env.photoGenerator.maxAutoRotationDeg },
    };
}

const round1 = (value: number) => Math.round(value * 10) / 10;

interface Aligned extends AlignedCutout {
    face: DetectedFace;
    angle: number;
    residual: number;
}

/** The cut-out flattened on white, as a JPEG for the face detector. */
const forDetection = (png: Buffer) => sharp(png).flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();

/** Of the faces found in a turned photo, the one where the original face went. */
function sameFace(faces: DetectedFace[], expected: DetectedFace): DetectedFace | null {
    const centre = (f: DetectedFace) => ({ x: f.box.x + f.box.width / 2, y: f.box.y + f.box.height / 2 });
    const want = centre(expected);
    const near = faces.filter((f) => Math.hypot(centre(f).x - want.x, centre(f).y - want.y) < expected.box.width * 0.5);
    return near[0] ?? null;
}

/**
 * Turns the cut-out so the eye line is level, and checks it on the result: the face is found again in the
 * turned photo and its eye line measured. If it's still off by more than the tolerance, the original
 * cut-out is turned once more by the corrected total — still a single resample, never a turn of a turn.
 */
async function alignAutomatically(cutout: Cutout, face: DetectedFace, angle: number, signal: AbortSignal): Promise<Aligned> {
    let total = angle;
    for (let attempt = 0; attempt < 2; attempt++) {
        const turned = await rotateCutout(cutout, total);
        if (!turned.rotation) return { ...turned, face, angle: 0, residual: measureRoll(face) };
        const expected = rotateFace(face, turned.rotation);
        const found = sameFace((await detectFaces(await forDetection(turned.png), signal)).faces, expected);
        // The detector's own box is tighter than the turned corners of the old one; the landmarks agree either way.
        const measured = found ?? expected;
        const residual = measureRoll(measured);
        if (Math.abs(residual) <= RESIDUAL_TOLERANCE_DEG || attempt === 1) return { ...turned, face: measured, angle: total, residual };
        total -= residual;
        // The detector reads large tilts short; the measured remainder shows the real one — check it again.
        checkRoll(total);
    }
    throw new Error("unreachable");
}

/** A hand-set angle, from the kept cut-out of the unturned photo: one turn, no second background removal. */
async function alignManually(source: { buffer: Buffer }, meta: SourceMeta, angle: number): Promise<Aligned> {
    const alpha = await sharp(source.buffer).ensureAlpha().extractChannel(3).raw().toBuffer();
    const turned = await rotateCutout({ png: source.buffer, alpha, width: meta.width, height: meta.height }, angle);
    const face = turned.rotation ? rotateFace(meta.face, turned.rotation) : meta.face;
    return { ...turned, face, angle: turned.rotation ? angle : 0, residual: measureRoll(face) };
}

/**
 * From the straightened cut-out to the finished photo: previews, the composition around the head, enough
 * resolution, exact size and checks. Shared by the automatic run and a hand-set angle.
 */
async function composePhoto(aligned: Aligned, preset: PhotoPreset, baseName: string, emit: Emit, warn: (codes: WarningCode[]) => void, context: ProcessingContext) {
    const target = outputSize(preset);
    const image = { width: aligned.width, height: aligned.height };
    emit({ type: "preview", stage: "cutout", ...(await storePreview(sharp(aligned.png), "png", "cutout")) });

    emit({ type: "step", step: "white", status: "active" });
    emit({ type: "preview", stage: "white", ...(await storePreview(createWhiteBackground(sharp(aligned.png), preset.background), "jpeg", "white")) });
    emit({ type: "step", step: "white", status: "done" });

    // 9–11. Where the head is (in the straightened photo), and the composition around it.
    emit({ type: "step", step: "composition", status: "active" });
    const head = analyzeHead(aligned.face, aligned.alpha, image.width, image.height);
    warn(inspectPose(head));
    const crop = calculateCrop(head, preset);
    emit({ type: "crop", rect: { x: crop.x / image.width, y: crop.y / image.height, width: crop.width / image.width, height: crop.height / image.height } });
    const region = workingRegion(crop, image.width, image.height);
    const regionCutout = await cropImage(aligned.png, image, region, CLEAR);
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
        baseName,
    };
    const rendered = await renderPhoto(working, meta, meta.autoCrop);
    const workId = tempStore.put(working, "image/jpeg", "working.jpg", meta);
    emit({ type: "step", step: "finalize", status: "done" });

    return {
        ...rendered,
        preset: describePreset(preset),
        work: { id: workId, url: fileUrl(workId), width: meta.width, height: meta.height, crop: meta.autoCrop, autoCrop: meta.autoCrop, head: meta.head },
        upscaled,
    };
}

/**
 * A hand-set angle (fine-tuning the automatic one): the kept cut-out turned once by it, then composed
 * exactly as the automatic photo was. No second background removal.
 */
async function rotatePhoto(sourceId: unknown, angle: unknown, context: ProcessingContext): Promise<Omit<GeneratedPhoto, "source">> {
    const source = typeof sourceId === "string" ? tempStore.get(sourceId) : null;
    const meta = source?.meta as SourceMeta | undefined;
    if (!source || !meta?.presetId) throw new AppError("This photo has expired. Please create it again.", 404, "FILE_EXPIRED");
    const max = env.photoGenerator.maxAutoRotationDeg;
    const degrees = Number(angle);
    if (!Number.isFinite(degrees) || Math.abs(degrees) > max) throw new AppError(`Choose an angle between −${max}° and ${max}°.`, 400, "INVALID_REQUEST");
    const preset = getPreset(meta.presetId);
    const warnings: WarningCode[] = [];
    const aligned = await alignManually(source, meta, degrees);
    const { upscaled: _upscaled, ...composed } = await composePhoto(aligned, preset, meta.baseName, () => undefined, (codes) => warnings.push(...codes.filter((code) => !warnings.includes(code))), context);
    return {
        ...composed,
        warnings,
        alignment: { sourceId: sourceId as string, angle: round1(aligned.angle), autoAngle: round1(meta.autoAngle), residual: round1(aligned.residual), maxAngle: max },
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
    rotate: (sourceId: unknown, angle: unknown, context: ProcessingContext) => limiter.run(() => rotatePhoto(sourceId, angle, context), context.signal),
    createSheet,
    file: (id: string) => tempStore.get(id),
};
