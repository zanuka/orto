import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_QUEUE_MAX_WAIT_MS,
  enqueueStoreJob,
  isJobAgedPastMaxWait,
  loadStoreQueue,
  markQueueJobFailed,
  orderedDrainJobs,
  removeQueueJob,
  saveStoreQueue,
  summarizeStoreQueue,
} from "./store-queue.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("store-queue", () => {
  it("enqueues and coalesces overlapping paths into one job", () => {
    const first = enqueueStoreJob(undefined, {
      bankId: "orto",
      paths: ["docs/adr/0001.md"],
      source: "propose-from-paths",
      now: "2026-11-26T10:00:00.000Z",
    });
    expect(first.coalesced).toBe(false);
    expect(first.queue.jobs).toHaveLength(1);
    expect(first.job.paths).toEqual(["docs/adr/0001.md"]);

    const second = enqueueStoreJob(first.queue, {
      bankId: "orto",
      paths: ["docs/adr/0001.md", "AGENTS.md"],
      source: "propose-from-paths",
      now: "2026-11-26T10:05:00.000Z",
    });
    expect(second.coalesced).toBe(true);
    expect(second.queue.jobs).toHaveLength(1);
    expect(second.job.paths).toEqual(["AGENTS.md", "docs/adr/0001.md"]);
    expect(second.job.confirmedAt).toBe("2026-11-26T10:05:00.000Z");
  });

  it("keeps disjoint path jobs separate and orders FIFO", () => {
    const first = enqueueStoreJob(undefined, {
      bankId: "orto",
      paths: ["docs/a.md"],
      source: "propose-from-paths",
      now: "2026-11-26T10:00:00.000Z",
    });
    const second = enqueueStoreJob(first.queue, {
      bankId: "orto",
      paths: ["docs/b.md"],
      source: "watcher",
      now: "2026-11-26T10:02:00.000Z",
    });
    expect(second.coalesced).toBe(false);
    expect(second.queue.jobs).toHaveLength(2);
    const ordered = orderedDrainJobs(second.queue);
    expect(ordered.map((j) => j.paths[0])).toEqual(["docs/a.md", "docs/b.md"]);
  });

  it("marks failed jobs retryable and removes completed jobs", () => {
    const enqueued = enqueueStoreJob(undefined, {
      bankId: "orto",
      paths: ["README.md"],
      source: "manual",
      now: "2026-11-26T10:00:00.000Z",
    });
    const failed = markQueueJobFailed(
      enqueued.queue,
      enqueued.job.id,
      "Hindsight timeout",
      "2026-11-26T10:01:00.000Z",
    );
    expect(failed.jobs[0]?.status).toBe("failed");
    expect(failed.jobs[0]?.attempts).toBe(1);
    expect(failed.jobs[0]?.lastError).toBe("Hindsight timeout");

    const removed = removeQueueJob(failed, enqueued.job.id);
    expect(removed.jobs).toHaveLength(0);
  });

  it("detects jobs aged past max wait and summarizes queue", () => {
    const createdMs = Date.parse("2026-11-26T10:00:00.000Z");
    const enqueued = enqueueStoreJob(undefined, {
      bankId: "orto",
      paths: ["README.md"],
      source: "propose-from-paths",
      now: "2026-11-26T10:00:00.000Z",
    });
    expect(
      isJobAgedPastMaxWait(enqueued.job, createdMs + 10 * 60 * 1000),
    ).toBe(false);
    expect(
      isJobAgedPastMaxWait(
        enqueued.job,
        createdMs + DEFAULT_QUEUE_MAX_WAIT_MS + 1000,
      ),
    ).toBe(true);

    const summary = summarizeStoreQueue(
      enqueued.queue,
      createdMs + DEFAULT_QUEUE_MAX_WAIT_MS + 1000,
    );
    expect(summary.total).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.agedPastMaxWait).toBe(true);
  });

  it("persists and reloads queue under .orto/local/store-queue.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "orto-queue-"));
    tempDirs.push(root);
    const enqueued = enqueueStoreJob(undefined, {
      bankId: "orto",
      paths: ["docs/adr/0001.md"],
      source: "propose-from-paths",
      judge: "jev",
    });
    await saveStoreQueue(root, enqueued.queue);
    const loaded = await loadStoreQueue(root);
    expect(loaded?.jobs).toHaveLength(1);
    expect(loaded?.jobs[0]?.judge).toBe("jev");
  });
});
