import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, saveConfig } from "../config/load.js";
import { bankTemplatePath, hindsightDir } from "../config/paths.js";
import type { OrtoConfig } from "../config/schema.js";
import {
  buildRepoShapeSnapshot,
  createJudge,
  judgeExtractionAggressiveness,
  judgeMissionFit,
  overrideExtractionAggressiveness,
  type ExtractionAggressiveness,
  type ExtractionAggressivenessDecision,
  type MissionFitDecision,
  type ResolvedJudge,
} from "../judge/index.js";
import { detectProjectRoot } from "../project/detect-root.js";
import { generateHindsightBankTemplate } from "../providers/hindsight/template.js";
import type { HindsightBankTemplate } from "../providers/hindsight/types.js";
import { OrtoError } from "../utils/errors.js";
import {
  ensureDir,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from "../utils/fs.js";
import {
  printBankApplyResult,
  runBankApply,
  type BankApplyResult,
} from "./bank.js";
import {
  resolveBankTemplateInput,
  type ConfigureWizardFlags,
} from "./configure-wizard.js";

export interface ConfigureOptions extends ConfigureWizardFlags {
  cwd?: string;
  dryRun?: boolean;
  force?: boolean;
  apply?: boolean;
  hindsightUrl?: string;
  apiKey?: string;
  judge?: string;
  confidence?: number;
  strict?: boolean;
  resolvedJudge?: ResolvedJudge;
  extraction?: ExtractionAggressiveness;
}

export interface ConfigureResult {
  projectRoot: string;
  bankId: string;
  templatePath: string;
  template: HindsightBankTemplate;
  dryRun: boolean;
  wrote: boolean;
  skippedWriteForReview: boolean;
  missionFit?: MissionFitDecision;
  extraction?: ExtractionAggressivenessDecision;
  configUpdated: boolean;
  apply?: BankApplyResult;
}

export async function runConfigure(
  options: ConfigureOptions = {},
): Promise<ConfigureResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;
  const apply = options.apply ?? false;
  const yes = options.yes ?? false;

  const projectRoot = await detectProjectRoot(cwd);
  const config = await loadConfig(projectRoot);
  const templatePath = bankTemplatePath(projectRoot);
  const exists = await pathExists(templatePath);

  let template: HindsightBankTemplate;
  let wrote = false;
  let skippedWriteForReview = false;
  let missionFit: MissionFitDecision | undefined;
  let extraction: ExtractionAggressivenessDecision | undefined;
  let configUpdated = false;

  if (apply && exists && !force) {
    template = await readJsonFile<HindsightBankTemplate>(templatePath);
  } else {
    if (exists && !force && !dryRun) {
      throw new OrtoError(
        `Bank template already exists at ${templatePath}`,
        "Use --force to overwrite, `orto configure --apply` to apply the existing template, or `orto configure --dry-run` to preview.",
      );
    }

    let templateInput;
    try {
      templateInput = await resolveBankTemplateInput({
        projectName: config.name,
        bankId: config.bankId,
        flags: {
          ...(options.yes !== undefined ? { yes: options.yes } : {}),
          dryRun,
          ...(options.models !== undefined ? { models: options.models } : {}),
          ...(options.taggingMode !== undefined
            ? { taggingMode: options.taggingMode }
            : {}),
          ...(options.refreshPolicy !== undefined
            ? { refreshPolicy: options.refreshPolicy }
            : {}),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new OrtoError(message, "Fix the flags or re-run configure.");
    }

    template = generateHindsightBankTemplate(templateInput);

    const resolved =
      options.resolvedJudge ??
      (options.judge !== undefined
        ? createJudge({
            judge: options.judge,
            ...(options.confidence !== undefined
              ? { confidence: options.confidence }
              : {}),
            ...(options.strict !== undefined ? { strict: options.strict } : {}),
          })
        : undefined);

    extraction = await resolveExtractionDecision({
      projectRoot,
      projectName: config.name,
      config,
      options,
      resolved,
    });
    if (extraction !== undefined) {
      template.bank.retain_extraction_mode = extraction.retainExtractionMode;
    }

    if (resolved?.judgeId === "jev") {
      const repoExcerpt = await loadRepoExcerpt(projectRoot);
      missionFit = await judgeMissionFit({
        state: {
          projectName: config.name,
          mission: template.bank.retain_mission,
          directives: template.directives.map((item) => item.content),
          ...(repoExcerpt !== undefined ? { repoExcerpt } : {}),
        },
        judge: resolved.judge,
        confidence: resolved.confidence,
      });
      if (missionFit.needsReview && !yes) {
        skippedWriteForReview = true;
      }
    }

    const shouldWrite = !skippedWriteForReview;
    if (shouldWrite) {
      if (!dryRun) {
        await ensureDir(hindsightDir(projectRoot));
      }
      await writeJsonFile(templatePath, template, dryRun);
      wrote = !dryRun;

      if (extraction !== undefined) {
        const nextConfig = withBankTemplateExtraction(config, extraction.extraction);
        if (configNeedsExtractionWrite(config, extraction.extraction)) {
          await saveConfig(projectRoot, nextConfig, dryRun);
          configUpdated = !dryRun;
        }
      }
    }
  }

  let applyResult: BankApplyResult | undefined;
  if (apply && !skippedWriteForReview) {
    applyResult = await runBankApply({
      cwd: projectRoot,
      dryRun,
      ...(options.hindsightUrl !== undefined
        ? { hindsightUrl: options.hindsightUrl }
        : {}),
      ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
    });
  }

  return {
    projectRoot,
    bankId: config.bankId,
    templatePath,
    template,
    dryRun,
    wrote,
    skippedWriteForReview,
    configUpdated,
    ...(missionFit !== undefined ? { missionFit } : {}),
    ...(extraction !== undefined ? { extraction } : {}),
    ...(applyResult !== undefined ? { apply: applyResult } : {}),
  };
}

export function printConfigureResult(result: ConfigureResult): void {
  const prefix = result.dryRun ? "[dry-run] " : "";

  if (result.missionFit !== undefined) {
    console.log(`Mission fit: ${result.missionFit.reason}`);
    if (result.missionFit.needsReview) {
      console.log("review mission before applying");
    }
    console.log("");
  }

  if (result.extraction !== undefined) {
    console.log(`Extraction aggressiveness: ${result.extraction.reason}`);
    console.log(
      `Mapped retain_extraction_mode: ${result.extraction.retainExtractionMode}`,
    );
    console.log("");
  }

  if (result.skippedWriteForReview) {
    console.log(
      `${prefix}Skipped writing bank template for bank "${result.bankId}"`,
    );
    console.log(`${prefix}Path: ${result.templatePath}`);
    console.log(
      "Low mission_fit with high confidence. Review the mission, then re-run with --yes to write, or edit the template by hand.",
    );
    console.log(JSON.stringify(result.template, null, 2));
    return;
  }

  if (result.wrote) {
    console.log(`${prefix}Wrote bank template for bank "${result.bankId}"`);
    console.log(`${prefix}Path: ${result.templatePath}`);
    console.log(
      `Extraction mode: ${result.template.bank.retain_extraction_mode}; observations: ${result.template.bank.enable_observations ? "on" : "off"}`,
    );
    if (result.configUpdated) {
      console.log(
        `${prefix}Updated .orto/config.json bankTemplate.extraction=${result.extraction?.extraction}`,
      );
    }
    console.log(
      `Mental models: ${result.template.mental_models.length}, directives: ${result.template.directives.length}`,
    );
    for (const model of result.template.mental_models) {
      const refresh = model.trigger.refresh_after_consolidation
        ? "auto"
        : "manual";
      const tags = model.tags.length > 0 ? model.tags.join(",") : "(none)";
      const match = model.trigger.tags_match
        ? ` tags_match=${model.trigger.tags_match}`
        : "";
      console.log(
        `  - ${model.id}: refresh=${refresh}; tags=${tags}${match}`,
      );
    }
  } else if (result.dryRun && !result.apply) {
    console.log(`${prefix}Would write bank template for bank "${result.bankId}"`);
    console.log(`${prefix}Path: ${result.templatePath}`);
    console.log(JSON.stringify(result.template, null, 2));
    console.log("No files were written.");
  } else if (result.apply) {
    console.log(`${prefix}Using existing bank template at ${result.templatePath}`);
  }

  if (result.apply) {
    console.log("");
    printBankApplyResult(result.apply);
    return;
  }

  console.log(
    "Next: run `orto bank apply --dry-run` (or `configure --apply`) then `orto seed --dry-run`.",
  );
  console.log(
    "After seed, refresh models with `orto mental-model refresh --all` or `seed --refresh-mental-models`.",
  );
}

async function resolveExtractionDecision(input: {
  projectRoot: string;
  projectName: string;
  config: OrtoConfig;
  options: ConfigureOptions;
  resolved: ResolvedJudge | undefined;
}): Promise<ExtractionAggressivenessDecision | undefined> {
  const override =
    input.options.extraction ?? input.config.bankTemplate?.extraction;
  if (override !== undefined) {
    return overrideExtractionAggressiveness(override);
  }

  if (input.resolved?.judgeId !== "jev") {
    return undefined;
  }

  const snapshot = await buildRepoShapeSnapshot(input.projectRoot);
  return judgeExtractionAggressiveness({
    snapshot,
    judge: input.resolved.judge,
    confidence: input.resolved.confidence,
    projectName: input.projectName,
  });
}

function withBankTemplateExtraction(
  config: OrtoConfig,
  extraction: ExtractionAggressiveness,
): OrtoConfig {
  return {
    ...config,
    bankTemplate: {
      ...config.bankTemplate,
      extraction,
    },
  };
}

function configNeedsExtractionWrite(
  config: OrtoConfig,
  extraction: ExtractionAggressiveness,
): boolean {
  return config.bankTemplate?.extraction !== extraction;
}

async function loadRepoExcerpt(projectRoot: string): Promise<string | undefined> {
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
