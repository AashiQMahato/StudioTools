import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, constants } from "node:fs/promises";
import net from "node:net";
import { fetchBuffered } from "./fetchBuffered.js";

export type ServiceStatus = "disabled" | "starting" | "ready" | "unavailable";

export interface Endpoint {
    url: string;
    token: string;
}

interface PythonServiceConfig {
    /** For logs and messages, e.g. "Background removal". */
    name: string;
    /** Prefix for the child's log lines, e.g. "[image-service]". */
    tag: string;
    pythonPath: () => string;
    /** Directory holding app.py. */
    cwd: () => string;
    /** Extra environment for the child (never the parent's whole environment). */
    env: () => Record<string, string>;
    /** A service run separately instead of launched here; null to launch it. */
    external?: () => Endpoint | { error: string } | null;
    /** Where the service is and how to set it up, for the "unavailable" message. */
    setupHint: string;
    /** First launch may download models, so readiness can take minutes. */
    readyTimeoutMs?: number;
}

/**
 * Owns the lifecycle of an internal Python service: launched on a free localhost port with a fresh
 * random token (so only this Node process can call it), polled until its /health says ready, and
 * stopped with the API. The child exits by itself if this process disappears (it watches PARENT_PID).
 */
export class PythonService {
    private child: ChildProcess | null = null;
    private endpoint: Endpoint | null = null;
    private status: ServiceStatus = "disabled";
    private reason = "";
    private starting: Promise<void> | null = null;

    constructor(private readonly config: PythonServiceConfig) {}

    get state() {
        return { status: this.status, reason: this.reason };
    }

    get connection(): Endpoint | null {
        return this.status === "ready" ? this.endpoint : null;
    }

    /** Starts the service (once); resolves when it's ready or has failed. */
    start(): Promise<void> {
        this.starting ??= this.launch().finally(() => {
            this.starting = null;
        });
        return this.starting;
    }

    /** The connection, starting the service first if it isn't running (for services started on demand). */
    async ensureReady(): Promise<Endpoint | null> {
        if (this.status === "ready") return this.endpoint;
        if (this.status === "disabled" || this.status === "unavailable") await this.start();
        else await this.starting;
        return this.connection;
    }

    stop() {
        this.status = "disabled";
        if (this.child && this.child.exitCode === null) this.child.kill("SIGTERM");
        this.child = null;
    }

    private async launch() {
        const external = this.config.external?.() ?? null;
        if (external && "error" in external) return this.fail(external.error);
        if (external) {
            this.endpoint = external;
            this.status = "starting";
            return this.waitUntilReady();
        }

        try {
            await access(this.config.pythonPath(), constants.X_OK);
        } catch {
            return this.fail(`Python environment not found. ${this.config.setupHint}`);
        }

        const port = await freePort();
        const token = randomBytes(32).toString("hex");
        this.endpoint = { url: `http://127.0.0.1:${port}`, token };
        this.status = "starting";
        this.reason = "";

        const child = spawn(this.config.pythonPath(), ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", String(port), "--workers", "1", "--no-access-log", "--log-level", "warning"], {
            cwd: this.config.cwd(),
            stdio: ["ignore", "pipe", "pipe"],
            env: {
                PATH: process.env.PATH ?? "",
                HOME: process.env.HOME ?? "",
                PARENT_PID: String(process.pid),
                INTERNAL_SERVICE_TOKEN: token,
                ...this.config.env(),
            },
        });
        this.child = child;
        const forward = (chunk: Buffer) => {
            for (const line of chunk.toString().split("\n")) if (line.trim()) console.log(line.startsWith(this.config.tag) ? line : `${this.config.tag} ${line}`);
        };
        child.stdout?.on("data", forward);
        child.stderr?.on("data", forward);
        child.on("exit", (code, signal) => {
            if (this.child === child) this.child = null;
            if (this.status !== "disabled") this.fail(`Service exited (${signal ?? code}).`);
        });
        child.on("error", () => this.fail("Could not start the Python service."));

        return this.waitUntilReady();
    }

    /** Poll the service until it reports ready (first launch may download models). */
    private async waitUntilReady() {
        const deadline = Date.now() + (this.config.readyTimeoutMs ?? 10 * 60_000);
        while (this.status === "starting" && Date.now() < deadline) {
            try {
                const response = await fetchBuffered(`${this.endpoint!.url}/health`, {
                    headers: { "x-internal-token": this.endpoint!.token },
                    signal: AbortSignal.timeout(3000),
                });
                if (response.ok) {
                    const body = (await response.json()) as { ready: boolean; error: string | null };
                    if (body.ready) {
                        this.status = "ready";
                        console.log(`${this.config.name} ready.`);
                        return;
                    }
                    if (body.error) return this.fail(`It could not load its model (${body.error}).`);
                } else if (response.status === 401) {
                    return this.fail("The service rejected our token.");
                }
            } catch {
                // Not listening yet.
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        if (this.status === "starting") this.fail("Timed out waiting for it to become ready.");
    }

    private fail(reason: string) {
        this.status = "unavailable";
        this.reason = reason;
        console.warn(`${this.config.name} unavailable: ${reason}`);
        if (this.child && this.child.exitCode === null) this.child.kill("SIGTERM");
    }
}

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            const port = typeof address === "object" && address ? address.port : 0;
            server.close(() => resolve(port));
        });
    });
}
