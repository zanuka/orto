import { loadConfig, loadShareConfig } from "../config/load.js";
import {
  assertApiKeyForConnection,
  resolveProjectConnection,
} from "../config/connection.js";
import { bankTemplatePath } from "../config/paths.js";
import {
  createJudge,
  formatAuditTable,
  judgeAuditItem,
  type AuditDecision,
  type ResolvedJudge,
} from "../judge/index.js";
import { detectProjectRoot } from "../project/detect-root.js";
import {
  HindsightClient,
  resolveHindsightApiKey,
  type DocumentSummary,
} from "../providers/hindsight/client.js";
import type { HindsightBankTemplate } from "../providers/hindsight/types.js";
import {
  auditPlanPath,
  buildAuditItems,
  saveAuditPlan,
  toAuditPlanFile,
} from "../seeder/audit-plan.js";
import { OrtoError } from "../utils/errors.js";
import { pathExists, readJsonFile } from "../utils/fs.js";

export interface AuditOptions {
  cwd?: string;
  dryRun?: boolean;
  limit?: number;
  hindsightUrl?: string;
  apiKey?: string;
  judge?: string;
  confidence?: number;
  strict?: boolean;
  resolvedJudge?: ResolvedJudge;
  client?: HindsightClient;
  documents?: readonly DocumentSummary[];
}

export interface AuditResult {
  projectRoot: string;
  bankId: string;
  baseUrl: string;
  dryRun: boolean;
  planPath: string;
  decisions: AuditDecision[];
  wrotePlan: boolean;
}

export async function runAudit(options: AuditOptions = {}): Promise<AuditResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;

  const resolved =
    options.resolvedJudge ??
    createJudge({
      ...(options.judge !== undefined ? { judge: options.judge } : {}),
      ...(options.confidence !== undefined
        ? { confidence: options.confidence }
        : {}),
      ...(options.strict !== undefined ? { strict: options.strict } : {}),
    });

  if (resolved.judgeId !== "jev") {
    throw new OrtoError(
      "Audit requires --judge jev.",
      "Re-run: orto audit --judge jev",
    );
  }

  const projectRoot = await detectProjectRoot(cwd);
  const config = await loadConfig(projectRoot);
  const share = await loadShareConfig(projectRoot);
  const connection = resolveProjectConnection({
    config,
    share,
    ...(options.hindsightUrl !== undefined
      ? { cliUrl: options.hindsightUrl }
      : {}),
  });
  const baseUrl = connection.baseUrl;
  const apiKey = resolveHindsightApiKey({
    ...(options.apiKey !== undefined ? { cliKey: options.apiKey } : {}),
  });
  assertApiKeyForConnection({ connection, ...(apiKey ? { apiKey } : {}) });

  const client =
    options.client ??
    new HindsightClient({
      baseUrl,
      ...(apiKey !== undefined ? { apiKey } : {}),
    });

  const documents =
    options.documents ??
    (await client.listAllDocuments(config.bankId, {
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    }));
  const mission = await loadRetainMission(projectRoot);
  const items = await buildAuditItems({
    projectRoot,
    documents,
    ...(mission !== undefined ? { bankMission: mission } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
  });

  const decisions: AuditDecision[] = [];
  for (const item of items) {
    decisions.push(
      await judgeAuditItem({
        item,
        judge: resolved.judge,
        confidence: resolved.confidence,
      }),
    );
  }

  const planPath = auditPlanPath(projectRoot);
  let wrotePlan = false;
  if (!dryRun) {
    await saveAuditPlan(
      projectRoot,
      toAuditPlanFile({
        bankId: config.bankId,
        confidence: resolved.confidence,
        decisions,
      }),
    );
    wrotePlan = true;
  }

  console.log(`Audit for bank "${config.bankId}"`);
  console.log(`Hindsight: ${baseUrl}`);
  console.log(`Project root: ${projectRoot}`);
  console.log("");
  for (const line of formatAuditTable({ decisions, dryRun })) {
    console.log(line);
  }
  console.log("");
  if (wrotePlan) {
    console.log(`Wrote ${planPath}`);
    console.log("Nothing was deleted or retained. Review the plan, then prune with confirmation.");
  } else {
    console.log(
      `[dry-run] Would write ${planPath}. Re-run without --dry-run to save the plan.`,
    );
    console.log("Nothing was deleted or retained.");
  }

  return {
    projectRoot,
    bankId: config.bankId,
    baseUrl,
    dryRun,
    planPath,
    decisions,
    wrotePlan,
  };
}

export async function runAuditCommand(options: AuditOptions = {}): Promise<void> {
  await runAudit(options);
}

async function loadRetainMission(
  projectRoot: string,
): Promise<string | undefined> {
  const templatePath = bankTemplatePath(projectRoot);
  if (!(await pathExists(templatePath))) {
    return undefined;
  }
  const template = await readJsonFile<HindsightBankTemplate>(templatePath);
  const mission = template.bank?.retain_mission?.trim();
  return mission ? mission : undefined;
}
