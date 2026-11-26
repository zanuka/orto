import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../config/schema.js";
import { loadStoreQueue } from "../seeder/store-queue.js";
import { enqueueWatcherDecisions } from "../watcher/enqueue.js";
import { runDrainStoreQueue, runProposeFromPaths } from "./store-queue.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function setupFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "orto-store-queue-"));
  tempDirs.push(root);
  await mkdir(join(root, ".orto"), { recursive: true });
  await mkdir(join(root, "docs", "adr"), { recursive: true });
  const config = createDefaultConfig({
    name: "fixture",
    bankId: "fixture-bank",
  });
  config.store = { allowlist: ["docs/adr/0001.md"] };
  await writeFile(join(root, ".orto", "config.json"), JSON.stringify(config));
  await writeFile(
    join(root, "docs", "adr", "0001.md"),
    "# ADR 0001\n\n## Decision\n\nKeep local control.\n",
  );
  await writeFile(join(root, "docs", "unlisted.md"), "# Unlisted\n");
  await writeFile(join(root, ".env"), "SECRET=123\n");
  return root;
}

describe("store-queue commands", () => {
  it("classifies allowlisted, unlisted, and denied paths without mutating on proposal", async () => {
    const root = await setupFixture();
    const result = await runProposeFromPaths({
      projectRoot: root,
      rawPaths: "docs/adr/0001.md,docs/unlisted.md,.env",
      options: { dryRun: true },
    });
    expect(result.allowlisted).toEqual(["docs/adr/0001.md"]);
    expect(result.unlisted).toEqual(["docs/unlisted.md"]);
    expect(result.denied).toHaveLength(1);
    expect(result.denied[0]?.path).toBe(".env");
    expect(await loadStoreQueue(root)).toBeUndefined();
  });

  it("enqueues confirmed allowlisted paths without calling Hindsight", async () => {
    const root = await setupFixture();
    const result = await runProposeFromPaths({
      projectRoot: root,
      rawPaths: "docs/adr/0001.md,docs/unlisted.md",
      options: { enqueue: true, judge: "jev" },
    });
    expect(result.enqueuedJob?.paths).toEqual(["docs/adr/0001.md"]);
    expect(result.enqueuedJob?.judge).toBe("jev");
    const loaded = await loadStoreQueue(root);
    expect(loaded?.jobs).toHaveLength(1);
  });

  it("leaves queue intact when quiet policy reports coding-agent busy", async () => {
    const root = await setupFixture();
    await runProposeFromPaths({
      projectRoot: root,
      rawPaths: "docs/adr/0001.md",
      options: { enqueue: true },
    });

    const drain = await runDrainStoreQueue({
      projectRoot: root,
      options: { drainQueue: true },
      listOperations: async (bankId) =>
        bankId.startsWith("coding-agent::")
          ? [{ id: "op-1", status: "pending", operation_type: "batch_retain" }]
          : [],
    });
    expect(drain.quietPolicy?.quiet).toBe(false);
    expect(drain.drained).toBe(0);
    expect(drain.remaining).toBe(1);
  });

  it("supports dry-run drain when Hindsight is quiet", async () => {
    const root = await setupFixture();
    await runProposeFromPaths({
      projectRoot: root,
      rawPaths: "docs/adr/0001.md",
      options: { enqueue: true },
    });

    const drain = await runDrainStoreQueue({
      projectRoot: root,
      options: { drainQueue: true, dryRun: true },
      listOperations: async () => [],
    });
    expect(drain.quietPolicy?.quiet).toBe(true);
    expect(drain.drained).toBe(1);
    expect(drain.remaining).toBe(1);
  });

  it("converges watcher gate decisions onto the same store queue", async () => {
    const root = await setupFixture();
    const enqueued = await enqueueWatcherDecisions({
      projectRoot: root,
      bankId: "fixture-bank",
      decisions: [
        {
          path: "docs/adr/0001.md",
          verdict: "enqueue",
          reason: "durable claim changed with high behavior delta",
        },
        {
          path: "docs/unlisted.md",
          verdict: "skip",
          reason: "durable claim unchanged",
        },
      ],
    });
    expect(enqueued?.job.source).toBe("watcher");
    expect(enqueued?.job.paths).toEqual(["docs/adr/0001.md"]);
    const loaded = await loadStoreQueue(root);
    expect(loaded?.jobs).toHaveLength(1);
  });
});
