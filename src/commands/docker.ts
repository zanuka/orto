import { loadConfig, loadShareConfig } from "../config/load.js";
import { resolveDeploymentProfile } from "../config/connection.js";
import { defaultVolumeName, type DockerConfig } from "../config/schema.js";
import { detectProjectRoot } from "../project/detect-root.js";
import {
  assertDockerAvailable,
  buildDockerStopPlan,
  buildDockerUpPlan,
  getContainerStatus,
  resolveLlmApiKey,
  resolveLlmApiKeyDisplay,
  runDockerCommand,
  DEFAULT_CONTAINER_NAME,
  DEFAULT_VOLUME_NAME,
} from "../docker/hindsight.js";
import { OrtoError } from "../utils/errors.js";

export type DockerAction = "up" | "down" | "status" | "print";

export interface DockerCommandOptions {
  action?: DockerAction;
  dryRun?: boolean;
  cwd?: string;
  containerName?: string;
  volumeName?: string;
  apiPort?: number;
  uiPort?: number;
  image?: string;
  llmApiKey?: string;
  llmProvider?: string;
  llmModel?: string;
  llmBaseUrl?: string;
  reflectLlmProvider?: string;
  reflectLlmModel?: string;
  reflectLlmBaseUrl?: string;
  apiKey?: string;
  pull?: boolean;
  detach?: boolean;
}

export interface DockerCommandResult {
  action: DockerAction;
  dryRun: boolean;
  display: string;
  containerName: string;
  apiUrl: string;
  uiUrl: string;
  envHints: string[];
  statusLine?: string;
  executed: boolean;
}

export interface ResolvedDockerSettings {
  containerName: string;
  volumeName: string;
  llmProvider?: string;
  llmModel?: string;
  llmBaseUrl?: string;
  reflectLlmProvider?: string;
  reflectLlmModel?: string;
  reflectLlmBaseUrl?: string;
}

export async function resolveDockerSettings(options: {
  cwd?: string;
  containerName?: string;
  volumeName?: string;
  llmProvider?: string;
  llmModel?: string;
  llmBaseUrl?: string;
  reflectLlmProvider?: string;
  reflectLlmModel?: string;
  reflectLlmBaseUrl?: string;
}): Promise<ResolvedDockerSettings> {
  let configDocker: DockerConfig | undefined;

  try {
    const projectRoot = await detectProjectRoot(options.cwd ?? process.cwd());
    const config = await loadConfig(projectRoot);
    configDocker = config.docker;
  } catch {
  }

  const containerName =
    options.containerName ??
    configDocker?.containerName ??
    DEFAULT_CONTAINER_NAME;
  const volumeName =
    options.volumeName ??
    (options.containerName !== undefined
      ? defaultVolumeName(containerName)
      : configDocker?.volumeName ??
        (configDocker?.containerName
          ? defaultVolumeName(containerName)
          : DEFAULT_VOLUME_NAME));

  const llmProvider = options.llmProvider ?? configDocker?.llmProvider;
  const llmModel = options.llmModel ?? configDocker?.llmModel;
  const llmBaseUrl = options.llmBaseUrl ?? configDocker?.llmBaseUrl;
  const reflectLlmProvider =
    options.reflectLlmProvider ?? configDocker?.reflectLlmProvider;
  const reflectLlmModel =
    options.reflectLlmModel ?? configDocker?.reflectLlmModel;
  const reflectLlmBaseUrl =
    options.reflectLlmBaseUrl ?? configDocker?.reflectLlmBaseUrl;

  return {
    containerName,
    volumeName,
    ...(llmProvider !== undefined ? { llmProvider } : {}),
    ...(llmModel !== undefined ? { llmModel } : {}),
    ...(llmBaseUrl !== undefined ? { llmBaseUrl } : {}),
    ...(reflectLlmProvider !== undefined ? { reflectLlmProvider } : {}),
    ...(reflectLlmModel !== undefined ? { reflectLlmModel } : {}),
    ...(reflectLlmBaseUrl !== undefined ? { reflectLlmBaseUrl } : {}),
  };
}

export async function resolveDockerNames(options: {
  cwd?: string;
  containerName?: string;
  volumeName?: string;
}): Promise<{ containerName: string; volumeName: string }> {
  const { containerName, volumeName } = await resolveDockerSettings(options);
  return { containerName, volumeName };
}

export async function runDockerHelper(
  options: DockerCommandOptions = {},
): Promise<DockerCommandResult> {
  const action = options.action ?? "print";
  const dryRun = options.dryRun ?? action === "print";

  {
    try {
      const projectRoot = await detectProjectRoot(options.cwd ?? process.cwd());
      const config = await loadConfig(projectRoot);
      const share = await loadShareConfig(projectRoot);
      const profile = resolveDeploymentProfile({ config, share });
      if (profile === "hindsight-cloud") {
        throw new OrtoError(
          "Deployment profile is hindsight-cloud: no local Docker container",
          "Skip `orto docker`. Set ORTO_HINDSIGHT_URL=https://api.hindsight.vectorize.io and ORTO_HINDSIGHT_API_KEY, then use seed/mcp against Cloud. See docs/hindsight-cloud.md.",
        );
      }
    } catch (error) {
      if (
        error instanceof OrtoError &&
        error.message.startsWith("Deployment profile is hindsight-cloud")
      ) {
        throw error;
      }
    }
  }

  const {
    containerName,
    volumeName,
    llmProvider,
    llmModel,
    llmBaseUrl,
    reflectLlmProvider,
    reflectLlmModel,
    reflectLlmBaseUrl,
  } = await resolveDockerSettings({
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.containerName !== undefined
      ? { containerName: options.containerName }
      : {}),
    ...(options.volumeName !== undefined
      ? { volumeName: options.volumeName }
      : {}),
    ...(options.llmProvider !== undefined
      ? { llmProvider: options.llmProvider }
      : {}),
    ...(options.llmModel !== undefined ? { llmModel: options.llmModel } : {}),
    ...(options.llmBaseUrl !== undefined
      ? { llmBaseUrl: options.llmBaseUrl }
      : {}),
    ...(options.reflectLlmProvider !== undefined
      ? { reflectLlmProvider: options.reflectLlmProvider }
      : {}),
    ...(options.reflectLlmModel !== undefined
      ? { reflectLlmModel: options.reflectLlmModel }
      : {}),
    ...(options.reflectLlmBaseUrl !== undefined
      ? { reflectLlmBaseUrl: options.reflectLlmBaseUrl }
      : {}),
  });
  const llmApiKey = options.llmApiKey ?? resolveLlmApiKey();
  const llmKeyDisplay =
    options.llmApiKey !== undefined
      ? "$HINDSIGHT_API_LLM_API_KEY"
      : resolveLlmApiKeyDisplay();

  if (action === "status") {
    if (!dryRun) {
      await assertDockerAvailable();
    }
    const status = dryRun
      ? {
          exists: false,
          running: false,
          statusLine: `[dry-run] Would query docker ps for "${containerName}"`,
        }
      : await getContainerStatus(containerName);

    return {
      action,
      dryRun,
      display: `docker ps -a --filter name=^/${containerName}$`,
      containerName,
      apiUrl: `http://localhost:${options.apiPort ?? 8888}`,
      uiUrl: `http://localhost:${options.uiPort ?? 9999}`,
      envHints: [],
      statusLine: status.statusLine,
      executed: !dryRun,
    };
  }

  if (action === "down") {
    const plan = buildDockerStopPlan(containerName);
    if (!dryRun) {
      await assertDockerAvailable();
      await runDockerCommand(plan.argv, { allowFailure: true });
    }
    return {
      action,
      dryRun,
      display: plan.display,
      containerName: plan.containerName,
      apiUrl: plan.apiUrl,
      uiUrl: plan.uiUrl,
      envHints: [],
      executed: !dryRun,
    };
  }

  if (action === "up" || action === "print") {
    const plan = buildDockerUpPlan({
      containerName,
      volumeName,
      ...(options.image !== undefined ? { image: options.image } : {}),
      ...(options.apiPort !== undefined ? { apiPort: options.apiPort } : {}),
      ...(options.uiPort !== undefined ? { uiPort: options.uiPort } : {}),
      ...(llmApiKey !== undefined ? { llmApiKey } : {}),
      ...(llmKeyDisplay !== undefined ? { llmKeyDisplay } : {}),
      ...(llmProvider !== undefined ? { llmProvider } : {}),
      ...(llmModel !== undefined ? { llmModel } : {}),
      ...(llmBaseUrl !== undefined ? { llmBaseUrl } : {}),
      ...(reflectLlmProvider !== undefined ? { reflectLlmProvider } : {}),
      ...(reflectLlmModel !== undefined ? { reflectLlmModel } : {}),
      ...(reflectLlmBaseUrl !== undefined ? { reflectLlmBaseUrl } : {}),
      ...(options.apiKey !== undefined
        ? {
            tenantApiKey: options.apiKey,
            tenantKeyDisplay: "$ORTO_HINDSIGHT_API_KEY",
          }
        : {}),
      pull: options.pull ?? true,
      detach: options.detach ?? true,
    });

    if (action === "up" && !dryRun) {
      await assertDockerAvailable();
      const existing = await getContainerStatus(containerName);
      if (existing.exists) {
        throw new OrtoError(
          `Container "${containerName}" already exists (${existing.statusLine})`,
          existing.running
            ? "Hindsight may already be running. Use `orto docker status`, or `orto docker down` then `up` again."
            : "Run `orto docker down` to remove it, then `orto docker up` again.",
        );
      }
      await runDockerCommand(plan.argv);
    }

    return {
      action: action === "print" ? "print" : "up",
      dryRun: dryRun || action === "print",
      display: plan.display,
      containerName: plan.containerName,
      apiUrl: plan.apiUrl,
      uiUrl: plan.uiUrl,
      envHints: plan.envHints,
      executed: action === "up" && !dryRun,
    };
  }

  throw new OrtoError(
    `Unknown docker action "${String(action)}"`,
    "Use: up, down, status, or print.",
  );
}

export function printDockerResult(result: DockerCommandResult): void {
  const prefix = result.dryRun && result.action !== "status" ? "[dry-run] " : "";

  if (result.action === "status") {
    console.log(result.statusLine ?? "No status.");
    console.log(`API: ${result.apiUrl}`);
    console.log(`UI:  ${result.uiUrl}`);
    return;
  }

  if (result.action === "down") {
    console.log(`${prefix}${result.executed ? "Stopped" : "Would stop"} container: ${result.containerName}`);
    console.log(`${prefix}Command: ${result.display}`);
    return;
  }

  console.log(`${prefix}Local Hindsight container: ${result.containerName}`);
  console.log(`${prefix}Command:`);
  console.log(result.display);
  console.log("");
  console.log(`${prefix}API: ${result.apiUrl}`);
  console.log(`${prefix}UI:  ${result.uiUrl}`);
  for (const hint of result.envHints) {
    console.log(`Note: ${hint}`);
  }
  if (result.executed) {
    console.log("");
    console.log("Next: import your bank template, then `orto seed --dry-run` / `orto seed`.");
    console.log("Wire agents with `orto mcp` (add --write for .cursor/mcp.json).");
  } else if (result.action === "print" || result.dryRun) {
    console.log("");
    console.log("Run without --dry-run: `orto docker up` (requires Docker).");
  }
}

export function parseDockerAction(raw: string | undefined): DockerAction {
  const value = (raw ?? "print").toLowerCase();
  if (
    value === "up" ||
    value === "down" ||
    value === "status" ||
    value === "print" ||
    value === "start" ||
    value === "stop"
  ) {
    if (value === "start") return "up";
    if (value === "stop") return "down";
    return value;
  }
  throw new OrtoError(
    `Unknown docker action "${raw}"`,
    "Use: up (start), down (stop), status, or print.",
  );
}
