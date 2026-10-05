import { env } from "../../config/env.js";
import type { ImageInput, ImageOutput, ProcessingContext, UpscaleOptions } from "../../types/image.js";
import { AppError } from "../../utils/AppError.js";
import { ConcurrencyLimiter } from "../../utils/concurrency.js";
import { upscaylProvider } from "./upscaylProvider.js";

/** Local Upscayl (upscayl-ncnn) is the only provider. */
const provider = upscaylProvider;
// GPU-heavy: default to one job at a time.
const limiter = new ConcurrencyLimiter(env.upscayl.concurrency, env.maxQueuedJobs);

export const upscaling = {
    isAvailable: () => provider.isAvailable(),
    stats: () => limiter.stats,
    upscale(input: ImageInput, options: UpscaleOptions, context: ProcessingContext): Promise<ImageOutput> {
        if (!provider.isAvailable()) {
            return Promise.reject(new AppError(provider.unavailableMessage, 503, "UPSCALING_UNAVAILABLE"));
        }
        return limiter.run(() => provider.upscale(input, options, context), context.signal);
    },
};
