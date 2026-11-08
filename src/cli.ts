import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runConfigure, printConfigureResult } from "./commands/configure.js";
import {
  parseDockerAction,
  printDockerResult,
  runDockerHelper,
} from "./commands/docker.js";
import {
  printDockerUpgradeResult,
  runDockerUpgrade,
} from "./commands/docker-upgrade.js";
import { printInitResult, runInit } from "./commands/init.js";
import { printMcpResult, runMcp } from "./commands/mcp.js";
import { runMentalModelCommand } from "./commands/mental-model.js";
import { runAuditCommand } from "./commands/audit.js";
import { runPruneCommand } from "./commands/prune.js";
import { runSeedCommand } from "./commands/seed.js";
import { runStoreCommand } from "./commands/store.js";
import { printBankApplyResult, runBankApply } from "./commands/bank.js";
import { printShareResult, runShare } from "./commands/share.js";
import { printDocsListResult, runDocsList } from "./commands/docs.js";
import {
  addJudgeCliOptions,
  judgeOptionsFromCli,
} from "./judge/cli.js";
import { parseBudget } from "./judge/index.js";
import { formatError } from "./utils/errors.js";

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "package.json");
    const raw = readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("orto")
    .description(
      "Company brain config for AI agents — seed Hindsight banks from durable project knowledge",
    )
    .version(readPackageVersion());

  program
    .command("init")
    .description("Detect project root and scaffold .orto/ config")
    .option("--dry-run", "Show what would be written without creating files")
    .option("--force", "Overwrite an existing .orto/config.json")
    .option("--name <name>", "Project name (defaults to directory name)")
    .option(
      "--bank-id <id>",
      "Hindsight bank id (defaults to a slug of the project name)",
    )
    .option(
      "--container-name <name>",
      "Local Hindsight Docker container name (default: hindsight; shared across banks)",
    )
    .option("-y, --yes", "Accept defaults without interactive prompts")
    .action(
      async (opts: {
        dryRun?: boolean;
        force?: boolean;
        name?: string;
        bankId?: string;
        containerName?: string;
        yes?: boolean;
      }) => {
        const result = await runInit({
          dryRun: Boolean(opts.dryRun),
          force: Boolean(opts.force),
          yes: Boolean(opts.yes),
          ...(opts.name !== undefined ? { name: opts.name } : {}),
          ...(opts.bankId !== undefined ? { bankId: opts.bankId } : {}),
          ...(opts.containerName !== undefined
            ? { containerName: opts.containerName }
            : {}),
        });
        printInitResult(result);
      },
    );

  program
    .command("configure")
    .description("Generate a Hindsight bank template into .orto/")
    .option("--dry-run", "Print the template without writing files")
    .option("--force", "Overwrite an existing bank template")
    .option("-y, --yes", "Accept starter defaults without interactive prompts")
    .option(
      "--models <ids>",
      "Comma-separated starter mental model ids (project-context,architecture-decisions,coding-standards)",
    )
    .option(
      "--tagging-mode <mode>",
      "Mental model tagging: topic-scoped (default), project-wide, or custom",
    )
    .option(
      "--refresh-policy <policy>",
      "Mental model refresh: differentiated (default), auto, or manual",
    )
    .option(
      "--apply",
      "Apply the bank template to Hindsight (create/update bank, directives, mental models)",
    )
    .option(
      "--hindsight-url <url>",
      "Hindsight base URL when using --apply",
    )
    .option(
      "--api-key <key>",
      "Hindsight API key when using --apply (or set ORTO_HINDSIGHT_API_KEY / HINDSIGHT_API_KEY)",
    )
    .action(
      async (opts: {
        dryRun?: boolean;
        force?: boolean;
        yes?: boolean;
        models?: string;
        taggingMode?: string;
        refreshPolicy?: string;
        apply?: boolean;
        hindsightUrl?: string;
        apiKey?: string;
      }) => {
        const result = await runConfigure({
          dryRun: Boolean(opts.dryRun),
          force: Boolean(opts.force),
          yes: Boolean(opts.yes),
          apply: Boolean(opts.apply),
          ...(opts.models !== undefined ? { models: opts.models } : {}),
          ...(opts.taggingMode !== undefined
            ? { taggingMode: opts.taggingMode }
            : {}),
          ...(opts.refreshPolicy !== undefined
            ? { refreshPolicy: opts.refreshPolicy }
            : {}),
          ...(opts.hindsightUrl !== undefined
            ? { hindsightUrl: opts.hindsightUrl }
            : {}),
          ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        });
        printConfigureResult(result);
      },
    );

  const bank = program
    .command("bank")
    .description("Hindsight bank operations from the project template");

  bank
    .command("apply")
    .description(
      "Create or update the Hindsight bank from .orto/hindsight/bank-template.json",
    )
    .option("--dry-run", "Preview apply steps without calling Hindsight mutations")
    .option(
      "--hindsight-url <url>",
      "Hindsight base URL (default: config, share profile, env, or http://localhost:8888)",
    )
    .option(
      "--api-key <key>",
      "Hindsight API key (or set ORTO_HINDSIGHT_API_KEY / HINDSIGHT_API_KEY)",
    )
    .action(
      async (opts: {
        dryRun?: boolean;
        hindsightUrl?: string;
        apiKey?: string;
      }) => {
        const result = await runBankApply({
          dryRun: Boolean(opts.dryRun),
          ...(opts.hindsightUrl !== undefined
            ? { hindsightUrl: opts.hindsightUrl }
            : {}),
          ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        });
        printBankApplyResult(result);
      },
    );

  program
    .command("share")
    .description(
      "Generate or validate a deployment profile share artifact (.orto/share.json)",
    )
    .option(
      "--profile <name>",
      "Deployment profile: local, lan, vpn, public, hindsight-cloud",
    )
    .option(
      "--base-url <url>",
      "Non-secret Hindsight base URL for lan/vpn/public profiles",
    )
    .option(
      "--mcp-auth <mode>",
      "Cloud MCP auth mode: api-key (default) or oauth",
    )
    .option("--validate", "Validate the active share/profile without writing")
    .option("--dry-run", "Preview share.json / config updates without writing")
    .action(
      async (opts: {
        profile?: string;
        baseUrl?: string;
        mcpAuth?: string;
        validate?: boolean;
        dryRun?: boolean;
      }) => {
        const result = await runShare({
          dryRun: Boolean(opts.dryRun),
          validate: Boolean(opts.validate),
          ...(opts.profile !== undefined ? { profile: opts.profile } : {}),
          ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
          ...(opts.mcpAuth !== undefined ? { mcpAuth: opts.mcpAuth } : {}),
        });
        printShareResult(result);
      },
    );

  const docs = program
    .command("docs")
    .description("List bank documents (thin inventory helper for scripts)");

  docs
    .command("list")
    .description("List retained documents in the configured bank")
    .option("--json", "Emit machine-readable JSON")
    .option("--limit <n>", "Maximum documents to print (still pages the API)")
    .option(
      "--hindsight-url <url>",
      "Hindsight base URL (default: config, share profile, env, or http://localhost:8888)",
    )
    .option(
      "--api-key <key>",
      "Hindsight API key (or set ORTO_HINDSIGHT_API_KEY / HINDSIGHT_API_KEY)",
    )
    .action(
      async (opts: {
        json?: boolean;
        limit?: string;
        hindsightUrl?: string;
        apiKey?: string;
      }) => {
        const result = await runDocsList({
          json: Boolean(opts.json),
          ...(opts.limit !== undefined
            ? { limit: Number(opts.limit) }
            : {}),
          ...(opts.hindsightUrl !== undefined
            ? { hindsightUrl: opts.hindsightUrl }
            : {}),
          ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        });
        printDocsListResult(result);
      },
    );

  addJudgeCliOptions(
    program
      .command("seed")
      .description("Retain durable knowledge into the configured bank")
      .option(
        "--dry-run",
        "Preview extracted candidates without retaining. With --judge jev, may recall observation summaries (read-only)",
      )
      .option("--force", "Re-seed even when source content is unchanged")
      .option(
        "--refresh-mental-models",
        "After retain, refresh declared mental models (opt-in; may overlap refresh_after_consolidation)",
      )
      .option(
        "--hindsight-url <url>",
        "Hindsight base URL (default: config, ORTO_HINDSIGHT_URL, or http://localhost:8888)",
      )
      .option(
        "--api-key <key>",
        "Hindsight API key (or set ORTO_HINDSIGHT_API_KEY / HINDSIGHT_API_KEY)",
      )
      .option("--async", "Submit retain asynchronously to Hindsight")
      .option(
        "--budget <n>",
        "With --judge jev, retain the top N ranked candidates this run. The rest stay pending",
      ),
  ).action(
    async (opts: {
      dryRun?: boolean;
      force?: boolean;
      refreshMentalModels?: boolean;
      hindsightUrl?: string;
      apiKey?: string;
      async?: boolean;
      budget?: string;
      judge?: string;
      confidence?: string;
      strict?: boolean;
    }) => {
      const judgeOpts = judgeOptionsFromCli(opts);
      await runSeedCommand({
        dryRun: Boolean(opts.dryRun),
        force: Boolean(opts.force),
        async: Boolean(opts.async),
        refreshMentalModels: Boolean(opts.refreshMentalModels),
        ...(opts.budget !== undefined ? { budget: parseBudget(opts.budget) } : {}),
        ...(opts.hindsightUrl !== undefined
          ? { hindsightUrl: opts.hindsightUrl }
          : {}),
        ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        ...judgeOpts,
      });
    },
  );

  const mentalModel = program
    .command("mental-model")
    .description(
      "Manage Hindsight mental models for the configured bank (post-seed)",
    );

  mentalModel
    .command("list")
    .description("List mental models in the configured bank")
    .option("--detail <level>", "metadata (default), content, or full")
    .option("--hindsight-url <url>", "Hindsight base URL")
    .option("--api-key <key>", "Hindsight API key")
    .action(
      async (opts: {
        detail?: string;
        hindsightUrl?: string;
        apiKey?: string;
      }) => {
        await runMentalModelCommand({
          action: "list",
          ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
          ...(opts.hindsightUrl !== undefined
            ? { hindsightUrl: opts.hindsightUrl }
            : {}),
          ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        });
      },
    );

  mentalModel
    .command("get")
    .description("Get one mental model by id")
    .argument("<id>", "Mental model id")
    .option("--detail <level>", "metadata, content, or full (default)")
    .option("--hindsight-url <url>", "Hindsight base URL")
    .option("--api-key <key>", "Hindsight API key")
    .action(
      async (
        id: string,
        opts: { detail?: string; hindsightUrl?: string; apiKey?: string },
      ) => {
        await runMentalModelCommand({
          action: "get",
          id,
          ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
          ...(opts.hindsightUrl !== undefined
            ? { hindsightUrl: opts.hindsightUrl }
            : {}),
          ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        });
      },
    );

  mentalModel
    .command("create")
    .description("Create a mental model on the configured bank")
    .option("--dry-run", "Print the create payload without calling Hindsight")
    .option("--id <id>", "Stable custom id (lowercase alphanumeric + hyphens)")
    .requiredOption("--name <name>", "Human-readable name")
    .requiredOption("--source-query <query>", "Reflect query used to generate content")
    .option("--tags <tags>", "Comma-separated tags")
    .option("--tags-match <mode>", "any, all, any_strict, all_strict, or exact")
    .option("--max-tokens <n>", "Max tokens for model content", (v) =>
      Number.parseInt(v, 10),
    )
    .option(
      "--refresh-after-consolidation",
      "Auto-refresh after observation consolidation",
    )
    .option("--mode <mode>", "Refresh mode: full or delta")
    .option(
      "--save-template",
      "Write the declaration into .orto/hindsight/bank-template.json",
    )
    .option("--hindsight-url <url>", "Hindsight base URL")
    .option("--api-key <key>", "Hindsight API key")
    .action(
      async (opts: {
        dryRun?: boolean;
        id?: string;
        name: string;
        sourceQuery: string;
        tags?: string;
        tagsMatch?: string;
        maxTokens?: number;
        refreshAfterConsolidation?: boolean;
        mode?: string;
        saveTemplate?: boolean;
        hindsightUrl?: string;
        apiKey?: string;
      }) => {
        await runMentalModelCommand({
          action: "create",
          dryRun: Boolean(opts.dryRun),
          name: opts.name,
          sourceQuery: opts.sourceQuery,
          refreshAfterConsolidation: Boolean(opts.refreshAfterConsolidation),
          saveTemplate: Boolean(opts.saveTemplate),
          ...(opts.id !== undefined ? { id: opts.id } : {}),
          ...(opts.tags !== undefined ? { tags: opts.tags } : {}),
          ...(opts.tagsMatch !== undefined
            ? { tagsMatch: opts.tagsMatch }
            : {}),
          ...(opts.maxTokens !== undefined
            ? { maxTokens: opts.maxTokens }
            : {}),
          ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
          ...(opts.hindsightUrl !== undefined
            ? { hindsightUrl: opts.hindsightUrl }
            : {}),
          ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        });
      },
    );

  mentalModel
    .command("update")
    .description("Update a mental model on the configured bank")
    .argument("<id>", "Mental model id")
    .option("--dry-run", "Print the update payload without calling Hindsight")
    .option("--name <name>", "Human-readable name")
    .option("--source-query <query>", "Reflect query used to generate content")
    .option("--tags <tags>", "Comma-separated tags")
    .option("--tags-match <mode>", "any, all, any_strict, all_strict, or exact")
    .option("--max-tokens <n>", "Max tokens for model content", (v) =>
      Number.parseInt(v, 10),
    )
    .option(
      "--refresh-after-consolidation",
      "Enable auto-refresh after consolidation",
    )
    .option("--mode <mode>", "Refresh mode: full or delta")
    .option(
      "--save-template",
      "Write the declaration into .orto/hindsight/bank-template.json",
    )
    .option("--hindsight-url <url>", "Hindsight base URL")
    .option("--api-key <key>", "Hindsight API key")
    .action(
      async (
        id: string,
        opts: {
          dryRun?: boolean;
          name?: string;
          sourceQuery?: string;
          tags?: string;
          tagsMatch?: string;
          maxTokens?: number;
          refreshAfterConsolidation?: boolean;
          mode?: string;
          saveTemplate?: boolean;
          hindsightUrl?: string;
          apiKey?: string;
        },
      ) => {
        await runMentalModelCommand({
          action: "update",
          id,
          dryRun: Boolean(opts.dryRun),
          saveTemplate: Boolean(opts.saveTemplate),
          ...(opts.name !== undefined ? { name: opts.name } : {}),
          ...(opts.sourceQuery !== undefined
            ? { sourceQuery: opts.sourceQuery }
            : {}),
          ...(opts.tags !== undefined ? { tags: opts.tags } : {}),
          ...(opts.tagsMatch !== undefined
            ? { tagsMatch: opts.tagsMatch }
            : {}),
          ...(opts.maxTokens !== undefined
            ? { maxTokens: opts.maxTokens }
            : {}),
          ...(opts.refreshAfterConsolidation
            ? { refreshAfterConsolidation: true }
            : {}),
          ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
          ...(opts.hindsightUrl !== undefined
            ? { hindsightUrl: opts.hindsightUrl }
            : {}),
          ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        });
      },
    );

  mentalModel
    .command("refresh")
    .description("Refresh one mental model, or all declared template models")
    .argument("[id]", "Mental model id (omit with --all)")
    .option("--all", "Refresh every model declared in the bank template")
    .option(
      "--dry-run",
      "Preview via Hindsight dry-run-refresh without writing content",
    )
    .option("--hindsight-url <url>", "Hindsight base URL")
    .option("--api-key <key>", "Hindsight API key")
    .action(
      async (
        id: string | undefined,
        opts: {
          all?: boolean;
          dryRun?: boolean;
          hindsightUrl?: string;
          apiKey?: string;
        },
      ) => {
        await runMentalModelCommand({
          action: "refresh",
          dryRun: Boolean(opts.dryRun),
          all: Boolean(opts.all),
          ...(id !== undefined ? { id } : {}),
          ...(opts.hindsightUrl !== undefined
            ? { hindsightUrl: opts.hindsightUrl }
            : {}),
          ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        });
      },
    );

  mentalModel
    .command("clear")
    .description(
      "Clear mental model content so the next refresh is a full re-synthesis",
    )
    .argument("<id>", "Mental model id")
    .option("--dry-run", "Show what would be cleared without calling Hindsight")
    .option("--hindsight-url <url>", "Hindsight base URL")
    .option("--api-key <key>", "Hindsight API key")
    .action(
      async (
        id: string,
        opts: { dryRun?: boolean; hindsightUrl?: string; apiKey?: string },
      ) => {
        await runMentalModelCommand({
          action: "clear",
          id,
          dryRun: Boolean(opts.dryRun),
          ...(opts.hindsightUrl !== undefined
            ? { hindsightUrl: opts.hindsightUrl }
            : {}),
          ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        });
      },
    );

  mentalModel
    .command("tags")
    .description("List bank tags for memories or mental models")
    .option(
      "--source <source>",
      "memories or mental_models (default: mental_models)",
    )
    .option("--hindsight-url <url>", "Hindsight base URL")
    .option("--api-key <key>", "Hindsight API key")
    .action(
      async (opts: {
        source?: string;
        hindsightUrl?: string;
        apiKey?: string;
      }) => {
        const source =
          opts.source === "memories" || opts.source === "mental_models"
            ? opts.source
            : "mental_models";
        await runMentalModelCommand({
          action: "tags",
          source,
          ...(opts.hindsightUrl !== undefined
            ? { hindsightUrl: opts.hindsightUrl }
            : {}),
          ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        });
      },
    );

  addJudgeCliOptions(
    program
      .command("store")
      .description(
        "Retain operator-selected durable markdown into the configured bank (preview first; reuses seed's retain path)",
      )
      .option(
        "--dry-run",
        "Print known/new/changed/unchanged buckets without calling Hindsight",
      )
      .option("--force", "Re-store selected sources even when unchanged")
      .option("--async", "Submit retain asynchronously to Hindsight")
      .option(
        "-y, --yes",
        "Store changed known files only; never adopt new files silently",
      )
      .option(
        "--files <list>",
        "Comma-separated paths to store exactly (also allowlists them)",
      )
      .option(
        "--add-files <list>",
        "Comma-separated paths to add to store.allowlist without retaining",
      )
      .option(
        "--propose-adopt",
        "With --judge jev, print new files that belong on store.allowlist. Does not retain or change the allowlist",
      )
      .option(
        "--apply",
        "With --propose-adopt, write the proposed paths onto store.allowlist. Does not retain",
      )
      .option(
        "--project <path>",
        "Project root (defaults to cwd, walking out of a disposable worktree to the durable clone)",
      )
      .option(
        "--hindsight-url <url>",
        "Hindsight base URL (default: config, ORTO_HINDSIGHT_URL, or http://localhost:8888)",
      )
      .option(
        "--api-key <key>",
        "Hindsight API key (or set ORTO_HINDSIGHT_API_KEY / HINDSIGHT_API_KEY)",
      ),
  ).action(
    async (opts: {
      dryRun?: boolean;
      force?: boolean;
      async?: boolean;
      yes?: boolean;
      files?: string;
      addFiles?: string;
      proposeAdopt?: boolean;
      apply?: boolean;
      project?: string;
      hindsightUrl?: string;
      apiKey?: string;
      judge?: string;
      confidence?: string;
      strict?: boolean;
    }) => {
      const judgeOpts = judgeOptionsFromCli(opts);
      await runStoreCommand({
        dryRun: Boolean(opts.dryRun),
        force: Boolean(opts.force),
        async: Boolean(opts.async),
        yes: Boolean(opts.yes),
        proposeAdopt: Boolean(opts.proposeAdopt),
        apply: Boolean(opts.apply),
        ...(opts.files !== undefined ? { files: opts.files } : {}),
        ...(opts.addFiles !== undefined ? { addFiles: opts.addFiles } : {}),
        ...(opts.project !== undefined ? { project: opts.project } : {}),
        ...(opts.hindsightUrl !== undefined
          ? { hindsightUrl: opts.hindsightUrl }
          : {}),
        ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        ...judgeOpts,
      });
    },
  );

  addJudgeCliOptions(
    program
      .command("audit")
      .description(
        "Write a read-only prune/refresh plan with --judge jev (no bank mutations)",
      )
      .option(
        "--dry-run",
        "Print the plan table without writing .orto/local/audit-plan.json",
      )
      .option("--limit <n>", "Maximum bank documents to judge this run")
      .option(
        "--hindsight-url <url>",
        "Hindsight base URL (default: config, ORTO_HINDSIGHT_URL, or http://localhost:8888)",
      )
      .option(
        "--api-key <key>",
        "Hindsight API key (or set ORTO_HINDSIGHT_API_KEY / HINDSIGHT_API_KEY)",
      ),
  ).action(
    async (opts: {
      dryRun?: boolean;
      limit?: string;
      hindsightUrl?: string;
      apiKey?: string;
      judge?: string;
      confidence?: string;
      strict?: boolean;
    }) => {
      const judgeOpts = judgeOptionsFromCli(opts);
      await runAuditCommand({
        dryRun: Boolean(opts.dryRun),
        ...(opts.limit !== undefined ? { limit: Number(opts.limit) } : {}),
        ...(opts.hindsightUrl !== undefined
          ? { hindsightUrl: opts.hindsightUrl }
          : {}),
        ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        ...judgeOpts,
      });
    },
  );

  addJudgeCliOptions(
    program
      .command("prune")
      .description(
        "Remove bank documents that are path-gone, section-gone, or explicitly selected",
      )
      .option(
        "--dry-run",
        "List prune candidates without deleting or writing tombstones",
      )
      .option(
        "--source <path>",
        "Limit selection to bank documents for this repo path",
      )
      .option(
        "--document-id <id>",
        "Limit selection to this Hindsight document_id",
      )
      .option(
        "-y, --yes",
        "Apply an explicit --source or --document-id selection without a second prompt",
      )
      .option(
        "--hindsight-url <url>",
        "Hindsight base URL (default: config, ORTO_HINDSIGHT_URL, or http://localhost:8888)",
      )
      .option(
        "--api-key <key>",
        "Hindsight API key (or set ORTO_HINDSIGHT_API_KEY / HINDSIGHT_API_KEY)",
      ),
  ).action(
    async (opts: {
      dryRun?: boolean;
      source?: string;
      documentId?: string;
      yes?: boolean;
      hindsightUrl?: string;
      apiKey?: string;
      judge?: string;
      confidence?: string;
      strict?: boolean;
    }) => {
      const judgeOpts = judgeOptionsFromCli(opts);
      await runPruneCommand({
        dryRun: Boolean(opts.dryRun),
        yes: Boolean(opts.yes),
        ...(opts.source !== undefined ? { source: opts.source } : {}),
        ...(opts.documentId !== undefined
          ? { documentId: opts.documentId }
          : {}),
        ...(opts.hindsightUrl !== undefined
          ? { hindsightUrl: opts.hindsightUrl }
          : {}),
        ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        ...judgeOpts,
      });
    },
  );

  program
    .command("mcp")
    .description("Emit MCP / agent config snippets for the project bank")
    .option(
      "--harness <list>",
      "Comma-separated harnesses: cursor,claude-code,claude-desktop,roo,codex,kiro,firstmate,all",
    )
    .option("--write", "Write/merge .cursor/mcp.json for the project bank")
    .option("--write-roo", "Write/merge .roo/mcp.json")
    .option("--write-kiro", "Write/merge .kiro/settings/mcp.json")
    .option(
      "--write-agents",
      "Upsert an AGENTS.md section telling agents to prefer the project bank",
    )
    .option(
      "--write-cursor-rules",
      "Write .cursor/rules/hindsight-bank.mdc (alwaysApply)",
    )
    .option(
      "--write-firstmate",
      "Install the project-bank skill + project->bank map into $FM_HOME (prints install steps if FM_HOME is unset); never writes into this product repo",
    )
    .option("--dry-run", "Preview file writes without mutating the filesystem")
    .option("--force", "Overwrite existing MCP server entry / Cursor rule / project-bank skill")
    .option(
      "--hindsight-url <url>",
      "Hindsight base URL (default: config, ORTO_HINDSIGHT_URL, or http://localhost:8888)",
    )
    .option(
      "--include-auth",
      "Include Authorization headers (env placeholders when writing files)",
    )
    .option(
      "--api-key <key>",
      "Include this API key literally in printed snippets (writes still use env placeholders)",
    )
    .option(
      "--server-name <name>",
      "MCP server name (default: hindsight-<bankId>)",
    )
    .option(
      "--check",
      "Probe the MCP endpoint with resolved auth (never prints secrets)",
    )
    .action(
      async (opts: {
        harness?: string;
        write?: boolean;
        writeRoo?: boolean;
        writeKiro?: boolean;
        writeAgents?: boolean;
        writeCursorRules?: boolean;
        writeFirstmate?: boolean;
        dryRun?: boolean;
        force?: boolean;
        hindsightUrl?: string;
        includeAuth?: boolean;
        apiKey?: string;
        serverName?: string;
        check?: boolean;
      }) => {
        const result = await runMcp({
          dryRun: Boolean(opts.dryRun),
          force: Boolean(opts.force),
          write: Boolean(opts.write),
          writeRoo: Boolean(opts.writeRoo),
          writeKiro: Boolean(opts.writeKiro),
          writeAgents: Boolean(opts.writeAgents),
          writeCursorRules: Boolean(opts.writeCursorRules),
          writeFirstmate: Boolean(opts.writeFirstmate),
          includeAuth: Boolean(opts.includeAuth),
          check: Boolean(opts.check),
          ...(opts.harness !== undefined ? { harness: opts.harness } : {}),
          ...(opts.hindsightUrl !== undefined
            ? { hindsightUrl: opts.hindsightUrl }
            : {}),
          ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
          ...(opts.serverName !== undefined
            ? { serverName: opts.serverName }
            : {}),
        });
        printMcpResult(result);
      },
    );

  const docker = program
    .command("docker")
    .description(
      "Local Hindsight Docker helper (up / down / status / print / upgrade)",
    )
    .argument(
      "[action]",
      "up|start, down|stop, status, or print (default: print)",
      "print",
    )
    .option("--dry-run", "Print the docker command without executing")
    .option(
      "--name <name>",
      "Container name (default: config docker.containerName, or hindsight)",
    )
    .option("--api-port <port>", "Host port for Hindsight API (default: 8888)")
    .option("--ui-port <port>", "Host port for Control Plane UI (default: 9999)")
    .option(
      "--image <image>",
      "Docker image (default: ghcr.io/vectorize-io/hindsight:latest)",
    )
    .option(
      "--llm-api-key <key>",
      "LLM provider API key (or OPENAI_API_KEY / HINDSIGHT_API_LLM_API_KEY)",
    )
    .option(
      "--llm-provider <name>",
      "HINDSIGHT_API_LLM_PROVIDER (openai, anthropic, ollama, …)",
    )
    .option(
      "--api-key <key>",
      "Enable tenant API auth on the container (HINDSIGHT_API_TENANT_API_KEY)",
    )
    .option("--no-pull", "Do not pass --pull always")
    .option("--no-detach", "Run attached (-it) instead of -d")
    .action(
      async (
        actionArg: string,
        opts: {
          dryRun?: boolean;
          name?: string;
          apiPort?: string;
          uiPort?: string;
          image?: string;
          llmApiKey?: string;
          llmProvider?: string;
          apiKey?: string;
          pull?: boolean;
          detach?: boolean;
        },
      ) => {
        const action = parseDockerAction(actionArg);
        const result = await runDockerHelper({
          action,
          dryRun: Boolean(opts.dryRun) || action === "print",
          pull: opts.pull !== false,
          detach: opts.detach !== false,
          ...(opts.name !== undefined ? { containerName: opts.name } : {}),
          ...(opts.apiPort !== undefined
            ? { apiPort: Number(opts.apiPort) }
            : {}),
          ...(opts.uiPort !== undefined
            ? { uiPort: Number(opts.uiPort) }
            : {}),
          ...(opts.image !== undefined ? { image: opts.image } : {}),
          ...(opts.llmApiKey !== undefined
            ? { llmApiKey: opts.llmApiKey }
            : {}),
          ...(opts.llmProvider !== undefined
            ? { llmProvider: opts.llmProvider }
            : {}),
          ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        });
        printDockerResult(result);
      },
    );

  docker
    .command("upgrade")
    .description(
      "Upgrade the local Hindsight Docker image to a pinned tag. Backs up all banks, recreates the container on the same data volume, then verifies /version and bank fact counts.",
    )
    .requiredOption(
      "--to <version>",
      "Target Hindsight image tag (pinned; e.g. 0.9.2). :latest is refused.",
    )
    .option("--dry-run", "Print backup + pull + recreate plan without mutating")
    .option(
      "--backup-dir <path>",
      "Backup directory (default: ~/hindsight-bank-backups/pre-<to>-<timestamp>/)",
    )
    .option(
      "--skip-backup",
      "Skip backups (dangerous; loud warning; default off)",
    )
    .option(
      "--force",
      "Recreate even when api_version already matches --to",
    )
    .option(
      "--all-banks",
      "Back up and validate every bank on the instance (default: on)",
      true,
    )
    .option(
      "--bank <id>",
      "Emphasize this project bank in backup notes (default: config bankId)",
    )
    .option("-y, --yes", "Skip TTY confirmation prompts")
    .option(
      "--hindsight-url <url>",
      "Hindsight base URL (default: config, ORTO_HINDSIGHT_URL, or http://localhost:8888)",
    )
    .option(
      "--api-key <key>",
      "Hindsight API key (or set ORTO_HINDSIGHT_API_KEY / HINDSIGHT_API_KEY)",
    )
    .option(
      "--name <name>",
      "Container name (default: config docker.containerName, or hindsight)",
    )
    .action(
      async (
        opts: {
          to: string;
          dryRun?: boolean;
          backupDir?: string;
          skipBackup?: boolean;
          force?: boolean;
          allBanks?: boolean;
          bank?: string;
          yes?: boolean;
          hindsightUrl?: string;
          apiKey?: string;
          name?: string;
        },
        command: Command,
      ) => {
        const merged = command.optsWithGlobals() as typeof opts;
        const result = await runDockerUpgrade({
          to: merged.to,
          dryRun: Boolean(merged.dryRun),
          skipBackup: Boolean(merged.skipBackup),
          force: Boolean(merged.force),
          allBanks: merged.allBanks !== false,
          yes: Boolean(merged.yes),
          ...(merged.backupDir !== undefined
            ? { backupDir: merged.backupDir }
            : {}),
          ...(merged.bank !== undefined ? { bank: merged.bank } : {}),
          ...(merged.hindsightUrl !== undefined
            ? { hindsightUrl: merged.hindsightUrl }
            : {}),
          ...(merged.apiKey !== undefined ? { apiKey: merged.apiKey } : {}),
          ...(merged.name !== undefined ? { containerName: merged.name } : {}),
        });
        printDockerUpgradeResult(result);
      },
    );

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
