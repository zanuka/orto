import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { ortoDir } from "../config/paths.js";
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from "../utils/fs.js";

export const DEFAULT_QUEUE_MAX_WAIT_MS = 45 * 60 * 1000;

export const StoreQueueJobSourceSchema = z.enum([
  "propose-from-paths",
  "watcher",
  "manual",
]);

export type StoreQueueJobSource = z.infer<typeof StoreQueueJobSourceSchema>;

export const StoreQueueJobStatusSchema = z.enum(["pending", "failed"]);

export type StoreQueueJobStatus = z.infer<typeof StoreQueueJobStatusSchema>;

export const StoreQueueJobSchema = z.object({
  id: z.string(),
  bankId: z.string(),
  paths: z.array(z.string()).min(1),
  source: StoreQueueJobSourceSchema,
  status: StoreQueueJobStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  confirmedAt: z.string(),
  dryRun: z.boolean().default(false),
  force: z.boolean().default(false),
  async: z.boolean().default(false),
  judge: z.string().optional(),
  confidence: z.number().optional(),
  strict: z.boolean().optional(),
  attempts: z.number().int().nonnegative().default(0),
  lastError: z.string().optional(),
});

export type StoreQueueJob = z.infer<typeof StoreQueueJobSchema>;

export const StoreQueueSchema = z.object({
  version: z.literal(1),
  bankId: z.string(),
  updatedAt: z.string(),
  jobs: z.array(StoreQueueJobSchema),
});

export type StoreQueue = z.infer<typeof StoreQueueSchema>;

export interface EnqueueStoreJobInput {
  bankId: string;
  paths: readonly string[];
  source: StoreQueueJobSource;
  dryRun?: boolean;
  force?: boolean;
  async?: boolean;
  judge?: string;
  confidence?: number;
  strict?: boolean;
  now?: string;
}

export interface EnqueueStoreJobResult {
  queue: StoreQueue;
  job: StoreQueueJob;
  coalesced: boolean;
}

export function storeQueuePath(projectRoot: string): string {
  return join(ortoDir(projectRoot), "local", "store-queue.json");
}

export function createEmptyStoreQueue(bankId: string, now?: string): StoreQueue {
  return {
    version: 1,
    bankId,
    updatedAt: now ?? new Date().toISOString(),
    jobs: [],
  };
}

export async function loadStoreQueue(
  projectRoot: string,
): Promise<StoreQueue | undefined> {
  const path = storeQueuePath(projectRoot);
  if (!(await pathExists(path))) {
    return undefined;
  }
  const raw = await readJsonFile<unknown>(path);
  const parsed = StoreQueueSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export async function saveStoreQueue(
  projectRoot: string,
  queue: StoreQueue,
): Promise<void> {
  const path = storeQueuePath(projectRoot);
  await ensureDir(join(ortoDir(projectRoot), "local"));
  await writeJsonFile(path, queue, false);
}

function normalizePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const trimmed = raw.trim();
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out.sort();
}

function hasPathOverlap(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return b.some((item) => set.has(item));
}

export function enqueueStoreJob(
  existing: StoreQueue | undefined,
  input: EnqueueStoreJobInput,
): EnqueueStoreJobResult {
  const now = input.now ?? new Date().toISOString();
  const normalizedPaths = normalizePaths(input.paths);
  const base = existing ?? createEmptyStoreQueue(input.bankId, now);
  const dryRun = input.dryRun ?? false;
  const force = input.force ?? false;
  const asyncMode = input.async ?? false;

  const matchIndex = base.jobs.findIndex(
    (job) =>
      job.bankId === input.bankId &&
      job.dryRun === dryRun &&
      hasPathOverlap(job.paths, normalizedPaths),
  );

  if (matchIndex >= 0) {
    const current = base.jobs[matchIndex]!;
    const mergedPaths = normalizePaths([...current.paths, ...normalizedPaths]);
    const updated: StoreQueueJob = {
      ...current,
      paths: mergedPaths,
      status: "pending",
      updatedAt: now,
      confirmedAt: now,
      force: current.force || force,
      async: current.async || asyncMode,
      ...(input.judge !== undefined ? { judge: input.judge } : {}),
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      ...(input.strict !== undefined ? { strict: input.strict } : {}),
    };
    delete updated.lastError;
    const jobs = base.jobs.map((job, idx) => (idx === matchIndex ? updated : job));
    return {
      queue: {
        ...base,
        updatedAt: now,
        jobs,
      },
      job: updated,
      coalesced: true,
    };
  }

  const job: StoreQueueJob = {
    id: randomUUID(),
    bankId: input.bankId,
    paths: normalizedPaths,
    source: input.source,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    confirmedAt: now,
    dryRun,
    force,
    async: asyncMode,
    ...(input.judge !== undefined ? { judge: input.judge } : {}),
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    ...(input.strict !== undefined ? { strict: input.strict } : {}),
    attempts: 0,
  };

  return {
    queue: {
      ...base,
      updatedAt: now,
      jobs: [...base.jobs, job],
    },
    job,
    coalesced: false,
  };
}

export function removeQueueJob(
  queue: StoreQueue,
  jobId: string,
  now?: string,
): StoreQueue {
  return {
    ...queue,
    updatedAt: now ?? new Date().toISOString(),
    jobs: queue.jobs.filter((job) => job.id !== jobId),
  };
}

export function markQueueJobFailed(
  queue: StoreQueue,
  jobId: string,
  errorMessage: string,
  now?: string,
): StoreQueue {
  const timestamp = now ?? new Date().toISOString();
  return {
    ...queue,
    updatedAt: timestamp,
    jobs: queue.jobs.map((job) =>
      job.id === jobId
        ? {
            ...job,
            status: "failed",
            attempts: job.attempts + 1,
            updatedAt: timestamp,
            lastError: errorMessage,
          }
        : job,
    ),
  };
}

export function orderedDrainJobs(queue: StoreQueue): StoreQueueJob[] {
  return [...queue.jobs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function jobAgeMs(job: StoreQueueJob, nowMs = Date.now()): number {
  const createdMs = Date.parse(job.createdAt);
  if (!Number.isFinite(createdMs)) {
    return 0;
  }
  return Math.max(0, nowMs - createdMs);
}

export function isJobAgedPastMaxWait(
  job: StoreQueueJob,
  nowMs = Date.now(),
  maxWaitMs = DEFAULT_QUEUE_MAX_WAIT_MS,
): boolean {
  return jobAgeMs(job, nowMs) >= maxWaitMs;
}

export function formatAgeMinutes(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) {
    return "<1m";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

export interface QueueStatusSummary {
  total: number;
  pending: number;
  failed: number;
  oldestAgeMs: number;
  agedPastMaxWait: boolean;
}

export function summarizeStoreQueue(
  queue: StoreQueue | undefined,
  nowMs = Date.now(),
  maxWaitMs = DEFAULT_QUEUE_MAX_WAIT_MS,
): QueueStatusSummary {
  if (!queue || queue.jobs.length === 0) {
    return {
      total: 0,
      pending: 0,
      failed: 0,
      oldestAgeMs: 0,
      agedPastMaxWait: false,
    };
  }
  let pending = 0;
  let failed = 0;
  let oldestAgeMs = 0;
  for (const job of queue.jobs) {
    if (job.status === "failed") {
      failed += 1;
    } else {
      pending += 1;
    }
    const age = jobAgeMs(job, nowMs);
    if (age > oldestAgeMs) {
      oldestAgeMs = age;
    }
  }
  return {
    total: queue.jobs.length,
    pending,
    failed,
    oldestAgeMs,
    agedPastMaxWait: oldestAgeMs >= maxWaitMs,
  };
}
