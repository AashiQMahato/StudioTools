/**
 * A small PDF writer: one JPEG per page, embedded as is (/DCTDecode, no re-encoding), on A4, US Letter
 * or a page shaped like the image. No margins.
 */

export const PAPER_SIZES = ["a4", "letter", "fit"] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

/** Portrait sizes in points (1/72 in). */
const PAPER: Record<Exclude<PaperSize, "fit">, { width: number; height: number }> = {
    a4: { width: 595.28, height: 841.89 },
    letter: { width: 612, height: 792 },
};

export interface PageLayout {
    width: number;
    height: number;
    /** Where the image sits on the page (points, from the bottom left as PDF counts). */
    image: { x: number; y: number; width: number; height: number };
}

/**
 * The page for an image of `width`×`height` px: paper turned to match the image's orientation, the
 * image as large as fits, centred. "fit" makes the page the image's shape, its long side A4's.
 */
export function layoutPage(size: PaperSize, width: number, height: number): PageLayout {
    const landscape = width > height;
    if (size === "fit") {
        const scale = PAPER.a4.height / Math.max(width, height);
        const page = { width: width * scale, height: height * scale };
        return { ...page, image: { x: 0, y: 0, ...page } };
    }
    const paper = PAPER[size];
    const page = landscape ? { width: paper.height, height: paper.width } : paper;
    const scale = Math.min(page.width / width, page.height / height);
    const image = { width: width * scale, height: height * scale, x: 0, y: 0 };
    image.x = (page.width - image.width) / 2;
    image.y = (page.height - image.height) / 2;
    return { ...page, image };
}

/** A JPEG's pixel size and channel count, read from its frame header. */
export function jpegInfo(bytes: Uint8Array): { width: number; height: number; components: number } {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("not-jpeg");
    let i = 2;
    while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) {
            i++;
            continue;
        }
        const marker = bytes[i + 1]!;
        // Start-of-frame markers (C0–CF, except DHT C4, JPG C8 and DAC CC) carry the size.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]!, components: bytes[i + 9]! };
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
            i += marker === 0xff ? 1 : 2;
            continue;
        }
        i += 2 + ((bytes[i + 2]! << 8) | bytes[i + 3]!);
    }
    throw new Error("not-jpeg");
}

const COLOUR_SPACES: Record<number, string> = { 1: "/DeviceGray", 3: "/DeviceRGB", 4: "/DeviceCMYK" };
const fixed = (value: number) => Number(value.toFixed(2)).toString();

/** Builds the PDF: catalog, page tree, then a page, its content stream and its image per JPEG. */
export function buildPdf(jpegs: readonly Uint8Array[], size: PaperSize): Uint8Array<ArrayBuffer> {
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    const offsets: number[] = [];
    let length = 0;
    const write = (part: string | Uint8Array) => {
        const bytes = typeof part === "string" ? encoder.encode(part) : part;
        chunks.push(bytes);
        length += bytes.length;
    };
    const object = (id: number, body: string, stream?: Uint8Array) => {
        offsets[id] = length;
        write(`${id} 0 obj\n${body}\n`);
        if (stream) {
            write("stream\n");
            write(stream);
            write("\nendstream\n");
        }
        write("endobj\n");
    };

    // The binary comment tells transfer tools the file isn't plain text.
    write("%PDF-1.4\n");
    write(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    const pageIds = jpegs.map((_, index) => 3 + index * 3);
    object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${jpegs.length} >>`);
    jpegs.forEach((jpeg, index) => {
        const id = pageIds[index]!;
        const info = jpegInfo(jpeg);
        const layout = layoutPage(size, info.width, info.height);
        const { x, y, width, height } = layout.image;
        const content = encoder.encode(`q ${fixed(width)} 0 0 ${fixed(height)} ${fixed(x)} ${fixed(y)} cm /Im0 Do Q`);
        object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fixed(layout.width)} ${fixed(layout.height)}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
        object(id + 1, `<< /Length ${content.length} >>`, content);
        const decode = info.components === 4 ? " /Decode [1 0 1 0 1 0 1 0]" : "";
        object(id + 2, `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${COLOUR_SPACES[info.components] ?? "/DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode${decode} /Length ${jpeg.length} >>`, jpeg);
    });

    const count = 3 + jpegs.length * 3;
    const xref = length;
    // Every xref entry is exactly 20 bytes, line ending included.
    write(`xref\n0 ${count}\n0000000000 65535 f \n`);
    for (let id = 1; id < count; id++) write(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
    write(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.length;
    }
    return out;
}
