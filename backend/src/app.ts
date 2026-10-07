import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env, isProduction } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { apiRateLimiter } from "./middleware/rateLimiter.js";
import { apiRouter } from "./routes/index.js";

export function createApp() {
    const app = express();

    app.disable("x-powered-by");
    // Behind a proxy (TRUST_PROXY = how many), rate limits count each visitor by their own address.
    if (env.trustProxy > 0) app.set("trust proxy", env.trustProxy);

    // The site may live on another origin (FRONTEND_URL): it shows result images straight from here
    // (<img>), which the default same-origin resource policy would block.
    app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
    app.use(
        cors({
            origin: env.frontendOrigins,
            // DELETE: the site removes a job's files as soon as they're no longer needed.
            methods: ["GET", "POST", "DELETE"],
            // Let a cross-origin frontend read result metadata and the suggested file name.
            exposedHeaders: [
                "Content-Disposition",
                "X-Image-Width",
                "X-Image-Height",
                "X-Original-Width",
                "X-Original-Height",
                "X-Original-Size",
                "X-Compressed-Size",
                "X-Output-Format",
                "X-Quality",
                "X-Resized",
                "X-Target-Met",
                "X-Flattened",
                "X-Already-Optimal",
                "X-Quality-Warning",
            ],
        }),
    );
    app.use(morgan(isProduction ? "combined" : "dev"));
    app.use(express.json({ limit: "1mb" }));

    app.use("/api", apiRateLimiter, apiRouter);

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}
