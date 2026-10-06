/**
 * Starts a browser download for a URL (blob: or same-origin file).
 * Not a router link on purpose: React Aria's client-side routing would otherwise treat a same-origin
 * URL as an in-app navigation instead of a download.
 */
export function downloadFile(url: string, fileName: string) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
}

/** Saves data already in memory under a file name (the object URL is released once the download has started). */
export function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    downloadFile(url, fileName);
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
