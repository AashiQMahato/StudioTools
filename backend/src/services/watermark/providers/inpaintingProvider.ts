import { env } from "../../../config/env.js";
import type { ImageInput, ImageOutput, ProcessingContext } from "../../../types/image.js";
import { retouching } from "../../retouch/retouchService.js";

/** Contract every inpainting engine implements: the image plus a mask in, the rebuilt image out. */
export interface InpaintingProvider {
    readonly name: string;
    inpaint(input: ImageInput, mask: Buffer, context: ProcessingContext): Promise<ImageOutput>;
}

/**
 * Inpainting through the retouch pipeline's "remove" mode: only the region around the mask is rebuilt
 * (by LaMa via IOPaint when configured, otherwise the built-in engine) and blended back at full
 * resolution. WATERMARK_REMOVAL_PROVIDER picks the engine.
 */
const retouchInpainter: InpaintingProvider = {
    get name() {
        return retouching.providerName("remove", env.watermark.removalProvider);
    },
    inpaint: (input, mask, context) => retouching.retouch(input, mask, { mode: "remove", strength: 1, texture: 0 }, context, env.watermark.removalProvider),
};

export const inpainter: InpaintingProvider = retouchInpainter;
