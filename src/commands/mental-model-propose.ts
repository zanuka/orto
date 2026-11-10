import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertApiKeyForConnection,
  resolveProjectConnection,
} from "../config/connection.js";
import { loadConfig, loadShareConfig } from "../config/load.js";
import { bankTemplatePath } from "../config/paths.js";
import {
  buildRepoShapeSnapshot,
  catalogEntriesNotIn,
  catalogProposalCreateSpec,
  createJudge,
  formatMentalModelProposeLines,
  judgeMentalModelCatalogEntry,
  listMentalModelCatalog,
  type MentalModelCatalogProposal,
  type ResolvedJudge,
} from "../judge/index.js";
import { detectProjectRoot } from "../project/detect-root.js";
import {
  HindsightClient,
  resolveHindsightApiKey,
} from "../providers/hindsight/client.js";
import { mentalModelToTemplateEntry } from "../providers/hindsight/mental-models.js";
import {
  collectOperationIds,
  pollOperationUntilDone,
} from "../providers/hindsight/operations.js";
import type {
  HindsightBankTemplate,
  HindsightMentalModel,
} from "../providers/hindsight/types.js";
import { OrtoError } from "../utils/errors.js";
import { pathExists, readJsonFile, writeJsonFile } from "../utils/fs.js";
import { isInteractive, promptMultiSelect } from "../utils/prompt.js";

export interface MentalModelProposeOptions {
  cwd?: string;
  dryRun?: boolean;
  apply?: boolean;
  yes?: boolean;
  saveTemplate?: boolean;
  ids?: string[];
  judge?: string;
  confidence?: number;
  strict?: boolean;
  resolvedJudge?: ResolvedJudge;
  hindsightUrl?: string;
  apiKey?: string;
  client?: HindsightClient;
  selectProposals?: (
    proposed: MentalModelCatalogProposal[],
  ) => Promise<MentalModelCatalogProposal[]>;
}

export interface MentalModelProposeResult {
  projectRoot: string;
  bankId: string;
  dryRun: boolean;
  apply: boolean;
  saveTemplate: boolean;
  proposals: MentalModelCatalogProposal[];
  existingIds: string[];
  selected: MentalModelCatalogProposal[];
  created: string[];
  templateUpdated: boolean;
}

export async function runMentalModelPropose(
  options: MentalModelProposeOptions = {},
): Promise<MentalModelProposeResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const apply = options.apply ?? false;
  const yes = options.yes ?? false;
  const saveTemplate = options.saveTemplate ?? apply;

  if (yes && !apply) {
    throw new OrtoError(
      "--yes only applies with --apply",
      "Re-run: orto mental-model propose --judge jev --apply --yes",
    );
  }
  if ((options.ids?.length ?? 0) > 0 && !apply) {
    throw new OrtoError(
      "--ids only applies with --apply",
      "Re-run: orto mental-model propose --judge jev --apply --ids <id>[,<id>...]",
    );
  }

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
      "Mental-model propose requires --judge jev.",
      "Re-run: orto mental-model propose --judge jev",
    );
  }

  const projectRoot = await detectProjectRoot(cwd);
  const config = await loadConfig(projectRoot);
  const existingIds = await loadExistingMentalModelIds(projectRoot);
  const candidates = catalogEntriesNotIn(new Set(existingIds));
  const snapshot = await buildRepoShapeSnapshot(projectRoot);
  const repoExcerpt = await loadRepoExcerpt(projectRoot);

  const proposals: MentalModelCatalogProposal[] = [];
  for (const entry of candidates) {
    proposals.push(
      await judgeMentalModelCatalogEntry({
        entry,
        projectName: config.name,
        snapshot,
        ...(repoExcerpt !== undefined ? { repoExcerpt } : {}),
        judge: resolved.judge,
        confidence: resolved.confidence,
      }),
    );
  }

  const proposed = proposals.filter((item) => item.verdict === "propose");
  let selected: MentalModelCatalogProposal[] = [];
  const created: string[] = [];
  let templateUpdated = false;

  if (apply) {
    selected = await resolveSelectedProposals({
      proposed,
      yes,
      ids: options.ids,
      selectProposals: options.selectProposals,
    });

    if (selected.length > 0) {
      const share = await loadShareConfig(projectRoot);
      const connection = resolveProjectConnection({
        config,
        share,
        ...(options.hindsightUrl !== undefined
          ? { cliUrl: options.hindsightUrl }
          : {}),
      });
      const apiKey = resolveHindsightApiKey({
        ...(options.apiKey !== undefined ? { cliKey: options.apiKey } : {}),
      });
      if (!dryRun && options.client === undefined) {
        assertApiKeyForConnection({
          connection,
          ...(apiKey ? { apiKey } : {}),
        });
      }
      const client =
        options.client ??
        new HindsightClient({
          baseUrl: connection.baseUrl,
          ...(apiKey !== undefined ? { apiKey } : {}),
        });

      for (const proposal of selected) {
        const spec = catalogProposalCreateSpec({
          id: proposal.id,
          title: proposal.title,
          kind: proposal.kind,
          sourceQuery: proposal.sourceQuery,
        });
        const body = {
          id: spec.id,
          name: spec.name,
          source_query: spec.sourceQuery,
          tags: spec.tags,
          max_tokens: spec.maxTokens,
          trigger: {
            refresh_after_consolidation: spec.refreshAfterConsolidation,
          },
        };

        if (dryRun) {
          console.log(`[dry-run] Would create mental model "${spec.id}":`);
          console.log(JSON.stringify(body, null, 2));
          created.push(spec.id);
          continue;
        }

        const response = await client.createMentalModel(config.bankId, body);
        console.log(`Created mental model "${spec.id}".`);
        const operationIds = collectOperationIds(response);
        for (const operationId of operationIds) {
          console.log(`Tracking operation ${operationId}...`);
          await pollOperationUntilDone(client, config.bankId, operationId);
        }
        created.push(spec.id);

        if (saveTemplate) {
          await upsertTemplateModel(projectRoot, {
            id: spec.id,
            name: spec.name,
            source_query: spec.sourceQuery,
            max_tokens: spec.maxTokens,
            tags: spec.tags,
            trigger: {
              refresh_after_consolidation: spec.refreshAfterConsolidation,
            },
          });
          templateUpdated = true;
        }
      }
    }
  }

  return {
    projectRoot,
    bankId: config.bankId,
    dryRun,
    apply,
    saveTemplate,
    proposals,
    existingIds,
    selected,
    created,
    templateUpdated,
  };
}

export function printMentalModelProposeResult(
  result: MentalModelProposeResult,
): void {
  const prefix = result.dryRun ? "[dry-run] " : "";
  console.log(
    `${prefix}Mental model catalog propose for bank "${result.bankId}"`,
  );
  console.log(`${prefix}Project root: ${result.projectRoot}`);
  console.log(
    `${prefix}Catalog size: ${listMentalModelCatalog().length}; already in template: ${result.existingIds.length}`,
  );
  console.log("");
  for (const line of formatMentalModelProposeLines({
    proposals: result.proposals,
    dryRun: result.dryRun,
  })) {
    console.log(line);
  }
  console.log("");

  const proposed = result.proposals.filter((item) => item.verdict === "propose");
  if (!result.apply) {
    if (proposed.length > 0) {
      console.log(
        `${prefix}${proposed.length} proposal(s). Nothing was created in Hindsight.`,
      );
      console.log(
        "Select and create with `orto mental-model propose --judge jev --apply` (interactive), or `--apply --yes` for all proposals.",
      );
    } else {
      console.log(
        `${prefix}No confident proposals. Nothing was created in Hindsight.`,
      );
    }
    return;
  }

  if (result.selected.length === 0) {
    console.log(`${prefix}Nothing selected. No mental models were created.`);
    return;
  }

  if (result.dryRun) {
    console.log(
      `${prefix}Would create ${result.created.length} mental model(s): ${result.created.join(", ")}`,
    );
    if (result.saveTemplate) {
      console.log(
        `${prefix}Would write declarations into bank-template.json.`,
      );
    }
    return;
  }

  console.log(
    `Created ${result.created.length} mental model(s): ${result.created.join(", ")}`,
  );
  if (result.templateUpdated) {
    console.log("Wrote declaration(s) into bank-template.json.");
  }
}

export async function runMentalModelProposeCommand(
  options: MentalModelProposeOptions = {},
): Promise<void> {
  const result = await runMentalModelPropose(options);
  printMentalModelProposeResult(result);
}

async function resolveSelectedProposals(input: {
  proposed: MentalModelCatalogProposal[];
  yes: boolean;
  ids?: string[];
  selectProposals?: (
    proposed: MentalModelCatalogProposal[],
  ) => Promise<MentalModelCatalogProposal[]>;
}): Promise<MentalModelCatalogProposal[]> {
  if (input.proposed.length === 0) {
    return [];
  }

  if (input.ids !== undefined && input.ids.length > 0) {
    const wanted = new Set(input.ids);
    const selected = input.proposed.filter((item) => wanted.has(item.id));
    const missing = input.ids.filter(
      (id) => !selected.some((item) => item.id === id),
    );
    if (missing.length > 0) {
      throw new OrtoError(
        `Unknown or non-proposed id(s): ${missing.join(", ")}`,
        "Pass ids from the propose list (verdict=propose), or omit --ids to select interactively.",
      );
    }
    return selected;
  }

  if (input.yes) {
    return [...input.proposed];
  }

  if (input.selectProposals !== undefined) {
    return input.selectProposals(input.proposed);
  }

  if (!isInteractive()) {
    throw new OrtoError(
      "Interactive selection requires a TTY (or pass --yes / --ids)",
      "Re-run with --apply --yes to create all proposals, or --apply --ids <id>[,<id>...].",
    );
  }

  const labels = input.proposed.map(formatProposalChoice);
  const picked = await promptMultiSelect(
    "Select mental models to create:",
    labels,
  );
  const byLabel = new Map(
    input.proposed.map((item) => [formatProposalChoice(item), item]),
  );
  return picked
    .map((label) => byLabel.get(label))
    .filter((item): item is MentalModelCatalogProposal => item !== undefined);
}

function formatProposalChoice(proposal: MentalModelCatalogProposal): string {
  const confidence =
    proposal.confidence !== undefined
      ? ` confidence=${proposal.confidence.toFixed(2)}`
      : "";
  return `${proposal.id}: ${proposal.title} (${proposal.kind})${confidence}`;
}

async function upsertTemplateModel(
  projectRoot: string,
  model: HindsightMentalModel,
): Promise<void> {
  const templatePath = bankTemplatePath(projectRoot);
  if (!(await pathExists(templatePath))) {
    throw new OrtoError(
      `Bank template not found at ${templatePath}`,
      "Run `orto configure` before --apply --save-template.",
    );
  }
  const template = await readJsonFile<HindsightBankTemplate>(templatePath);
  const entry = mentalModelToTemplateEntry(model);
  const index = template.mental_models.findIndex((item) => item.id === entry.id);
  if (index === -1) {
    template.mental_models.push(entry);
  } else {
    template.mental_models[index] = entry;
  }
  await writeJsonFile(templatePath, template, false);
}

async function loadExistingMentalModelIds(
  projectRoot: string,
): Promise<string[]> {
  const path = bankTemplatePath(projectRoot);
  if (!(await pathExists(path))) {
    return [];
  }
  try {
    const template = await readJsonFile<HindsightBankTemplate>(path);
    return template.mental_models.map((model) => model.id);
  } catch {
    return [];
  }
}

async function loadRepoExcerpt(
  projectRoot: string,
): Promise<string | undefined> {
  for (const name of ["README.md", "readme.md", "Readme.md"]) {
    const path = join(projectRoot, name);
    if (!(await pathExists(path))) {
      continue;
    }
    try {
      const content = await readFile(path, "utf8");
      const trimmed = content.trim();
      return trimmed.length > 0 ? trimmed.slice(0, 4_000) : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
