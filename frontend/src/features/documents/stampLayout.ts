/**
 * Where watermarks and page numbers go — the same arithmetic as the server
 * (backend/src/services/pdf/stampService.ts), in points on the page as the reader sees it, so the
 * preview is the result.
 */
export type Position = "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right";
export type NumberPosition = "top-left" | "top" | "top-right" | "bottom-left" | "bottom" | "bottom-right";

const EDGE = 36;

export function stampCentres(page: { width: number; height: number }, stamp: { width: number; height: number }, rotation: number, position: Position | "tile") {
    const radians = (rotation * Math.PI) / 180;
    const boxWidth = Math.abs(stamp.width * Math.cos(radians)) + Math.abs(stamp.height * Math.sin(radians));
    const boxHeight = Math.abs(stamp.width * Math.sin(radians)) + Math.abs(stamp.height * Math.cos(radians));
    if (position === "tile") {
        const stepX = boxWidth * 1.25 + 48;
        const stepY = boxHeight * 1.6 + 72;
        const centres: { x: number; y: number }[] = [];
        for (let row = 0, y = stepY / 2; y - boxHeight / 2 < page.height; row++, y += stepY) {
            for (let x = row % 2 ? 0 : stepX / 2; x - boxWidth / 2 < page.width; x += stepX) centres.push({ x, y });
        }
        return centres;
    }
    const column = position.endsWith("left") ? 0 : position.endsWith("right") ? 2 : 1;
    const row = position.startsWith("top") ? 0 : position.startsWith("bottom") ? 2 : 1;
    return [{ x: [EDGE + boxWidth / 2, page.width / 2, page.width - EDGE - boxWidth / 2][column]!, y: [EDGE + boxHeight / 2, page.height / 2, page.height - EDGE - boxHeight / 2][row]! }];
}

export function numberCentre(page: { width: number; height: number }, label: { width: number; height: number }, position: NumberPosition, margin: number) {
    const column = position.endsWith("left") ? 0 : position.endsWith("right") ? 2 : 1;
    return {
        x: [margin + label.width / 2, page.width / 2, page.width - margin - label.width / 2][column]!,
        y: position.startsWith("top") ? margin + label.height / 2 : page.height - margin - label.height / 2,
    };
}

/** Latin text is set in Helvetica (vector); anything else in Noto Sans Devanagari (shaped, as an image). */
const isLatin = (text: string) => /^[\x20-\x7e -ÿ]*$/.test(text);

let context: CanvasRenderingContext2D | null = null;
/**
 * A text stamp's size in points, as the server will set it: Helvetica's width and cap height for
 * Latin text; the shaped line (with its line height) for Devanagari.
 */
export function measureStamp(text: string, size: number, bold: boolean): { width: number; height: number; font: string } {
    context ??= document.createElement("canvas").getContext("2d");
    const latin = isLatin(text);
    const font = `${bold ? "700" : "400"} ${size}px ${latin ? "Helvetica, Arial, sans-serif" : '"Noto Sans Devanagari", sans-serif'}`;
    if (context) context.font = font;
    const width = context?.measureText(text).width ?? text.length * size * 0.6;
    return { width, height: latin ? size * 0.517 : size * 1.37, font };
}
