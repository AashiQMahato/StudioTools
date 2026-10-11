/** Copies plain text: the Clipboard API where allowed, else the old select-and-copy (non-secure pages, older browsers). */
export async function copyText(text: string): Promise<boolean> {
    try {
        if (window.isSecureContext && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // Denied or unavailable: try the fallback.
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.append(area);
    area.select();
    let copied = false;
    try {
        copied = document.execCommand("copy");
    } catch {
        copied = false;
    }
    area.remove();
    return copied;
}
