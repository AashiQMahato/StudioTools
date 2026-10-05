import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
import { ConcurrencyLimiter } from "../../utils/concurrency.js";
import { removeWorkspace, type Workspace } from "../files/workspace.js";

export type JobStatus = "queued" | "processing" | "completed" | "failed";

/** A finished file. Its path stays on the server; clients only ever see the id, name and size. */
export interface JobFile {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    path: string;
    /** Pages, for PDFs. */
    pages?: number;
}

export interface JobProgress {
    /** What's happening now, as a short machine-readable step ("reading", "merging", "rendering"…). */
    step: string;
    done: number;
    total: number;
}

interface Job {
    id: string;
    operation: string;
    status: JobStatus;
    progress: JobProgress;
    files: JobFile[];
    /** Extra facts about the result (e.g. how many pages it has). Never paths. */
    summary: Record<string, unknown>;
    error: { code: string; message: string } | null;
    workspace: Workspace;
    controller: AbortController;
    createdAt: number;
    /** When the job and its files are deleted. */
    expiresAt: number;
}

/** What a job's work gets: where to write, how to report progress, and when to stop. */
export interface JobContext {
    workspace: Workspace;
    signal: AbortSignal;
    progress: (step: string, done?: number, total?: number) => void;
    /** Adds a finished file to the job's results. */
    addFile: (file: Omit<JobFile, "id" | "size">) => Promise<JobFile>;
    summary: (facts: Record<string, unknown>) => void;
}

const jobs = new Map<string, Job>();
const limiter = new ConcurrencyLimiter(env.documents.concurrency, env.maxQueuedJobs * 4);
const ttl = () => env.documents.resultTtlMinutes * 60_000;

/**
 * Starts work in the background and returns at once: the client follows it with GET /api/jobs/:id.
 * Every job owns its workspace, which is deleted when the job expires (or is cancelled).
 */
export function startJob(operation: string, workspace: Workspace, work: (context: JobContext) => Promise<void>) {
    const job: Job = {
        id: randomUUID(),
        operation,
        status: "queued",
        progress: { step: "queued", done: 0, total: 0 },
        files: [],
        summary: {},
        error: null,
        workspace,
        controller: new AbortController(),
        createdAt: Date.now(),
        expiresAt: Date.now() + ttl(),
    };
    jobs.set(job.id, job);

    const context: JobContext = {
        workspace,
        signal: job.controller.signal,
        progress: (step, done = 0, total = 0) => {
            job.progress = { step, done, total };
        },
        addFile: async (file) => {
            const { size } = await stat(file.path);
            const added = { ...file, id: randomUUID(), size };
            job.files.push(added);
            return added;
        },
        summary: (facts) => {
            job.summary = { ...job.summary, ...facts };
        },
    };

    void limiter
        .run(async () => {
            job.status = "processing";
            job.progress = { step: "starting", done: 0, total: 0 };
            await work(context);
        }, job.controller.signal)
        .then(() => {
            job.status = "completed";
            job.progress = { ...job.progress, step: "completed" };
        })
        .catch((error: unknown) => {
            job.status = "failed";
            job.files = [];
            if (error instanceof AppError) job.error = { code: error.code, message: error.message };
            else {
                // Details stay in the server log; the client gets a safe, general message.
                if (!job.controller.signal.aborted) console.error(`[jobs] ${operation} failed`, error);
                job.error = { code: "PROCESSING_FAILED", message: "Processing failed. Please try again." };
            }
        })
        .finally(() => {
            job.expiresAt = Date.now() + ttl();
            // A failed job has nothing worth keeping.
            if (job.status === "failed") void removeWorkspace(job.workspace.dir);
        });
    return job.id;
}

function find(id: string): Job {
    const job = jobs.get(id);
    if (!job) throw new AppError("This result has expired or doesn't exist. Please run the tool again.", 404, "JOB_EXPIRED");
    return job;
}

/** A job as the client sees it: status, progress, result files (ids, names, sizes) and error — no paths. */
export function describeJob(id: string) {
    const job = find(id);
    return {
        id: job.id,
        operation: job.operation,
        status: job.status,
        progress: job.progress,
        files: job.files.map(({ id: fileId, name, mimeType, size, pages }) => ({ id: fileId, name, mimeType, size, ...(pages ? { pages } : {}) })),
        summary: job.summary,
        error: job.error,
        expiresAt: new Date(job.expiresAt).toISOString(),
    };
}

export function jobFile(id: string, fileId: string): JobFile {
    const job = find(id);
    if (job.status !== "completed") throw new AppError("This result isn't ready yet.", 409, "INVALID_REQUEST");
    const file = job.files.find((candidate) => candidate.id === fileId);
    if (!file) throw new AppError("This file doesn't exist.", 404, "NOT_FOUND");
    return file;
}

export function jobFiles(id: string): JobFile[] {
    const job = find(id);
    if (job.status !== "completed") throw new AppError("This result isn't ready yet.", 409, "INVALID_REQUEST");
    return job.files;
}

/** Stops a job (if running) and deletes it with its files at once. */
export async function deleteJob(id: string) {
    const job = jobs.get(id);
    if (!job) return;
    job.controller.abort();
    jobs.delete(id);
    await removeWorkspace(job.workspace.dir);
}

/** Expired jobs go, files and all. */
function sweep() {
    const now = Date.now();
    for (const job of jobs.values()) {
        if (job.status !== "queued" && job.status !== "processing" && job.expiresAt <= now) void deleteJob(job.id);
    }
}
setInterval(sweep, 60_000).unref();

/** Everything deleted — on shutdown. */
export async function deleteAllJobs() {
    await Promise.all([...jobs.keys()].map(deleteJob));
}
