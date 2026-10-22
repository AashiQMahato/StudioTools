import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * The whiteboard's fonts (Excalifont, Virgil, Nunito, Comic Shanns, Xiaolai…), served from our own
 * origin as the package's self-hosting guide describes, so text never waits on a CDN. They're copied
 * from the installed package, under its version, so a package update never meets a cached old font.
 * The whiteboard sets window.EXCALIDRAW_ASSET_PATH to the same folder (see features/whiteboard/assetPath.ts).
 */
function excalidrawFonts(): Plugin {
    // The entry is dist/prod/index.js; the package's exports don't expose package.json itself.
    const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.resolve("@excalidraw/excalidraw"))), "../..");
    const { version } = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8")) as { version: string };
    const fontsDir = path.join(packageDir, "dist", "prod", "fonts");
    const publicDir = `excalidraw/${version}/`;
    const fonts = fs.readdirSync(fontsDir, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".woff2"));

    return {
        name: "excalidraw-fonts",
        config: () => ({ define: { "import.meta.env.VITE_EXCALIDRAW_ASSET_DIR": JSON.stringify(publicDir) } }),
        configureServer(server) {
            server.middlewares.use(`/${publicDir}fonts/`, (request, response, next) => {
                const file = path.join(fontsDir, decodeURIComponent((request.url ?? "").split("?")[0] ?? ""));
                if (!file.startsWith(fontsDir + path.sep) || !fs.existsSync(file)) return next();
                response.setHeader("Content-Type", "font/woff2");
                fs.createReadStream(file).pipe(response);
            });
        },
        generateBundle() {
            for (const font of fonts) {
                this.emitFile({ type: "asset", fileName: `${publicDir}fonts/${font.split(path.sep).join("/")}`, source: fs.readFileSync(path.join(fontsDir, font)) });
            }
        },
    };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    // Dev-server-only setting; not prefixed with VITE_, so it is never bundled into the client.
    const { API_PROXY_TARGET = "http://localhost:5000" } = loadEnv(mode, process.cwd(), "");

    return {
        plugins: [react(), tailwindcss(), excalidrawFonts()],
        resolve: {
            alias: {
                "@": fileURLToPath(new URL("./src", import.meta.url)),
            },
        },
        server: {
            port: 5173,
            // In development, forward API calls to the backend so the browser only talks to our own origin.
            proxy: {
                "/api": {
                    target: API_PROXY_TARGET,
                    changeOrigin: true,
                },
            },
        },
    };
});
