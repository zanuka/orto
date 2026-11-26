import { spawn } from "node:child_process";
import { OrtoError } from "../utils/errors.js";

export const DEFAULT_HINDSIGHT_IMAGE = "ghcr.io/vectorize-io/hindsight:latest";
export const DEFAULT_CONTAINER_NAME = "hindsight";
export const DEFAULT_API_PORT = 8888;
export const DEFAULT_UI_PORT = 9999;
export const DEFAULT_VOLUME_NAME = "hindsight-data";

export interface DockerUpOptions {
  containerName?: string;
  image?: string;
  apiPort?: number;
  uiPort?: number;
  volumeName?: string;
  llmApiKey?: string;
  llmProvider?: string;
  llmModel?: string;
  llmBaseUrl?: string;
  reflectLlmProvider?: string;
  reflectLlmModel?: string;
  reflectLlmBaseUrl?: string;
  tenantApiKey?: string;
  pull?: boolean;
  detach?: boolean;
  llmKeyDisplay?: string;
  tenantKeyDisplay?: string;
}

export interface DockerCommandPlan {
  argv: string[];
  display: string;
  containerName: string;
  apiUrl: string;
  uiUrl: string;
  envHints: string[];
}

export function resolveLlmApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    env.HINDSIGHT_API_LLM_API_KEY?.trim() ||
    env.OPENAI_API_KEY?.trim() ||
    undefined
  );
}

export function resolveLlmApiKeyDisplay(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (env.HINDSIGHT_API_LLM_API_KEY?.trim()) {
    return "$HINDSIGHT_API_LLM_API_KEY";
  }
  if (env.OPENAI_API_KEY?.trim()) {
    return "$OPENAI_API_KEY";
  }
  return undefined;
}

export function buildDockerUpPlan(options: DockerUpOptions = {}): DockerCommandPlan {
  const containerName = options.containerName ?? DEFAULT_CONTAINER_NAME;
  const image = options.image ?? DEFAULT_HINDSIGHT_IMAGE;
  const apiPort = options.apiPort ?? DEFAULT_API_PORT;
  const uiPort = options.uiPort ?? DEFAULT_UI_PORT;
  const volumeName = options.volumeName ?? DEFAULT_VOLUME_NAME;
  const pull = options.pull ?? true;
  const detach = options.detach ?? true;

  const argv: string[] = ["docker", "run"];
  if (detach) {
    argv.push("-d");
  } else {
    argv.push("-it");
  }
  if (pull) {
    argv.push("--pull", "always");
  }
  argv.push(
    "--name",
    containerName,
    "--restart",
    "unless-stopped",
    "-p",
    `${apiPort}:8888`,
    "-p",
    `${uiPort}:9999`,
    "-v",
    `${volumeName}:/home/hindsight/.pg0`,
  );

  const displayArgv = [...argv];
  const llmKey = options.llmApiKey;
  if (llmKey) {
    argv.push("-e", `HINDSIGHT_API_LLM_API_KEY=${llmKey}`);
    const llmDisplay =
      options.llmKeyDisplay ?? "$HINDSIGHT_API_LLM_API_KEY";
    displayArgv.push("-e", `HINDSIGHT_API_LLM_API_KEY=${llmDisplay}`);
  }
  if (options.llmProvider) {
    argv.push("-e", `HINDSIGHT_API_LLM_PROVIDER=${options.llmProvider}`);
    displayArgv.push("-e", `HINDSIGHT_API_LLM_PROVIDER=${options.llmProvider}`);
  }
  if (options.llmModel) {
    argv.push("-e", `HINDSIGHT_API_LLM_MODEL=${options.llmModel}`);
    displayArgv.push("-e", `HINDSIGHT_API_LLM_MODEL=${options.llmModel}`);
  }
  if (options.llmBaseUrl) {
    argv.push("-e", `HINDSIGHT_API_LLM_BASE_URL=${options.llmBaseUrl}`);
    displayArgv.push("-e", `HINDSIGHT_API_LLM_BASE_URL=${options.llmBaseUrl}`);
  }

  const reflectLlmProvider =
    options.reflectLlmProvider ??
    (options.reflectLlmModel ? options.llmProvider : undefined);
  const reflectLlmModel = options.reflectLlmModel;
  const reflectLlmBaseUrl =
    options.reflectLlmBaseUrl ??
    (options.reflectLlmModel ? options.llmBaseUrl : undefined);

  if (reflectLlmProvider) {
    argv.push("-e", `HINDSIGHT_API_REFLECT_LLM_PROVIDER=${reflectLlmProvider}`);
    displayArgv.push(
      "-e",
      `HINDSIGHT_API_REFLECT_LLM_PROVIDER=${reflectLlmProvider}`,
    );
  }
  if (reflectLlmModel) {
    argv.push("-e", `HINDSIGHT_API_REFLECT_LLM_MODEL=${reflectLlmModel}`);
    displayArgv.push(
      "-e",
      `HINDSIGHT_API_REFLECT_LLM_MODEL=${reflectLlmModel}`,
    );
  }
  if (reflectLlmBaseUrl) {
    argv.push(
      "-e",
      `HINDSIGHT_API_REFLECT_LLM_BASE_URL=${reflectLlmBaseUrl}`,
    );
    displayArgv.push(
      "-e",
      `HINDSIGHT_API_REFLECT_LLM_BASE_URL=${reflectLlmBaseUrl}`,
    );
  }

  if (options.tenantApiKey) {
    const tenantDisplay =
      options.tenantKeyDisplay ?? "$ORTO_HINDSIGHT_API_KEY";
    const authArgs = [
      "-e",
      "HINDSIGHT_API_TENANT_EXTENSION=hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension",
      "-e",
      `HINDSIGHT_API_TENANT_API_KEY=${options.tenantApiKey}`,
      "-e",
      `HINDSIGHT_CP_DATAPLANE_API_KEY=${options.tenantApiKey}`,
      "-e",
      `HINDSIGHT_CP_ACCESS_KEY=${options.tenantApiKey}`,
    ];
    const authDisplay = [
      "-e",
      "HINDSIGHT_API_TENANT_EXTENSION=hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension",
      "-e",
      `HINDSIGHT_API_TENANT_API_KEY=${tenantDisplay}`,
      "-e",
      `HINDSIGHT_CP_DATAPLANE_API_KEY=${tenantDisplay}`,
      "-e",
      `HINDSIGHT_CP_ACCESS_KEY=${tenantDisplay}`,
    ];
    argv.push(...authArgs);
    displayArgv.push(...authDisplay);
  }

  argv.push(image);
  displayArgv.push(image);

  const envHints: string[] = [];
  if (!llmKey) {
    envHints.push(
      "No LLM API key set. Pass --llm-api-key or set OPENAI_API_KEY / HINDSIGHT_API_LLM_API_KEY so Hindsight can extract memories.",
    );
  }
  if (options.tenantApiKey) {
    envHints.push(
      "Tenant API auth enabled. Use the same value as ORTO_HINDSIGHT_API_KEY for seed and MCP headers.",
    );
  }

  return {
    argv,
    display: formatDockerArgv(displayArgv),
    containerName,
    apiUrl: `http://localhost:${apiPort}`,
    uiUrl: `http://localhost:${uiPort}`,
    envHints,
  };
}

export function buildDockerStopPlan(containerName = DEFAULT_CONTAINER_NAME): DockerCommandPlan {
  const argv = ["docker", "rm", "-f", containerName];
  return {
    argv,
    display: formatDockerArgv(argv),
    containerName,
    apiUrl: "http://localhost:8888",
    uiUrl: "http://localhost:9999",
    envHints: [],
  };
}

export function formatDockerArgv(argv: string[]): string {
  return argv
    .map((part) => (needsShellQuotes(part) ? shellQuote(part) : part))
    .join(" ");
}

function needsShellQuotes(value: string): boolean {
  if (/^[A-Za-z_][A-Za-z0-9_]*=\$[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    return false;
  }
  return /[\s"'\\$`]/.test(value);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function assertDockerAvailable(
  run: typeof runDockerCommand = runDockerCommand,
): Promise<void> {
  const result = await run(["docker", "info"], { allowFailure: true });
  if (result.exitCode !== 0) {
    throw new OrtoError(
      "Docker is not available or the daemon is not running",
      "Install Docker Desktop (or another engine), start it, then re-run `orto docker up`. Use `--dry-run` to print the command without executing.",
    );
  }
}

export interface RunDockerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runDockerCommand(
  argv: string[],
  options: { allowFailure?: boolean } = {},
): Promise<RunDockerResult> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = argv;
    if (!cmd) {
      reject(new OrtoError("Empty docker command"));
      return;
    }
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(
        new OrtoError(
          `Failed to run ${cmd}`,
          `${error.message}. Is Docker installed and on PATH?`,
        ),
      );
    });
    child.on("close", (code) => {
      const exitCode = code ?? 1;
      if (exitCode !== 0 && !options.allowFailure) {
        reject(
          new OrtoError(
            `Command failed (${exitCode}): ${formatDockerArgv(argv)}`,
            stderr.trim() || stdout.trim() || "Check Docker output above.",
          ),
        );
        return;
      }
      resolve({ exitCode, stdout, stderr });
    });
  });
}

export async function getContainerStatus(
  containerName: string,
  run: typeof runDockerCommand = runDockerCommand,
): Promise<{
  exists: boolean;
  running: boolean;
  statusLine: string;
}> {
  const result = await run(
    [
      "docker",
      "ps",
      "-a",
      "--filter",
      `name=^/${containerName}$`,
      "--format",
      "{{.Names}}\t{{.Status}}\t{{.Ports}}",
    ],
    { allowFailure: true },
  );

  const line = result.stdout.trim().split("\n").filter(Boolean)[0];
  if (!line) {
    return {
      exists: false,
      running: false,
      statusLine: `Container "${containerName}" not found.`,
    };
  }
  const running = /\bUp\b/i.test(line);
  return {
    exists: true,
    running,
    statusLine: line,
  };
}
