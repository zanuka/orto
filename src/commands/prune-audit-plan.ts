import { isAbsolute, resolve } from "node:path";
import {
  assertApiKeyForConnection,
  resolveProjectConnection,
} from "../config/connection.js";
import { loadConfig, loadShareConfig } from "../config/load.js";
import { detectProjectRoot } from "../project/detect-root.js";
import {
  HindsightClient,
  resolveHindsightApiKey,
} from "../providers/hindsight/client.js";
import { parseDocumentId } from "../seeder/prune-plan.js";
import {
  assertAuditPlanBank,
  assertAuditPlanNotStale,
  formatAuditApplySummary,
  loadAuditAppliedState,
  loadAuditPlanFile,
  resolveAuditPlanPath,
  saveAuditAppliedState,
  selectAuditPlanActions,
  type AuditApplySelection,
  type AuditAppliedState,
} from "../seeder/audit-plan-apply.js";
import { recordAuditSupersede } from "../seeder/audit-supersedes.js";
import { addTombstones } from "../seeder/tombstones.js";
import { OrtoError } from "../utils/errors.js";

export interface PruneAuditPlanOptions {
  cwd?: string;
  plan?: string;
  apply?: boolean;
  allowDelete?: boolean;
  hindsightUrl?: string;
  apiKey?: string;
  client?: HindsightClient;
}

export interface PruneAuditPlanResult {
  projectRoot: string;
  bankId: string;
  baseUrl: string;
  planPath: string;
  apply: boolean;
  allowDelete: boolean;
  selections: AuditApplySelection[];
  refreshed: string[];
  archived: string[];
  superseded: string[];
  deleted: string[];
  failed: number;
  wroteAppliedState: boolean;
}

export async function runPruneAuditPlan(
  options: PruneAuditPlanOptions = {},
): Promise<PruneAuditPlanResult> {
  const cwd = options.cwd ?? process.cwd();
  const apply = options.apply ?? false;
  const allowDelete = options.allowDelete ?? false;

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

  const planPath = resolvePath(projectRoot, options.plan);
  const plan = await loadAuditPlanFile(planPath);
  assertAuditPlanBank(plan, config.bankId);

  const client =
    options.client ??
    new HindsightClient({
      baseUrl,
      ...(apiKey !== undefined ? { apiKey } : {}),
    });

  const [documents, mentalModels] = await Promise.all([
    client.listAllDocuments(config.bankId),
    client.listAllMentalModels(config.bankId),
  ]);
  const knownIds = new Set<string>([
    ...documents.map((doc) => doc.id),
    ...mentalModels.map((model) => model.id),
  ]);

  const applied = await loadAuditAppliedState(projectRoot);
  const appliedForPlan =
    applied !== null &&
    applied.bankId === config.bankId &&
    applied.planCreatedAt === plan.createdAt
      ? applied
      : null;

  assertAuditPlanNotStale({
    plan,
    knownIds,
    applied: appliedForPlan,
  });

  const selections = selectAuditPlanActions({
    plan,
    allowDelete,
    applied: appliedForPlan,
  });

  console.log(`Prune audit plan for bank "${config.bankId}"`);
  console.log(`Hindsight: ${baseUrl}`);
  console.log(`Plan: ${planPath}`);
  console.log(`Project root: ${projectRoot}`);
  console.log("");
  for (const line of formatAuditApplySummary({
    selections,
    apply,
    allowDelete,
  })) {
    console.log(line);
  }

  if (!apply) {
    return {
      projectRoot,
      bankId: config.bankId,
      baseUrl,
      planPath,
      apply: false,
      allowDelete,
      selections,
      refreshed: [],
      archived: [],
      superseded: [],
      deleted: [],
      failed: 0,
      wroteAppliedState: false,
    };
  }

  const toApply = selections.filter((row) => row.disposition === "apply");
  if (toApply.length === 0) {
    const allAlready =
      selections.length > 0 &&
      selections.every((row) => row.disposition === "skip_already_applied");
    if (allAlready) {
      console.log("");
      console.log("Plan already applied; nothing to do.");
    } else {
      console.log("");
      console.log("Nothing eligible to apply.");
    }
    return {
      projectRoot,
      bankId: config.bankId,
      baseUrl,
      planPath,
      apply: true,
      allowDelete,
      selections,
      refreshed: [],
      archived: [],
      superseded: [],
      deleted: [],
      failed: 0,
      wroteAppliedState: false,
    };
  }

  const refreshed: string[] = [];
  const archived: string[] = [];
  const superseded: string[] = [];
  const deleted: string[] = [];
  let failed = 0;
  const nextApplied: AuditAppliedState = {
    version: 1,
    bankId: config.bankId,
    planCreatedAt: plan.createdAt,
    planPath,
    appliedAt: new Date().toISOString(),
    items: { ...(appliedForPlan?.items ?? {}) },
  };

  console.log("");
  console.log(`Applying ${toApply.length} audit plan action(s)...`);

  for (const row of toApply) {
    try {
      if (row.effect === "refresh_mental_model") {
        await client.refreshMentalModel(config.bankId, row.item.id);
        refreshed.push(row.item.id);
        console.log(`  refreshed mental model ${row.item.id}`);
      } else if (row.effect === "archive") {
        await archiveItem({
          projectRoot,
          bankId: config.bankId,
          itemId: row.item.id,
          knownDocumentIds: new Set(documents.map((doc) => doc.id)),
        });
        archived.push(row.item.id);
        console.log(`  archived ${row.item.id}`);
      } else if (row.effect === "supersede") {
        const shouldDelete = allowDelete;
        if (shouldDelete && knownIds.has(row.item.id)) {
          const parsed = parseDocumentId(row.item.id);
          if (parsed.kind !== "other" || documents.some((d) => d.id === row.item.id)) {
            await client.deleteDocument(config.bankId, row.item.id);
            deleted.push(row.item.id);
            await addTombstones(projectRoot, config.bankId, [
              {
                documentId: row.item.id,
                ...(parsed.kind !== "other"
                  ? { sourcePath: parsed.sourcePath }
                  : {}),
              },
            ]);
          }
        }
        await recordAuditSupersede({
          projectRoot,
          bankId: config.bankId,
          id: row.item.id,
          reason: row.item.reason,
          deleted: shouldDelete && deleted.includes(row.item.id),
        });
        superseded.push(row.item.id);
        console.log(
          shouldDelete && deleted.includes(row.item.id)
            ? `  superseded+deleted ${row.item.id}`
            : `  superseded (provenance) ${row.item.id}`,
        );
      } else if (row.effect === "delete") {
        await client.deleteDocument(config.bankId, row.item.id);
        deleted.push(row.item.id);
        const parsed = parseDocumentId(row.item.id);
        await addTombstones(projectRoot, config.bankId, [
          {
            documentId: row.item.id,
            ...(parsed.kind !== "other" ? { sourcePath: parsed.sourcePath } : {}),
          },
        ]);
        console.log(`  deleted ${row.item.id}`);
      }
      nextApplied.items[row.item.id] = {
        action: row.item.action,
        appliedAt: new Date().toISOString(),
        effect: row.effect,
      };
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  failed ${row.item.id}: ${message}`);
    }
  }

  nextApplied.appliedAt = new Date().toISOString();
  await saveAuditAppliedState(projectRoot, nextApplied);

  console.log("");
  console.log(
    `Applied: refresh=${refreshed.length} archive=${archived.length} supersede=${superseded.length} delete=${deleted.length}${failed > 0 ? ` failed=${failed}` : ""}`,
  );
  console.log("Applied state written under .orto/local/audit-plan-applied.json");

  return {
    projectRoot,
    bankId: config.bankId,
    baseUrl,
    planPath,
    apply: true,
    allowDelete,
    selections,
    refreshed,
    archived,
    superseded,
    deleted,
    failed,
    wroteAppliedState: true,
  };
}

function resolvePath(projectRoot: string, planOption?: string): string {
  const resolved = resolveAuditPlanPath(projectRoot, planOption);
  return isAbsolute(resolved) ? resolved : resolve(resolved);
}

async function archiveItem(input: {
  projectRoot: string;
  bankId: string;
  itemId: string;
  knownDocumentIds: ReadonlySet<string>;
}): Promise<void> {
  if (!input.knownDocumentIds.has(input.itemId)) {
    return;
  }
  const parsed = parseDocumentId(input.itemId);
  await addTombstones(input.projectRoot, input.bankId, [
    {
      documentId: input.itemId,
      ...(parsed.kind !== "other" ? { sourcePath: parsed.sourcePath } : {}),
    },
  ]);
}
