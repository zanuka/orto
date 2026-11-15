import { loadConfig, loadShareConfig } from "../config/load.js";
import {
  assertApiKeyForConnection,
  resolveProjectConnection,
} from "../config/connection.js";
import { resolveHindsightApiKey } from "../providers/hindsight/client.js";
import { detectProjectRoot } from "../project/detect-root.js";
import {
  filterSnippets,
  generateMcpSnippets,
  parseHarnessList,
  type McpHarness,
  type McpSnippet,
} from "../integration/snippets.js";
import { checkMcpConnectivity } from "../integration/mcp-check.js";
import {
  cursorBankRulePath,
  cursorMcpPath,
  kiroMcpPath,
  rooMcpPath,
  writeAgentsPreference,
  writeCursorBankRule,
  writeMergedMcpJson,
} from "../integration/write.js";
import {
  installFirstmateProjectBank,
  type InstallProjectBankSkillResult,
} from "../integration/project-bank-skill.js";
import { OrtoError } from "../utils/errors.js";

export interface McpOptions {
  cwd?: string;
  dryRun?: boolean;
  force?: boolean;
  write?: boolean;
  writeAgents?: boolean;
  writeCursorRules?: boolean;
  writeRoo?: boolean;
  writeKiro?: boolean;
  writeFirstmate?: boolean;
  harness?: string;
  hindsightUrl?: string;
  apiKey?: string;
  includeAuth?: boolean;
  serverName?: string;
  check?: boolean;
}

export interface McpResult {
  projectRoot: string;
  bankId: string;
  baseUrl: string;
  mcpUrl: string;
  serverName: string;
  profile: string;
  snippets: McpSnippet[];
  dryRun: boolean;
  writes: Array<{
    path: string;
    wrote: boolean;
    dryRun: boolean;
    preview?: string;
  }>;
  firstmateSkill?: InstallProjectBankSkillResult;
  check?: { ok: boolean; status: number; detail: string };
}

export async function runMcp(options: McpOptions = {}): Promise<McpResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;
  const write = options.write ?? false;
  const writeAgents = options.writeAgents ?? false;
  const writeCursorRules = options.writeCursorRules ?? false;
  const writeRoo = options.writeRoo ?? false;
  const writeKiro = options.writeKiro ?? false;
  const writeFirstmate = options.writeFirstmate ?? false;
  const check = options.check ?? false;

  if (
    dryRun &&
    !write &&
    !writeAgents &&
    !writeCursorRules &&
    !writeRoo &&
    !writeKiro &&
    !writeFirstmate
  ) {
    throw new OrtoError(
      "--dry-run only applies when writing files",
      "Use --write, --write-agents, --write-cursor-rules, --write-roo, --write-kiro, and/or --write-firstmate with --dry-run to preview.",
    );
  }

  let harnesses: McpHarness[];
  try {
    harnesses = parseHarnessList(options.harness);
  } catch (error) {
    throw new OrtoError(
      error instanceof Error ? error.message : String(error),
      `Pass --harness cursor,claude-code or omit for all.`,
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
    ...(options.serverName !== undefined
      ? { serverName: options.serverName }
      : {}),
  });
  const apiKey = resolveHindsightApiKey({
    ...(options.apiKey !== undefined ? { cliKey: options.apiKey } : {}),
  });
  if (connection.requiresApiKey && (options.includeAuth || check)) {
    assertApiKeyForConnection({ connection, ...(apiKey ? { apiKey } : {}) });
  }

  const includeAuth =
    options.includeAuth === true ||
    options.apiKey !== undefined ||
    connection.profile === "hindsight-cloud";

  const snippetInput = {
    baseUrl: connection.baseUrl,
    bankId: config.bankId,
    projectName: config.name,
    serverName: connection.serverName,
    mcpUrl: connection.mcpUrl,
    includeAuth:
      includeAuth &&
      !(connection.profile === "hindsight-cloud" && connection.mcpAuth === "oauth"),
  };

  const printSnippets = generateMcpSnippets({
    ...snippetInput,
    ...(options.apiKey !== undefined ? { apiKeyLiteral: options.apiKey } : {}),
  });

  const writeSnippets = generateMcpSnippets(snippetInput);

  const snippets = filterSnippets(printSnippets, harnesses);
  const writes: McpResult["writes"] = [];

  if (write) {
    const cursor = writeSnippets.find((s) => s.harness === "cursor");
    if (!cursor) {
      throw new OrtoError("Internal error: missing Cursor snippet");
    }
    writes.push(
      await writeMergedMcpJson(cursorMcpPath(projectRoot), cursor, {
        dryRun,
        force,
      }),
    );
  }

  if (writeRoo) {
    const roo = writeSnippets.find((s) => s.harness === "roo");
    if (!roo) {
      throw new OrtoError("Internal error: missing Roo snippet");
    }
    writes.push(
      await writeMergedMcpJson(rooMcpPath(projectRoot), roo, {
        dryRun,
        force,
      }),
    );
  }

  if (writeKiro) {
    const kiro = writeSnippets.find((s) => s.harness === "kiro");
    if (!kiro) {
      throw new OrtoError("Internal error: missing Kiro snippet");
    }
    writes.push(
      await writeMergedMcpJson(kiroMcpPath(projectRoot), kiro, {
        dryRun,
        force,
      }),
    );
  }

  if (writeAgents) {
    const agents = await writeAgentsPreference(
      projectRoot,
      {
        projectName: config.name,
        bankId: config.bankId,
        baseUrl: connection.baseUrl,
      },
      { dryRun },
    );
    writes.push({
      path: agents.path,
      wrote: agents.wrote,
      dryRun: agents.dryRun,
      ...(dryRun ? { preview: agents.preview } : {}),
    });
  }

  if (writeCursorRules) {
    const rule = await writeCursorBankRule(
      projectRoot,
      {
        projectName: config.name,
        bankId: config.bankId,
        baseUrl: connection.baseUrl,
      },
      { dryRun, force },
    );
    writes.push({
      path: rule.path,
      wrote: rule.wrote,
      dryRun: rule.dryRun,
      ...(dryRun ? { preview: rule.content } : {}),
    });
  }

  let firstmateSkill: InstallProjectBankSkillResult | undefined;
  if (writeFirstmate) {
    firstmateSkill = await installFirstmateProjectBank({
      projectRoot,
      bankId: config.bankId,
      hindsightBaseUrl: connection.baseUrl,
      dryRun,
      force,
    });
  }

  let checkResult: McpResult["check"];
  if (check) {
    checkResult = await checkMcpConnectivity({
      mcpUrl: connection.mcpUrl,
      ...(apiKey !== undefined ? { apiKey } : {}),
    });
  }

  return {
    projectRoot,
    bankId: config.bankId,
    baseUrl: connection.baseUrl,
    mcpUrl: connection.mcpUrl,
    serverName: connection.serverName,
    profile: connection.profile,
    snippets,
    dryRun,
    writes,
    ...(firstmateSkill !== undefined ? { firstmateSkill } : {}),
    ...(checkResult !== undefined ? { check: checkResult } : {}),
  };
}

export function printMcpResult(result: McpResult): void {
  console.log(`Project bank: ${result.bankId}`);
  console.log(`Profile:      ${result.profile}`);
  console.log(`Hindsight:    ${result.baseUrl}`);
  console.log(`MCP URL:      ${result.mcpUrl}`);
  console.log(`Server name:  ${result.serverName}`);
  console.log("");

  if (result.check) {
    const label = result.check.ok ? "ok" : "failed";
    console.log(`MCP check: ${label} (HTTP ${result.check.status})`);
    console.log(result.check.detail);
    console.log("");
  }

  for (const snippet of result.snippets) {
    console.log(`--- ${snippet.title} → ${snippet.targetPath} ---`);
    for (const note of snippet.notes) {
      console.log(`# ${note}`);
    }
    console.log(snippet.body.trimEnd());
    console.log("");
  }

  if (result.firstmateSkill) {
    const prefix = result.dryRun ? "[dry-run] " : "";
    const skill = result.firstmateSkill;
    if (skill.printOnly) {
      console.log("$FM_HOME is not set: printing install steps instead of writing.");
      console.log("Run this from the Firstmate home (or with FM_HOME set):");
      console.log(`  mkdir -p "$FM_HOME/.agents/skills/project-bank"`);
      console.log(
        `  # write the project-bank skill (see docs/firstmate/project-bank/SKILL.md in this repo) to`,
      );
      console.log(`  # $FM_HOME/.agents/skills/project-bank/SKILL.md`);
      console.log(
        `  # then record { "${result.projectRoot}": { "bankId": "${result.bankId}", "hindsightBaseUrl": "${result.baseUrl}" } }`,
      );
      console.log(`  # under "projects" in $FM_HOME/.orto/projects.json`);
    } else {
      const verb = result.dryRun ? "Would write" : "Wrote";
      console.log(`${prefix}${verb}: ${skill.skillPath}`);
      console.log(`${prefix}${verb}: ${skill.registryPath}`);
    }
    console.log("");
  }

  if (result.writes.length > 0) {
    const prefix = result.dryRun ? "[dry-run] " : "";
    for (const w of result.writes) {
      const verb = result.dryRun ? "Would write" : "Wrote";
      console.log(`${prefix}${verb}: ${w.path}`);
      if (result.dryRun && w.preview) {
        console.log("--- preview ---");
        console.log(w.preview.trimEnd());
        console.log("--- /preview ---");
      }
    }
    if (result.dryRun) {
      console.log("No files were written.");
    }
  } else if (!result.firstmateSkill && !result.check) {
    console.log(
      "Tip: `orto mcp --write` writes .cursor/mcp.json; add --write-agents / --write-cursor-rules for agent preference text.",
    );
    console.log(
      "Use --include-auth to add Authorization headers (env placeholders when writing files).",
    );
    console.log(
      "Default server name is bank-scoped (hindsight-<bankId>); override with --server-name.",
    );
  }
}

export { cursorBankRulePath, cursorMcpPath };
