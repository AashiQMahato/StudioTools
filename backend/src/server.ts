import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { imageService } from "./services/image-service/imageServiceProcess.js";
import { ocrProcess } from "./services/ocr/providers/paddleProvider.js";
import { upscaylProvider } from "./services/upscaling/upscaylProvider.js";
import { resetWorkspaces } from "./services/files/workspace.js";
import { deleteAllJobs } from "./services/jobs/jobService.js";

// Documents from a previous run are never left behind.
await resetWorkspaces();

const app = createApp();

const server = app.listen(env.port, () => {
    console.log(`Studio Tools API listening on http://localhost:${env.port}`);
    // Bring processors up in the background; the API answers immediately and reports readiness via /api/health.
    void imageService.start();
    void upscaylProvider.probe();
});

server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
        console.error(
            `Port ${env.port} is already in use. On macOS, port 5000 is taken by AirPlay Receiver — ` +
                "disable it in System Settings → General → AirDrop & Handoff, or set a different PORT in .env.",
        );
    } else {
        console.error(error);
    }
    process.exit(1);
});

let shuttingDown = false;
function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down...`);
    imageService.stop();
    ocrProcess.stop();
    void deleteAllJobs();
    server.close(() => process.exit(0));
    // Don't hang on keep-alive connections.
    setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("exit", () => {
    imageService.stop();
    ocrProcess.stop();
});
