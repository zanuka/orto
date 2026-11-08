import { loadConfig, loadShareConfig } from "../config/load.js";
import {
  assertApiKeyForConnection,
  resolveProjectConnection,
} from "../config/connection.js";
import { detectProjectRoot } from "../project/detect-root.js";
import {
  HindsightClient,
  resolveHindsightApiKey,
} from "../providers/hindsight/client.js";
import {
  buildPrunePlan,
  selectCandidatesByIds,
  type PruneCandidate,
  type PrunePlan,
} from "../seeder/prune-plan.js";
import { addTombstones } from "../seeder/tombstones.js";
import { createJudge } from "../judge/index.js";
import { OrtoError } from "../utils/errors.js";
import { isInteractive, promptLine, promptMultiSelect } from "../utils/prompt.js";
import {
  runPruneAuditPlan,
  type PruneAuditPlanResult,
} from "./prune-audit-plan.js";

export interface PruneOptions {
  cwd?: string;
  dryRun?: boolean;
  yes?: boolean;
  source?: string;
  documentId?: string;
  hindsightUrl?: string;
  apiKey?: string;
  client?: HindsightClient;
  interactive?: boolean;
  judge?: string;
  confidence?: number;
  strict?: boolean;
  plan?: string;
  apply?: boolean;
  allowDelete?: boolean;
}

export interface PruneResult {
  projectRoot: string;
  bankId: string;
  baseUrl: string;
  dryRun: boolean;
  plan: PrunePlan;
  selected: PruneCandidate[];
  deleted: string[];
  failed: number;
}

export async function runPrune(
  options: PruneOptions = {},
): Promise<PruneResult | PruneAuditPlanResult> {
  if (options.plan !== undefined || options.apply === true) {
    return runPruneAuditPlan({
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.plan !== undefined ? { plan: options.plan } : {}),
      apply: options.apply === true,
      allowDelete: options.allowDelete === true,
      ...(options.hindsightUrl !== undefined
        ? { hindsightUrl: options.hindsightUrl }
        : {}),
      ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
      ...(options.client !== undefined ? { client: options.client } : {}),
    });
  }

  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const yes = options.yes ?? false;
  const interactive = options.interactive ?? isInteractive();

  createJudge({
    ...(options.judge !== undefined ? { judge: options.judge } : {}),
    ...(options.confidence !== undefined
      ? { confidence: options.confidence }
      : {}),
    ...(options.strict !== undefined ? { strict: options.strict } : {}),
  });

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

  const hasExplicitSelection =
    (options.documentId !== undefined && options.documentId.length > 0) ||
    (options.source !== undefined && options.source.length > 0);

  if (yes && !hasExplicitSelection) {
    throw new OrtoError(
      "Refuse to prune with --yes and no selection",
      "Pass --document-id <id> or --source <path> with --yes, or run interactively / use --dry-run first.",
    );
  }

  if (!dryRun && !yes && !interactive) {
    throw new OrtoError(
      "Non-interactive prune requires an explicit selection and --yes",
      "Run `orto prune --dry-run`, then `orto prune --document-id <id> --yes` (or --source <path> --yes).",
    );
  }

  const client =
    options.client ??
    new HindsightClient({
      baseUrl,
      ...(apiKey !== undefined ? { apiKey } : {}),
    });

  if (!dryRun && !apiKey && options.client === undefined) {
    console.log(
      "Warning: no API key resolved (ORTO_HINDSIGHT_API_KEY / HINDSIGHT_API_KEY / --api-key).",
    );
    console.log(
      "If your Hindsight server requires auth, delete will fail with 401.",
    );
    console.log("");
  }

  const documents = await client.listAllDocuments(config.bankId);
  const documentIds = documents.map((d) => d.id);

  const plan = await buildPrunePlan({
    projectRoot,
    documentIds,
    ...(options.documentId !== undefined
      ? { documentId: options.documentId }
      : {}),
    ...(options.source !== undefined ? { source: options.source } : {}),
  });

  printPrunePlan({ plan, bankId: config.bankId, baseUrl, projectRoot, dryRun });

  let selected: PruneCandidate[] = [];

  if (hasExplicitSelection) {
    selected = plan.explicit;
    if (selected.length === 0) {
      throw new OrtoError(
        "No documents matched the explicit selection",
        "Check --document-id / --source against `orto prune --dry-run` output.",
      );
    }
  } else if (dryRun) {
    selected = [];
  } else if (interactive) {
    if (plan.all.length === 0) {
      console.log("No prune candidates.");
      return {
        projectRoot,
        bankId: config.bankId,
        baseUrl,
        dryRun,
        plan,
        selected: [],
        deleted: [],
        failed: 0,
      };
    }
    const labels = plan.all.map(formatCandidateLabel);
    const picked = await promptMultiSelect(
      "Select documents to delete from the bank:",
      labels,
    );
    const labelToId = new Map(
      plan.all.map((c, i) => [labels[i] ?? formatCandidateLabel(c), c.documentId]),
    );
    const pickedIds = picked
      .map((label) => labelToId.get(label))
      .filter((id): id is string => id !== undefined);
    selected = selectCandidatesByIds(plan, pickedIds);
    if (selected.length === 0) {
      console.log("Nothing selected. Aborting.");
      return {
        projectRoot,
        bankId: config.bankId,
        baseUrl,
        dryRun,
        plan,
        selected: [],
        deleted: [],
        failed: 0,
      };
    }
    const confirm = await promptLine(
      `Delete ${selected.length} document(s) from bank "${config.bankId}"? [y/N]`,
    );
    if (confirm.trim().toLowerCase() !== "y") {
      console.log("Aborted.");
      return {
        projectRoot,
        bankId: config.bankId,
        baseUrl,
        dryRun,
        plan,
        selected: [],
        deleted: [],
        failed: 0,
      };
    }
  }

  if (dryRun) {
    console.log(
      "[dry-run] No documents were deleted. Re-run without --dry-run to apply (TTY confirm, or --document-id/--source with --yes).",
    );
    console.log(
      "After deletes, consider refreshing mental models separately if your bank uses them.",
    );
    return {
      projectRoot,
      bankId: config.bankId,
      baseUrl,
      dryRun: true,
      plan,
      selected,
      deleted: [],
      failed: 0,
    };
  }

  if (selected.length === 0) {
    return {
      projectRoot,
      bankId: config.bankId,
      baseUrl,
      dryRun: false,
      plan,
      selected,
      deleted: [],
      failed: 0,
    };
  }

  const deleted: string[] = [];
  let failed = 0;
  console.log("");
  console.log(`Deleting ${selected.length} document(s) from "${config.bankId}"...`);
  for (const candidate of selected) {
    try {
      const result = await client.deleteDocument(
        config.bankId,
        candidate.documentId,
      );
      deleted.push(candidate.documentId);
      console.log(
        `  deleted ${candidate.documentId} (${result.memory_units_deleted} memory unit(s))`,
      );
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  failed ${candidate.documentId}: ${message}`);
    }
  }

  if (deleted.length > 0) {
    const tombEntries = selected
      .filter((c) => deleted.includes(c.documentId))
      .map((c) => {
        const entry: {
          documentId: string;
          sourcePath?: string;
          contentHash?: string;
        } = { documentId: c.documentId };
        if (c.sourcePath !== undefined) {
          entry.sourcePath = c.sourcePath;
        }
        if (c.contentHash !== undefined) {
          entry.contentHash = c.contentHash;
        }
        return entry;
      });
    await addTombstones(projectRoot, config.bankId, tombEntries);
    console.log("");
    console.log(
      `Deleted ${deleted.length} document(s)${failed > 0 ? `, ${failed} failed` : ""}.`,
    );
    console.log("Tombstones written under .orto/local/tombstones.json");
    console.log(
      "Unchanged sources will not be re-retained on the next seed/store (use --force or change the file).",
    );
    console.log(
      "Consider refreshing mental models separately if your bank uses them.",
    );
  } else {
    console.log("Nothing was deleted.");
  }

  return {
    projectRoot,
    bankId: config.bankId,
    baseUrl,
    dryRun: false,
    plan,
    selected,
    deleted,
    failed,
  };
}

export async function runPruneCommand(
  options: PruneOptions = {},
): Promise<void> {
  await runPrune(options);
}

function formatCandidateLabel(candidate: PruneCandidate): string {
  const provenance =
    candidate.sourcePath !== undefined
      ? candidate.sectionSlug !== undefined
        ? `${candidate.sourcePath}#${candidate.sectionSlug}`
        : candidate.sourcePath
      : "no source path";
  return `[${candidate.group}] ${candidate.documentId} (${provenance})`;
}

function printPrunePlan(input: {
  plan: PrunePlan;
  bankId: string;
  baseUrl: string;
  projectRoot: string;
  dryRun: boolean;
}): void {
  const prefix = input.dryRun ? "[dry-run] " : "";
  console.log(`${prefix}Prune for bank "${input.bankId}"`);
  console.log(`${prefix}Hindsight: ${input.baseUrl}`);
  console.log(`${prefix}Project root: ${input.projectRoot}`);
  console.log("");

  printGroup(prefix, "Source path gone", input.plan.pathGone);
  printGroup(prefix, "Section gone", input.plan.sectionGone);
  printGroup(prefix, "Explicit", input.plan.explicit);

  if (input.plan.all.length === 0) {
    console.log(`${prefix}No prune candidates.`);
    console.log("");
  } else {
    console.log(`${prefix}Total candidates: ${input.plan.all.length}`);
    console.log("");
  }
}

function printGroup(
  prefix: string,
  title: string,
  candidates: PruneCandidate[],
): void {
  if (candidates.length === 0) {
    return;
  }
  console.log(`${prefix}${title} (${candidates.length}):`);
  for (const candidate of candidates) {
    const provenance =
      candidate.sourcePath !== undefined
        ? candidate.sectionSlug !== undefined
          ? `source=${candidate.sourcePath} section=${candidate.sectionSlug}`
          : `source=${candidate.sourcePath}`
        : "source=(none)";
    console.log(`  ${candidate.documentId}`);
    console.log(`    ${provenance}; ${candidate.reason}`);
  }
  console.log("");
}
