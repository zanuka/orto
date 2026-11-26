import type { WatcherGateDecision } from "../judge/watcher-gate.js";
import {
  enqueueStoreJob,
  loadStoreQueue,
  saveStoreQueue,
  type EnqueueStoreJobResult,
} from "../seeder/store-queue.js";

export interface WatcherSeedEnqueue {
  paths: string[];
  decisions: WatcherGateDecision[];
}

export function collectSeedEnqueue(
  decisions: readonly WatcherGateDecision[],
): WatcherSeedEnqueue | undefined {
  const enqueued = decisions.filter((decision) => decision.verdict === "enqueue");
  if (enqueued.length === 0) {
    return undefined;
  }
  return {
    paths: enqueued.map((decision) => decision.path),
    decisions: [...enqueued],
  };
}

export async function enqueueWatcherDecisions(input: {
  projectRoot: string;
  bankId: string;
  decisions: readonly WatcherGateDecision[];
  dryRun?: boolean;
  judge?: string;
  confidence?: number;
  strict?: boolean;
  now?: string;
}): Promise<EnqueueStoreJobResult | undefined> {
  const collected = collectSeedEnqueue(input.decisions);
  if (!collected) {
    return undefined;
  }
  const existing = await loadStoreQueue(input.projectRoot);
  const result = enqueueStoreJob(existing, {
    bankId: input.bankId,
    paths: collected.paths,
    source: "watcher",
    ...(input.dryRun !== undefined ? { dryRun: input.dryRun } : {}),
    ...(input.judge !== undefined ? { judge: input.judge } : {}),
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    ...(input.strict !== undefined ? { strict: input.strict } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  });
  await saveStoreQueue(input.projectRoot, result.queue);
  return result;
}
