import { downloadBlob } from "@/lib/utils/download";
import { buildPdf, layoutPage, type PaperSize } from "./pdf";
import { renderPage } from "./scanClient";
import type { ScanPage } from "./useScanPages";

type ReadyPage = ScanPage & { result: NonNullable<ScanPage["result"]>; quad: NonNullable<ScanPage["quad"]> };

export const isReady = (page: ScanPage): page is ReadyPage => page.status === "ready" && Boolean(page.result && page.quad);

/** The pages as one PDF, their JPEGs embedded as they are. */
export async function scanToPdf(pages: readonly ReadyPage[], size: PaperSize): Promise<Blob> {
    const jpegs = await Promise.all(pages.map(async (page) => new Uint8Array(await page.result.blob.arrayBuffer())));
    return new Blob([buildPdf(jpegs, size)], { type: "application/pdf" });
}

/** One page as JPEG (the rendered result) or PNG (rendered again, losslessly). */
export async function downloadPageImage(page: ReadyPage, format: "jpg" | "png", fileName: string) {
    const blob = format === "jpg" ? page.result.blob : (await renderPage(page.id, page.file, page.quad, page.quarterTurns, page.look, "image/png")).blob;
    downloadBlob(blob, `${fileName}.${format}`);
}

/**
 * Prints the pages at the chosen paper size, through a hidden frame holding one sheet per page (each
 * with its own @page size, so mixed orientations print right). Resolves once the print dialog is up.
 */
export function printPages(pages: readonly ReadyPage[], size: PaperSize): Promise<void> {
    const sheets = pages.map((page, index) => {
        const layout = layoutPage(size, page.result.width, page.result.height);
        const { x, y, width, height } = layout.image;
        return {
            css: `@page p${index} { size: ${layout.width}pt ${layout.height}pt; margin: 0; } .p${index} { page: p${index}; width: ${layout.width}pt; height: ${layout.height}pt; }`,
            html: `<div class="sheet p${index}"><img src="${page.result.url}" alt="" style="left:${x}pt;top:${layout.height - y - height}pt;width:${width}pt;height:${height}pt"></div>`,
        };
    });
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    frame.srcdoc = `<!doctype html><html><head><style>
        html, body { margin: 0; padding: 0; }
        .sheet { position: relative; overflow: hidden; break-after: page; }
        .sheet:last-child { break-after: auto; }
        .sheet img { position: absolute; }
        ${sheets.map((sheet) => sheet.css).join("\n")}
    </style></head><body>${sheets.map((sheet) => sheet.html).join("")}</body></html>`;
    return new Promise((resolve, reject) => {
        frame.onload = async () => {
            const view = frame.contentWindow;
            if (!view) return reject(new Error("print"));
            try {
                await Promise.all([...view.document.images].map((image) => image.decode()));
            } catch {
                frame.remove();
                return reject(new Error("print"));
            }
            // The frame goes once printing is done (or abandoned); a minute is the fallback.
            const done = () => frame.remove();
            view.addEventListener("afterprint", done, { once: true });
            window.setTimeout(done, 60_000);
            view.focus();
            view.print();
            resolve();
        };
        document.body.append(frame);
    });
}
