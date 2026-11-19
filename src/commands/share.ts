import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadConfig,
  loadShareConfig,
  saveConfig,
  saveShareConfig,
} from "../config/load.js";
import { resolveProjectConnection } from "../config/connection.js";
import { sharePath } from "../config/paths.js";
import {
  createShareConfig,
  parseDeploymentProfile,
  profileSecurityNotes,
  type DeploymentProfile,
  type McpAuthMode,
  MCP_AUTH_MODES,
} from "../config/profiles.js";
import { detectProjectRoot } from "../project/detect-root.js";
import {
  formatShareSafetyLines,
  judgeShareSafety,
  type ShareSafetyDecision,
} from "../judge/share-safety.js";
import type { Judge, JudgeId } from "../judge/types.js";
import { OrtoError } from "../utils/errors.js";

export interface ShareOptions {
  cwd?: string;
  dryRun?: boolean;
  validate?: boolean;
  profile?: string;
  baseUrl?: string;
  mcpAuth?: string;
  judge?: Judge;
  judgeId?: JudgeId;
  confidence?: number;
  safetyText?: string;
}

export interface ShareResult {
  projectRoot: string;
  sharePath: string;
  dryRun: boolean;
  validateOnly: boolean;
  wrote: boolean;
  profile: DeploymentProfile;
  baseUrl: string;
  mcpUrl: string;
  serverName: string;
  mcpAuth: McpAuthMode;
  securityNotes: string[];
  share: ReturnType<typeof createShareConfig> | null;
  shareSafety?: ShareSafetyDecision;
}

function parseMcpAuth(value: string | undefined): McpAuthMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!(MCP_AUTH_MODES as readonly string[]).includes(normalized)) {
    throw new OrtoError(
      `Unknown mcp auth mode "${value}"`,
      `Use one of: ${MCP_AUTH_MODES.join(", ")}.`,
    );
  }
  return normalized as McpAuthMode;
}

export async function runShare(options: ShareOptions = {}): Promise<ShareResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const validateOnly = options.validate ?? false;
  const projectRoot = await detectProjectRoot(cwd);
  const config = await loadConfig(projectRoot);
  const existingShare = await loadShareConfig(projectRoot);
  const path = sharePath(projectRoot);

  let share = existingShare;
  let wrote = false;
  let shareSafety: ShareSafetyDecision | undefined;

  const resolvedProfile = parseDeploymentProfile(
    options.profile ?? existingShare?.profile ?? config.deploymentProfile ?? "local",
  );
  if (
    options.judgeId === "jev" &&
    (resolvedProfile === "public" || resolvedProfile === "hindsight-cloud")
  ) {
    const text =
      options.safetyText ?? (await loadShareSafetyExcerpt(projectRoot));
    shareSafety = await judgeShareSafety({
      text,
      ...(options.judge !== undefined ? { judge: options.judge } : {}),
      confidence: options.confidence ?? 0.8,
    });
    if (!shareSafety.allowPublic) {
      throw new OrtoError(
        `Refusing ${resolvedProfile} share: ${shareSafety.reason}`,
        "Orto applies the profile. Jev does not publish. Use --profile local or --profile vpn, or remove private hostnames from the docs.",
      );
    }
  }

  if (options.profile !== undefined || options.baseUrl !== undefined || options.mcpAuth !== undefined) {
    if (validateOnly) {
      throw new OrtoError(
        "--validate cannot be combined with generate flags",
        "Run `orto share --validate` alone, or omit --validate to write share.json.",
      );
    }
    const profile = parseDeploymentProfile(
      options.profile ??
        existingShare?.profile ??
        config.deploymentProfile ??
        "local",
    );
    const mcpAuth = parseMcpAuth(options.mcpAuth);
    share = createShareConfig({
      profile,
      ...(options.baseUrl !== undefined
        ? { baseUrl: options.baseUrl }
        : existingShare?.baseUrl !== undefined
          ? { baseUrl: existingShare.baseUrl }
          : {}),
      ...(mcpAuth !== undefined
        ? { mcpAuth }
        : existingShare?.mcpAuth !== undefined
          ? { mcpAuth: existingShare.mcpAuth }
          : {}),
    });
    await saveShareConfig(projectRoot, share, dryRun);
    const nextConfig = {
      ...config,
      deploymentProfile: profile,
      ...(profile === "hindsight-cloud"
        ? { hindsightBaseUrl: "https://api.hindsight.vectorize.io" }
        : options.baseUrl !== undefined
          ? { hindsightBaseUrl: options.baseUrl.replace(/\/+$/, "") }
          : {}),
    };
    await saveConfig(projectRoot, nextConfig, dryRun);
    wrote = !dryRun;
  } else if (validateOnly || share) {
    if (!share) {
      share = createShareConfig({
        profile: config.deploymentProfile ?? "local",
        ...(config.hindsightBaseUrl !== undefined
          ? { baseUrl: config.hindsightBaseUrl }
          : {}),
      });
    }
  } else {
    share = createShareConfig({
      profile: config.deploymentProfile ?? "local",
    });
  }

  if (!share) {
    throw new OrtoError(
      "No share profile resolved",
      "Pass --profile local|lan|vpn|public|hindsight-cloud.",
    );
  }

  const connection = resolveProjectConnection({
    config: {
      ...config,
      deploymentProfile: share.profile,
      ...(share.baseUrl !== undefined
        ? { hindsightBaseUrl: share.baseUrl }
        : {}),
    },
    share,
  });

  return {
    projectRoot,
    sharePath: path,
    dryRun,
    validateOnly,
    wrote,
    profile: connection.profile,
    baseUrl: connection.baseUrl,
    mcpUrl: connection.mcpUrl,
    serverName: connection.serverName,
    mcpAuth: connection.mcpAuth,
    securityNotes: profileSecurityNotes(connection.profile),
    share,
    ...(shareSafety !== undefined ? { shareSafety } : {}),
  };
}

export function printShareResult(result: ShareResult): void {
  const prefix = result.dryRun ? "[dry-run] " : "";
  if (result.validateOnly) {
    console.log(`${prefix}Share profile valid: ${result.profile}`);
  } else if (result.wrote || result.dryRun) {
    console.log(
      `${prefix}${result.dryRun ? "Would write" : "Wrote"} ${result.sharePath}`,
    );
    console.log(
      `${prefix}${result.dryRun ? "Would update" : "Updated"} deploymentProfile in config.json`,
    );
  } else {
    console.log(`${prefix}Active deployment profile: ${result.profile}`);
  }

  console.log(`${prefix}Base URL:    ${result.baseUrl}`);
  console.log(`${prefix}MCP URL:     ${result.mcpUrl}`);
  console.log(`${prefix}Server name: ${result.serverName}`);
  console.log(`${prefix}MCP auth:    ${result.mcpAuth}`);
  console.log("");
  if (result.shareSafety !== undefined) {
    console.log("");
    for (const line of formatShareSafetyLines({
      decision: result.shareSafety,
      dryRun: result.dryRun,
    })) {
      console.log(line);
    }
  }
  console.log("Security defaults / trade-offs:");
  for (const note of result.securityNotes) {
    console.log(`- ${note}`);
  }
  if (result.profile === "hindsight-cloud") {
    console.log("");
    console.log(
      "Cloud next steps: https://ui.hindsight.vectorize.io (org/bank/key) and https://learn.hindsight.vectorize.io/",
    );
    console.log("Skip `orto docker` under this profile.");
  }
  console.log("");
  console.log(
    "Emit agent wiring with `orto mcp --write --include-auth` (profile-aware URLs/server names).",
  );
}

async function loadShareSafetyExcerpt(root: string): Promise<string> {
  const paths = [join(root, "README.md")];
  try {
    const names = await readdir(join(root, "docs"));
    for (const name of names) {
      if (name.endsWith(".md")) {
        paths.push(join(root, "docs", name));
      }
    }
  } catch {
    void 0;
  }
  const parts: string[] = [];
  for (const path of paths) {
    try {
      parts.push(await readFile(path, "utf8"));
    } catch {
      continue;
    }
    if (parts.join("\n").length >= 8000) {
      break;
    }
  }
  return parts.join("\n").slice(0, 8000);
}
