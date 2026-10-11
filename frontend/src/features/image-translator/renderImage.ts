import type { OcrDocument } from "@/lib/api/ocrApi";
import type { TranslatorBlock } from "./blocks";
import { fontStackFor, type TargetLanguage } from "./languages";
import { planOverlay } from "./layout";

type Page = OcrDocument["document"];

/** The image as the OCR saw it: turned the same way (a sideways page), at the size its boxes refer to. */
export async function loadPage(image: Blob, page: Page): Promise<HTMLCanvasElement> {
    const bitmap = await createImageBitmap(image);
    const canvas = document.createElement("canvas");
    canvas.width = page.width;
    canvas.height = page.height;
    const context = canvas.getContext("2d")!;
    const rotation = page.rotation ?? 0;
    const [width, height] = rotation % 180 ? [page.height, page.width] : [page.width, page.height];
    context.translate(page.width / 2, page.height / 2);
    context.rotate((rotation * Math.PI) / 180);
    context.drawImage(bitmap, -width / 2, -height / 2, width, height);
    bitmap.close();
    return canvas;
}

/** Make sure the web fonts (and the subsets these characters need) are in before measuring with them. */
async function loadFonts(fontFamily: string, weights: Set<number>, sample: string) {
    try {
        await Promise.all([...weights].map((weight) => document.fonts.load(`${weight} 32px ${fontFamily}`, sample)));
    } catch {
        // Offline or blocked: the system fallback still draws the text.
    }
}

export interface RenderedImage {
    blob: Blob;
    /** Translated blocks that couldn't be set legibly in their box (left as in the original). */
    skipped: number;
    drawn: number;
}

/**
 * An approximate translated image: each block's area is painted in its estimated background colour,
 * then the translation is set in it — wrapped and shrunk to fit, in the estimated colour, weight and alignment.
 */
export async function renderTranslatedImage(options: { page: HTMLCanvasElement; document: Page; blocks: readonly TranslatorBlock[]; target: TargetLanguage; type: "image/png" | "image/jpeg"; quality?: number }): Promise<RenderedImage> {
    const { page, document: info, blocks, target, type } = options;
    const fontFamily = fontStackFor(target);
    await loadFonts(fontFamily, new Set(blocks.map((block) => block.style.fontWeight ?? 400)), blocks.map((block) => block.translated ?? "").join(" ").slice(0, 400));

    const canvas = document.createElement("canvas");
    canvas.width = page.width;
    canvas.height = page.height;
    const context = canvas.getContext("2d")!;
    // JPEG has no transparency: flatten onto white rather than black.
    if (type === "image/jpeg") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(page, 0, 0);
    context.direction = target.rtl ? "rtl" : "ltr";
    const measure = (text: string, font: string) => {
        context.font = font;
        return context.measureText(text).width;
    };
    const plan = planOverlay(blocks, { width: page.width, height: page.height, fontScale: info.width / (info.pageWidth || info.width) }, { fontFamily, locale: target.code, measure, rtl: target.rtl });

    context.textBaseline = "middle";
    for (const draw of plan.draws) {
        context.fillStyle = draw.background;
        context.fillRect(draw.patch.x, draw.patch.y, draw.patch.width, draw.patch.height);
        context.font = draw.font;
        context.fillStyle = draw.color;
        context.textAlign = draw.align;
        const x = draw.align === "center" ? draw.x + draw.width / 2 : draw.align === "right" ? draw.x + draw.width : draw.x;
        draw.lines.forEach((line, index) => context.fillText(line, x, draw.y + draw.lineHeight * (index + 0.5)));
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, options.quality ?? 0.92));
    if (!blob) throw new Error("The image couldn't be encoded.");
    return { blob, skipped: plan.skipped, drawn: plan.draws.length };
}
