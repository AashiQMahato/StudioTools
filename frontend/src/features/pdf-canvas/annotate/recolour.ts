/*
 * Signature ink: a signature (drawn, typed or a photo of one) recoloured to another ink. Every pixel
 * takes the ink's colour; how much of it shows follows how dark — how inked — the pixel was, so the
 * strokes stay solid, their soft edges stay soft, and any paper left in a photo fades away.
 */

const hex = (colour: string) => {
    const value = colour.replace("#", "");
    const full = value.length === 3 ? [...value].map((digit) => digit + digit).join("") : value;
    return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)) as [number, number, number];
};

/** Recolours RGBA pixels in place. */
export function inkPixels(pixels: Uint8ClampedArray, ink: string) {
    const [red, green, blue] = hex(ink);
    for (let index = 0; index < pixels.length; index += 4) {
        const light = 0.299 * pixels[index]! + 0.587 * pixels[index + 1]! + 0.114 * pixels[index + 2]!;
        // Ink is dark: anything darker than mid-grey is fully ink; paper-white is none.
        const strength = Math.min(1, (255 - light) / 110);
        pixels[index] = red;
        pixels[index + 1] = green;
        pixels[index + 2] = blue;
        pixels[index + 3] = Math.round(pixels[index + 3]! * strength);
    }
}

/** A picture recoloured to an ink, as a new PNG of the same size. */
export async function recolourPicture(blob: Blob, ink: string): Promise<{ blob: Blob; width: number; height: number }> {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const data = context.getImageData(0, 0, canvas.width, canvas.height);
    inkPixels(data.data, ink);
    context.putImageData(data, 0, 0);
    const result = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!result) throw new Error("Couldn't recolour the signature.");
    return { blob: result, width: canvas.width, height: canvas.height };
}
