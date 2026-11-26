import { join } from "node:path";
import { loadConfig, loadShareConfig } from "../config/load.js";
import {
  assertApiKeyForConnection,
  resolveProjectConnection,
} from "../config/connection.js";
import { bankTemplatePath } from "../config/paths.js";
import {
  clampDriftSample,
  createJudge,
  formatDriftLine,
  judgeAuditItem,
  summarizeDrift,
  type DriftSummary,
  type ResolvedJudge,
} from "../judge/index.js";
import { detectProjectRoot } from "../project/detect-root.js";
import {
  HindsightClient,
  resolveHindsightApiKey,
  type DocumentSummary,
} from "../providers/hindsight/client.js";
import type { HindsightBankTemplate } from "../providers/hindsight/types.js";
import { buildAuditItems } from "../seeder/audit-plan.js";
import { parseDocumentId } from "../seeder/prune-plan.js";
import {
  formatAgeMinutes,
  loadStoreQueue,
  summarizeStoreQueue,
  type QueueStatusSummary,
} from "../seeder/store-queue.js";
import { pathExists, readJsonFile } from "../utils/fs.js";

export interface StatusOptions {
  cwd?: string;
  dryRun?: boolean;
  sample?: number;
  hindsightUrl?: string;
  apiKey?: string;
  judge?: string;
  confidence?: number;
  strict?: boolean;
  resolvedJudge?: ResolvedJudge;
  documents?: readonly DocumentSummary[];
  listDocuments?: (bankId: string, limit: number) => Promise<DocumentSummary[]>;
  sampledAt?: string;
}

export interface StatusResult {
  projectRoot: string;
  bankId: string;
  baseUrl: string;
  dryRun: boolean;
  drift: DriftSummary;
  storeQueue: QueueStatusSummary;
}

export async function runStatus(options: StatusOptions = {}): Promise<StatusResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const sampleSize = clampDriftSample(options.sample);
  const sampledAt = options.sampledAt ?? new Date().toISOString();

  const projectRoot = await detectProjectRoot(cwd);
  const config = await loadConfig(projectRoot);
  const share = await loadShareConfig(projectRoot);
  const connection = resolveProjectConnection({
    config,
    share,
    ...(options.hindsightUrl !== undefined ? { cliUrl: options.hindsightUrl } : {}),
  });
  const apiKey = resolveHindsightApiKey({
    ...(options.apiKey !== undefined ? { cliKey: options.apiKey } : {}),
  });
  assertApiKeyForConnection({ connection, ...(apiKey ? { apiKey } : {}) });

  const documents = await loadSample({
    options,
    bankId: config.bankId,
    baseUrl: connection.baseUrl,
    sampleSize,
    ...(apiKey !== undefined ? { apiKey } : {}),
  });

  const useJev = options.resolvedJudge?.judgeId === "jev" || options.judge === "jev";
  const drift = useJev
    ? await jevDrift({
        projectRoot,
        documents,
        sampleSize,
        sampledAt,
        options,
      })
    : await hashDrift({
        projectRoot,
        documents,
        sampleSize,
        sampledAt,
      });

  const queue = await loadStoreQueue(projectRoot);
  const storeQueue = summarizeStoreQueue(queue);

  return {
    projectRoot,
    bankId: config.bankId,
    baseUrl: connection.baseUrl,
    dryRun,
    drift,
    storeQueue,
  };
}

export function printStatusResult(result: StatusResult): void {
  const prefix = result.dryRun ? "[dry-run] " : "";
  console.log(`${prefix}Bank drift for "${result.bankId}"`);
  console.log(`${prefix}${formatDriftLine(result.drift)}`);
  console.log(
    `${prefix}mode: ${result.drift.mode === "hash" ? "hash (source present vs missing)" : "jev (still_supported_by_repo)"}`,
  );
  if (result.storeQueue.total > 0) {
    const oldest = formatAgeMinutes(result.storeQueue.oldestAgeMs);
    const nudge = result.storeQueue.agedPastMaxWait
      ? " (aged past quiet window; run `orto store --drain-queue --now` or wait)"
      : "";
    console.log(
      `${prefix}store queue: ${result.storeQueue.pending} pending, ${result.storeQueue.failed} failed (oldest ${oldest})${nudge}`,
    );
  }
  console.log(`${prefix}Nothing was deleted or retained.`);
}

export async function runStatusCommand(options: StatusOptions = {}): Promise<void> {
  printStatusResult(await runStatus(options));
}

async function loadSample(input: {
  options: StatusOptions;
  bankId: string;
  baseUrl: string;
  sampleSize: number;
  apiKey?: string;
}): Promise<DocumentSummary[]> {
  if (input.options.documents !== undefined) {
    return input.options.documents.slice(0, input.sampleSize);
  }
  if (input.options.listDocuments !== undefined) {
    const listed = await input.options.listDocuments(input.bankId, input.sampleSize);
    return listed.slice(0, input.sampleSize);
  }
  const client = new HindsightClient({
    baseUrl: input.baseUrl,
    ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
  });
  const page = await client.listDocuments(input.bankId, {
    limit: input.sampleSize,
    offset: 0,
  });
  return page.items.slice(0, input.sampleSize);
}

async function hashDrift(input: {
  projectRoot: string;
  documents: readonly DocumentSummary[];
  sampleSize: number;
  sampledAt: string;
}): Promise<DriftSummary> {
  const samples = [];
  for (const document of input.documents) {
    samples.push({
      id: document.id,
      supported: await sourcePresent(input.projectRoot, document),
    });
  }
  return summarizeDrift({
    samples,
    sampledAt: input.sampledAt,
    mode: "hash",
    limit: input.sampleSize,
  });
}

async function jevDrift(input: {
  projectRoot: string;
  documents: readonly DocumentSummary[];
  sampleSize: number;
  sampledAt: string;
  options: StatusOptions;
}): Promise<DriftSummary> {
  const resolved =
    input.options.resolvedJudge ??
    createJudge({
      judge: "jev",
      ...(input.options.confidence !== undefined
        ? { confidence: input.options.confidence }
        : {}),
      ...(input.options.strict !== undefined ? { strict: input.options.strict } : {}),
    });
  const mission = await loadRetainMission(input.projectRoot);
  const items = await buildAuditItems({
    projectRoot: input.projectRoot,
    documents: input.documents,
    limit: input.sampleSize,
    ...(mission !== undefined ? { bankMission: mission } : {}),
  });
  const samples = [];
  for (const item of items) {
    const decision = await judgeAuditItem({
      item,
      judge: resolved.judge,
      confidence: resolved.confidence,
    });
    samples.push({
      id: decision.id,
      supported: decision.stillSupportedBand === "yes",
    });
  }
  return summarizeDrift({
    samples,
    sampledAt: input.sampledAt,
    mode: "jev",
    limit: input.sampleSize,
  });
}

async function sourcePresent(
  projectRoot: string,
  document: DocumentSummary,
): Promise<boolean> {
  const parsed = parseDocumentId(document.id);
  const sourcePath =
    parsed.kind === "other"
      ? typeof document.document_metadata?.source === "string"
        ? document.document_metadata.source
        : undefined
      : parsed.sourcePath;
  if (sourcePath === undefined || sourcePath === "") {
    return false;
  }
  return pathExists(join(projectRoot, sourcePath));
}

async function loadRetainMission(projectRoot: string): Promise<string | undefined> {
  const templatePath = bankTemplatePath(projectRoot);
  if (!(await pathExists(templatePath))) {
    return undefined;
  }
  const template = await readJsonFile<HindsightBankTemplate>(templatePath);
  const mission = template.bank?.retain_mission?.trim();
  return mission ? mission : undefined;
}
