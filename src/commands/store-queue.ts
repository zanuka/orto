import { basename, isAbsolute, resolve } from "node:path";
import { loadConfig, loadShareConfig } from "../config/load.js";
import {
  assertApiKeyForConnection,
  resolveProjectConnection,
} from "../config/connection.js";
import {
  HindsightClient,
  resolveHindsightApiKey,
  type BankOperationSummary,
} from "../providers/hindsight/client.js";
import {
  checkStoreDeny,
  relativeToProjectRoot,
} from "../scanner/store-policy.js";
import {
  evaluateQuietPolicy,
  type BankOperationsSnapshot,
  type QuietPolicyConfig,
  type QuietPolicyResult,
} from "../seeder/quiet-policy.js";
import {
  DEFAULT_QUEUE_MAX_WAIT_MS,
  enqueueStoreJob,
  formatAgeMinutes,
  isJobAgedPastMaxWait,
  jobAgeMs,
  loadStoreQueue,
  markQueueJobFailed,
  orderedDrainJobs,
  removeQueueJob,
  saveStoreQueue,
  storeQueuePath,
  type StoreQueueJob,
} from "../seeder/store-queue.js";
import { OrtoError } from "../utils/errors.js";
import { runStore, type StoreOptions, type StoreResult } from "./store.js";

export interface ProposeFromPathsResult {
  projectRoot: string;
  bankId: string;
  allowlisted: string[];
  unlisted: string[];
  denied: Array<{ path: string; reason: string }>;
  enqueuedJob?: StoreQueueJob;
  coalesced?: boolean;
  storeResult?: StoreResult;
  dryRun: boolean;
}

export interface DrainQueueResult {
  projectRoot: string;
  bankId: string;
  dryRun: boolean;
  forcedNow: boolean;
  quietPolicy?: QuietPolicyResult;
  drained: number;
  failed: number;
  remaining: number;
}

function parsePathList(raw: string): string[] {
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export async function runProposeFromPaths(input: {
  projectRoot: string;
  rawPaths: string;
  options: StoreOptions;
}): Promise<ProposeFromPathsResult> {
  const config = await loadConfig(input.projectRoot);
  const allowlist = new Set(config.store?.allowlist ?? []);
  const dryRun = input.options.dryRun ?? false;
  const enqueue = input.options.enqueue ?? false;
  const nowFlag = input.options.now ?? false;

  if (enqueue && nowFlag) {
    throw new OrtoError(
      "Cannot combine --enqueue and --now.",
      "Choose --enqueue to queue until quiet, or --now to store immediately.",
    );
  }

  const rawList = parsePathList(input.rawPaths);
  const allowlisted: string[] = [];
  const unlisted: string[] = [];
  const denied: Array<{ path: string; reason: string }> = [];
  const seen = new Set<string>();

  for (const raw of rawList) {
    const abs = isAbsolute(raw) ? raw : resolve(input.projectRoot, raw);
    const rel = relativeToProjectRoot(input.projectRoot, abs);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
      denied.push({ path: raw, reason: "outside project root" });
      continue;
    }
    if (seen.has(rel)) {
      continue;
    }
    seen.add(rel);
    const denyCheck = checkStoreDeny(rel, input.projectRoot);
    if (denyCheck.denied) {
      denied.push({ path: rel, reason: denyCheck.reason ?? "denied by store policy" });
      continue;
    }
    if (allowlist.has(rel)) {
      allowlisted.push(rel);
    } else {
      unlisted.push(rel);
    }
  }

  if (enqueue && !dryRun && allowlisted.length > 0) {
    const existing = await loadStoreQueue(input.projectRoot);
    const enqueued = enqueueStoreJob(existing, {
      bankId: config.bankId,
      paths: allowlisted,
      source: "propose-from-paths",
      dryRun: false,
      force: input.options.force ?? false,
      async: input.options.async ?? false,
      ...(input.options.judge !== undefined ? { judge: input.options.judge } : {}),
      ...(input.options.confidence !== undefined
        ? { confidence: input.options.confidence }
        : {}),
      ...(input.options.strict !== undefined ? { strict: input.options.strict } : {}),
    });
    await saveStoreQueue(input.projectRoot, enqueued.queue);
    return {
      projectRoot: input.projectRoot,
      bankId: config.bankId,
      allowlisted,
      unlisted,
      denied,
      enqueuedJob: enqueued.job,
      coalesced: enqueued.coalesced,
      dryRun,
    };
  }

  if (nowFlag && !dryRun && allowlisted.length > 0) {
    const { proposeFromPaths: _p, ...restOptions } = input.options;
    const storeResult = await runStore({
      ...restOptions,
      project: input.projectRoot,
      files: allowlisted.join(","),
      yes: true,
      enqueue: false,
      now: false,
    });
    return {
      projectRoot: input.projectRoot,
      bankId: config.bankId,
      allowlisted,
      unlisted,
      denied,
      storeResult,
      dryRun,
    };
  }

  return {
    projectRoot: input.projectRoot,
    bankId: config.bankId,
    allowlisted,
    unlisted,
    denied,
    dryRun,
  };
}

export function printProposeFromPathsResult(result: ProposeFromPathsResult): void {
  const prefix = result.dryRun ? "[dry-run] " : "";
  console.log(`${prefix}Store proposal for bank "${result.bankId}"`);
  console.log(`${prefix}Project root: ${result.projectRoot}`);

  if (result.allowlisted.length > 0) {
    console.log("");
    console.log(`${prefix}Ready to sync (in store.allowlist):`);
    for (const p of result.allowlisted) {
      console.log(`  ${p}`);
    }
  } else {
    console.log("");
    console.log(`${prefix}No allowlisted paths matched.`);
  }

  if (result.unlisted.length > 0) {
    console.log("");
    console.log(`${prefix}Not in store.allowlist (skipped; never adopted silently):`);
    for (const p of result.unlisted) {
      console.log(`  ${p}`);
    }
    console.log(
      `Next: \`orto store --propose-adopt --judge jev\` or \`orto store --add-files ${result.unlisted.join(",")}\``,
    );
  }

  if (result.denied.length > 0) {
    console.log("");
    console.log(`${prefix}Denied by security policy:`);
    for (const item of result.denied) {
      console.log(`  ${item.path} (${item.reason})`);
    }
  }

  if (result.enqueuedJob) {
    console.log("");
    console.log(
      result.coalesced
        ? `Coalesced into pending store job ${result.enqueuedJob.id} (${result.enqueuedJob.paths.length} path(s)).`
        : `Queued store job ${result.enqueuedJob.id} (${result.enqueuedJob.paths.length} path(s)).`,
    );
    console.log(`Queue file: ${storeQueuePath(result.projectRoot)}`);
    console.log("Next: `orto store --drain-queue` (waits for quiet Hindsight) or `orto store --drain-queue --now`");
    return;
  }

  if (result.storeResult) {
    return;
  }

  if (result.allowlisted.length > 0) {
    const joined = result.allowlisted.join(",");
    console.log("");
    console.log(`${prefix}No memories were retained. Confirm with:`);
    console.log(`  Queue until quiet: orto store --propose-from-paths ${joined} --enqueue`);
    console.log(`  Run immediately:   orto store --propose-from-paths ${joined} --now`);
  }
}

export async function runShowStoreQueue(input: {
  projectRoot: string;
  nowMs?: number;
  maxWaitMs?: number;
}): Promise<StoreQueueJob[]> {
  const queue = await loadStoreQueue(input.projectRoot);
  const nowMs = input.nowMs ?? Date.now();
  const maxWaitMs = input.maxWaitMs ?? DEFAULT_QUEUE_MAX_WAIT_MS;

  if (!queue || queue.jobs.length === 0) {
    console.log("Store queue is empty.");
    return [];
  }

  const jobs = orderedDrainJobs(queue);
  console.log(`Store queue for bank "${queue.bankId}" (${jobs.length} job(s)):`);
  for (const job of jobs) {
    const age = formatAgeMinutes(jobAgeMs(job, nowMs));
    const aged = isJobAgedPastMaxWait(job, nowMs, maxWaitMs);
    const suffix = [
      `status=${job.status}`,
      `age=${age}`,
      `source=${job.source}`,
      ...(job.judge ? [`judge=${job.judge}`] : []),
      ...(job.dryRun ? ["dry-run"] : []),
      ...(aged ? ["AGED"] : []),
    ].join(" ");
    console.log(`  ${job.id} [${suffix}]`);
    console.log(`    paths: ${job.paths.join(", ")}`);
    if (job.lastError) {
      console.log(`    last error: ${job.lastError}`);
    }
  }

  if (jobs.some((job) => isJobAgedPastMaxWait(job, nowMs, maxWaitMs))) {
    console.log("");
    console.log(
      "One or more jobs have waited past the quiet window. Run `orto store --drain-queue --now` to force, or wait for Hindsight to settle.",
    );
  } else {
    console.log("");
    console.log(
      "Next: `orto store --drain-queue` (checks quiet policy) or `orto store --drain-queue --now`.",
    );
  }

  return jobs;
}

export async function runDrainStoreQueue(input: {
  projectRoot: string;
  options: StoreOptions;
  listOperations?: (bankId: string) => Promise<BankOperationSummary[]>;
  quietPolicyConfig?: Partial<QuietPolicyConfig>;
  nowMs?: number;
}): Promise<DrainQueueResult> {
  const config = await loadConfig(input.projectRoot);
  const share = await loadShareConfig(input.projectRoot);
  const dryRun = input.options.dryRun ?? false;
  const forcedNow = input.options.now ?? false;

  const existing = await loadStoreQueue(input.projectRoot);
  if (!existing || existing.jobs.length === 0) {
    return {
      projectRoot: input.projectRoot,
      bankId: config.bankId,
      dryRun,
      forcedNow,
      drained: 0,
      failed: 0,
      remaining: 0,
    };
  }

  let quietPolicy: QuietPolicyResult | undefined;
  if (!forcedNow) {
    const connection = resolveProjectConnection({
      config,
      share,
      ...(input.options.hindsightUrl !== undefined
        ? { cliUrl: input.options.hindsightUrl }
        : {}),
    });
    const apiKey = resolveHindsightApiKey({
      ...(input.options.apiKey !== undefined ? { cliKey: input.options.apiKey } : {}),
    });
    assertApiKeyForConnection({ connection, ...(apiKey ? { apiKey } : {}) });

    const client = new HindsightClient({
      baseUrl: connection.baseUrl,
      ...(apiKey !== undefined ? { apiKey } : {}),
    });
    const listOps =
      input.listOperations ?? ((bankId: string) => client.listOperations(bankId));

    const banksToCheck = [config.bankId];
    const codingAgentBank =
      input.options.codingAgentBank ?? `coding-agent::${basename(input.projectRoot)}`;
    if (!banksToCheck.includes(codingAgentBank)) {
      banksToCheck.push(codingAgentBank);
    }

    const snapshots: BankOperationsSnapshot[] = [];
    for (const bankId of banksToCheck) {
      const operations = await listOps(bankId);
      snapshots.push({ bankId, operations });
    }

    quietPolicy = evaluateQuietPolicy({
      snapshots,
      ...(input.quietPolicyConfig ? { config: input.quietPolicyConfig } : {}),
      ...(input.nowMs !== undefined ? { nowMs: input.nowMs } : {}),
    });

    if (!quietPolicy.quiet) {
      return {
        projectRoot: input.projectRoot,
        bankId: config.bankId,
        dryRun,
        forcedNow,
        quietPolicy,
        drained: 0,
        failed: 0,
        remaining: existing.jobs.length,
      };
    }
  }

  if (dryRun) {
    return {
      projectRoot: input.projectRoot,
      bankId: config.bankId,
      dryRun: true,
      forcedNow,
      ...(quietPolicy ? { quietPolicy } : {}),
      drained: existing.jobs.length,
      failed: 0,
      remaining: existing.jobs.length,
    };
  }

  let queue = existing;
  let drained = 0;
  let failed = 0;

  for (const job of orderedDrainJobs(existing)) {
    try {
      const { proposeFromPaths: _p, ...restOptions } = input.options;
      await runStore({
        ...restOptions,
        project: input.projectRoot,
        files: job.paths.join(","),
        yes: true,
        dryRun: job.dryRun,
        force: job.force || Boolean(input.options.force),
        async: job.async || Boolean(input.options.async),
        ...(job.judge !== undefined ? { judge: job.judge } : {}),
        ...(job.confidence !== undefined ? { confidence: job.confidence } : {}),
        ...(job.strict !== undefined ? { strict: job.strict } : {}),
        enqueue: false,
        now: false,
        queue: false,
        drainQueue: false,
      });
      queue = removeQueueJob(queue, job.id);
      drained += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      queue = markQueueJobFailed(queue, job.id, message);
      failed += 1;
    }
    await saveStoreQueue(input.projectRoot, queue);
  }

  return {
    projectRoot: input.projectRoot,
    bankId: config.bankId,
    dryRun: false,
    forcedNow,
    ...(quietPolicy ? { quietPolicy } : {}),
    drained,
    failed,
    remaining: queue.jobs.length,
  };
}

export function printDrainQueueResult(result: DrainQueueResult): void {
  const prefix = result.dryRun ? "[dry-run] " : "";
  if (result.drained === 0 && result.failed === 0 && result.remaining === 0) {
    console.log(`${prefix}Store queue is empty.`);
    return;
  }

  if (result.quietPolicy && !result.quietPolicy.quiet) {
    console.log(`${prefix}Hindsight is busy; leaving ${result.remaining} job(s) queued:`);
    for (const reason of result.quietPolicy.reasons) {
      console.log(`  - ${reason}`);
    }
    console.log(
      `${prefix}Re-run \`orto store --drain-queue\` later, or pass \`--now\` to bypass quiet checks.`,
    );
    return;
  }

  if (result.dryRun) {
    console.log(
      `${prefix}Quiet policy passed. Would drain ${result.drained} queued store job(s) for bank "${result.bankId}".`,
    );
    return;
  }

  console.log(
    `Drained ${result.drained} store job(s) (failed: ${result.failed}, remaining: ${result.remaining}).`,
  );
}
