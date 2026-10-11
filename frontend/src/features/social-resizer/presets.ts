/**
 * Social media image sizes — the one place to update them.
 *
 * Verified 2026-10-11. Where sources disagree, the platform's own number wins (noted per entry).
 * Platform sources:
 *   - YouTube banner:   https://support.google.com/youtube/answer/10456525 (2560×1440, safe area 1546×423)
 *   - YouTube thumbnail: https://support.google.com/youtube/answer/72431 (now "as large as possible", 3840×2160; 16:9)
 *   - Facebook cover:   https://www.facebook.com/help/125379114252045 (851×315)
 *   - LinkedIn images:  https://www.linkedin.com/help/linkedin/answer/a563309 (shared image 1200×627, company cover 1512×256)
 *   - LinkedIn profile: https://www.linkedin.com/help/linkedin/answer/a566232 (banner 1584×396, photo 400×400)
 *   - Meta story/reel safe zones: https://www.facebook.com/business/ads-guide/update/video/instagram-reels
 *     (keep text out of the top 14%, bottom 35% and 6% at each side)
 *   - TikTok: https://ads.tiktok.com/help (9:16, ≥540×960; no published pixel safe zone)
 * Guides (used where the platform publishes no number): Hootsuite social media image sizes (Oct 2026),
 * Sprout Social image sizes (May 2026), Buffer (May 2026).
 */

export type Platform = "instagram" | "facebook" | "linkedin" | "youtube" | "tiktok";

export const PLATFORMS: readonly Platform[] = ["instagram", "facebook", "linkedin", "youtube", "tiktok"];

/** Brand names stay untranslated. */
export const PLATFORM_NAMES: Record<Platform, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", youtube: "YouTube", tiktok: "TikTok" };

/** What the image is used as (the content type). */
export type Kind = "post" | "story" | "reel" | "short" | "video" | "cover" | "banner" | "thumbnail" | "profile";

/** Keep important content inside: insets from each edge, as fractions of the frame. */
export interface SafeArea {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export interface Preset {
    /** Also the file-name suffix: `<base>-<id>-<w>x<h>`. */
    id: string;
    platform: Platform;
    kind: Kind;
    /** Key into the copy's preset labels. */
    label: PresetLabel;
    width: number;
    height: number;
    /** As shown to people; tests check it matches width × height. */
    ratio: string;
    safe?: SafeArea;
    /** Shown cropped to a circle (profile photos). */
    circle?: boolean;
    notes?: string;
}

export type PresetLabel =
    | "square"
    | "portrait"
    | "landscape"
    | "story"
    | "reel"
    | "profile"
    | "cover"
    | "eventCover"
    | "shared"
    | "banner"
    | "companyCover"
    | "thumbnail"
    | "thumbnail4k"
    | "channelBanner"
    | "short"
    | "video";

/** Pixel insets → fractions, so the config can quote the sources' numbers as they are. */
const insets = (width: number, height: number, px: SafeArea): SafeArea => ({ top: px.top / height, right: px.right / width, bottom: px.bottom / height, left: px.left / width });

/** Meta's 14% top / 35% bottom / 6% sides, for Stories and Reels on Instagram and Facebook. */
const META_VERTICAL: SafeArea = { top: 0.14, right: 0.06, bottom: 0.35, left: 0.06 };

export const PRESETS: readonly Preset[] = [
    // Instagram — Meta's help pages didn't render; numbers agree across Hootsuite, Sprout and Buffer.
    { id: "instagram-square", platform: "instagram", kind: "post", label: "square", width: 1080, height: 1080, ratio: "1:1" },
    { id: "instagram-portrait", platform: "instagram", kind: "post", label: "portrait", width: 1080, height: 1350, ratio: "4:5", notes: "Profile grid previews it at 3:4." },
    { id: "instagram-landscape", platform: "instagram", kind: "post", label: "landscape", width: 1080, height: 566, ratio: "1.91:1" },
    { id: "instagram-story", platform: "instagram", kind: "story", label: "story", width: 1080, height: 1920, ratio: "9:16", safe: META_VERTICAL },
    { id: "instagram-reel", platform: "instagram", kind: "reel", label: "reel", width: 1080, height: 1920, ratio: "9:16", safe: META_VERTICAL },
    { id: "instagram-profile", platform: "instagram", kind: "profile", label: "profile", width: 320, height: 320, ratio: "1:1", circle: true },

    // Facebook
    { id: "facebook-square", platform: "facebook", kind: "post", label: "square", width: 1080, height: 1080, ratio: "1:1" },
    { id: "facebook-portrait", platform: "facebook", kind: "post", label: "portrait", width: 1080, height: 1350, ratio: "4:5" },
    { id: "facebook-landscape", platform: "facebook", kind: "post", label: "landscape", width: 1080, height: 566, ratio: "1.91:1" },
    {
        id: "facebook-cover",
        platform: "facebook",
        kind: "cover",
        label: "cover",
        width: 851,
        height: 315,
        ratio: "2.7:1",
        // Facebook Help says 851×315; phones crop the sides, so keep the subject central.
        notes: "Guides quote 640×360 for phones; Facebook's own page says 851×315.",
    },
    { id: "facebook-story", platform: "facebook", kind: "story", label: "story", width: 1080, height: 1920, ratio: "9:16", safe: META_VERTICAL },
    { id: "facebook-event", platform: "facebook", kind: "cover", label: "eventCover", width: 1920, height: 1005, ratio: "1.91:1", notes: "From Sprout; not confirmed on a Meta page." },
    { id: "facebook-profile", platform: "facebook", kind: "profile", label: "profile", width: 320, height: 320, ratio: "1:1", circle: true },

    // LinkedIn
    { id: "linkedin-shared", platform: "linkedin", kind: "post", label: "shared", width: 1200, height: 627, ratio: "1.91:1" },
    { id: "linkedin-square", platform: "linkedin", kind: "post", label: "square", width: 1080, height: 1080, ratio: "1:1", notes: "Hootsuite says 1200×1200; same ratio." },
    { id: "linkedin-portrait", platform: "linkedin", kind: "post", label: "portrait", width: 1080, height: 1350, ratio: "4:5", notes: "Guides only; LinkedIn publishes no portrait size." },
    { id: "linkedin-banner", platform: "linkedin", kind: "banner", label: "banner", width: 1584, height: 396, ratio: "4:1" },
    { id: "linkedin-company", platform: "linkedin", kind: "cover", label: "companyCover", width: 1512, height: 256, ratio: "5.9:1", notes: "LinkedIn Help; older guides still say 1128×191." },
    { id: "linkedin-profile", platform: "linkedin", kind: "profile", label: "profile", width: 400, height: 400, ratio: "1:1", circle: true },

    // YouTube
    { id: "youtube-thumbnail", platform: "youtube", kind: "thumbnail", label: "thumbnail", width: 1280, height: 720, ratio: "16:9", notes: "The long-standing size; still accepted." },
    { id: "youtube-thumbnail-4k", platform: "youtube", kind: "thumbnail", label: "thumbnail4k", width: 3840, height: 2160, ratio: "16:9", notes: "YouTube Help's current recommendation." },
    { id: "youtube-banner", platform: "youtube", kind: "banner", label: "channelBanner", width: 2560, height: 1440, ratio: "16:9", safe: insets(2560, 1440, { top: 508.5, right: 507, bottom: 508.5, left: 507 }) },
    { id: "youtube-short", platform: "youtube", kind: "short", label: "short", width: 1080, height: 1920, ratio: "9:16" },
    { id: "youtube-profile", platform: "youtube", kind: "profile", label: "profile", width: 800, height: 800, ratio: "1:1", circle: true },

    // TikTok — no official pixel safe zone; these are the commonly quoted ones (approximate).
    { id: "tiktok-video", platform: "tiktok", kind: "video", label: "video", width: 1080, height: 1920, ratio: "9:16", safe: insets(1080, 1920, { top: 160, right: 140, bottom: 480, left: 120 }) },
    { id: "tiktok-profile", platform: "tiktok", kind: "profile", label: "profile", width: 200, height: 200, ratio: "1:1", circle: true },
];

export const presetById = (id: string) => PRESETS.find((preset) => preset.id === id);

export const presetsFor = (platform: Platform) => PRESETS.filter((preset) => preset.platform === platform);

/** Parse "4:5" or "1.91:1" into a number. */
export function ratioValue(ratio: string) {
    const [a, b] = ratio.split(":").map(Number);
    return a && b ? a / b : NaN;
}

/** Largest side we export; also the custom-size limit. */
export const MAX_SIDE = 8192;
/** Larger canvases fail on phones (iOS caps at ~16.7 MP; desktop browsers higher). */
export const MAX_PIXELS = 40_000_000;

export type CustomError = "invalid" | "tooSmall" | "tooLarge" | "tooManyPixels";

/** Validate a typed custom size. */
export function validateCustom(widthText: string, heightText: string): { width: number; height: number } | { error: CustomError } {
    const width = Number(widthText.trim());
    const height = Number(heightText.trim());
    if (!widthText.trim() || !heightText.trim() || !Number.isInteger(width) || !Number.isInteger(height)) return { error: "invalid" };
    if (width < 16 || height < 16) return { error: "tooSmall" };
    if (width > MAX_SIDE || height > MAX_SIDE) return { error: "tooLarge" };
    if (width * height > MAX_PIXELS) return { error: "tooManyPixels" };
    return { width, height };
}

/** A readable ratio for a custom size: "4:5" when small whole numbers, else "1.91:1". */
export function ratioLabel(width: number, height: number) {
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const d = gcd(width, height);
    if (width / d <= 32 && height / d <= 32) return `${width / d}:${height / d}`;
    return width >= height ? `${(width / height).toFixed(2).replace(/0$/, "")}:1` : `1:${(height / width).toFixed(2).replace(/0$/, "")}`;
}

/** `<base>-instagram-portrait-1080x1350.jpg` */
export function exportName(base: string, id: string, width: number, height: number, extension: string) {
    const clean = base.normalize("NFC").replace(/[^\p{L}\p{M}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase() || "image";
    return `${clean}-${id}-${width}x${height}.${extension}`;
}
