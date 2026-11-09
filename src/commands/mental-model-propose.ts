import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../config/load.js";
import { bankTemplatePath } from "../config/paths.js";
import {
  buildRepoShapeSnapshot,
  catalogEntriesNotIn,
  createJudge,
  formatMentalModelProposeLines,
  judgeMentalModelCatalogEntry,
  listMentalModelCatalog,
  type MentalModelCatalogProposal,
  type ResolvedJudge,
} from "../judge/index.js";
import { detectProjectRoot } from "../project/detect-root.js";
import type { HindsightBankTemplate } from "../providers/hindsight/types.js";
import { OrtoError } from "../utils/errors.js";
import { pathExists, readJsonFile } from "../utils/fs.js";

export interface MentalModelProposeOptions {
  cwd?: string;
  dryRun?: boolean;
  judge?: string;
  confidence?: number;
  strict?: boolean;
  resolvedJudge?: ResolvedJudge;
}

export interface MentalModelProposeResult {
  projectRoot: string;
  bankId: string;
  dryRun: boolean;
  proposals: MentalModelCatalogProposal[];
  existingIds: string[];
}

export async function runMentalModelPropose(
  options: MentalModelProposeOptions = {},
): Promise<MentalModelProposeResult> {
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

  return {
    projectRoot,
    bankId: config.bankId,
    dryRun,
    proposals,
    existingIds,
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
  if (proposed.length > 0) {
    console.log(
      `${prefix}${proposed.length} proposal(s). Nothing was created in Hindsight.`,
    );
    console.log(
      "Create a selected model with `orto mental-model create --name ... --source-query ... --id ...`.",
    );
  } else {
    console.log(
      `${prefix}No confident proposals. Nothing was created in Hindsight.`,
    );
  }
}

export async function runMentalModelProposeCommand(
  options: MentalModelProposeOptions = {},
): Promise<void> {
  const result = await runMentalModelPropose(options);
  printMentalModelProposeResult(result);
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
