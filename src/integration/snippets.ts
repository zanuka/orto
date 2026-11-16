import { buildNeedsBankPolicyNotes } from "./needs-bank-policy.js";
import { buildSingleBankMcpUrl, defaultMcpServerName } from "./mcp-url.js";

export type McpHarness =
  | "cursor"
  | "claude-code"
  | "claude-desktop"
  | "roo"
  | "codex"
  | "pi"
  | "kiro"
  | "firstmate";

export const ALL_HARNESSES: readonly McpHarness[] = [
  "cursor",
  "claude-code",
  "claude-desktop",
  "roo",
  "codex",
  "pi",
  "kiro",
  "firstmate",
] as const;

export interface McpSnippetInput {
  baseUrl: string;
  bankId: string;
  projectName: string;
  serverName?: string;
  mcpUrl?: string;
  includeAuth?: boolean;
  apiKeyEnvVar?: string;
  apiKeyLiteral?: string;
}

export interface McpSnippet {
  harness: McpHarness;
  title: string;
  targetPath: string;
  format: "json" | "toml" | "shell";
  body: string;
  notes: string[];
}

const DEFAULT_API_KEY_ENV = "ORTO_HINDSIGHT_API_KEY";

export function parseHarnessList(raw: string | undefined): McpHarness[] {
  if (!raw || raw.trim() === "" || raw.trim().toLowerCase() === "all") {
    return [...ALL_HARNESSES];
  }
  const parts = raw.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
  const out: McpHarness[] = [];
  for (const part of parts) {
    if (!isMcpHarness(part)) {
      throw new Error(
        `Unknown harness "${part}". Use: ${ALL_HARNESSES.join(", ")}, or all.`,
      );
    }
    if (!out.includes(part)) {
      out.push(part);
    }
  }
  return out;
}

function isMcpHarness(value: string): value is McpHarness {
  return (ALL_HARNESSES as readonly string[]).includes(value);
}

export function generateMcpSnippets(input: McpSnippetInput): McpSnippet[] {
  const mcpUrl =
    input.mcpUrl ?? buildSingleBankMcpUrl(input.baseUrl, input.bankId);
  const serverName = input.serverName ?? defaultMcpServerName(input.bankId);
  const headers = buildHeaders(input);
  const cursorHeaders = buildCursorHeaders(input);

  return [
    {
      harness: "cursor",
      title: "Cursor",
      targetPath: ".cursor/mcp.json",
      format: "json",
      body: JSON.stringify(
        {
          mcpServers: {
            [serverName]: {
              url: mcpUrl,
              ...(cursorHeaders ? { headers: cursorHeaders } : {}),
            },
          },
        },
        null,
        2,
      ),
      notes: [
        "Project file: .cursor/mcp.json (merge with existing servers if present).",
        "Reload MCP servers in Cursor Settings after writing.",
        "API keys must be in the Cursor process environment (login shell / desktop env), not only an integrated terminal.",
        "Accepted env vars: ORTO_HINDSIGHT_API_KEY or HINDSIGHT_API_KEY.",
        ...buildNeedsBankPolicyNotes(),
      ],
    },
    {
      harness: "claude-code",
      title: "Claude Code",
      targetPath: "(claude mcp add)",
      format: "shell",
      body: buildClaudeCodeCommand(serverName, mcpUrl, headers),
      notes: [
        "Runs `claude mcp add` for the current project/user scope.",
        "Single-bank URL pins tools to this project's bank.",
        ...buildNeedsBankPolicyNotes(),
      ],
    },
    {
      harness: "claude-desktop",
      title: "Claude Desktop",
      targetPath: "~/.claude_desktop_config.json",
      format: "json",
      body: JSON.stringify(
        {
          mcpServers: {
            [serverName]: {
              url: mcpUrl,
              ...(headers ? { headers } : {}),
            },
          },
        },
        null,
        2,
      ),
      notes: ["Merge into ~/.claude_desktop_config.json under mcpServers."],
    },
    {
      harness: "roo",
      title: "Roo Code",
      targetPath: ".roo/mcp.json",
      format: "json",
      body: JSON.stringify(
        {
          mcpServers: {
            [serverName]: {
              type: "streamable-http",
              url: mcpUrl,
              ...(headers ? { headers } : {}),
            },
          },
        },
        null,
        2,
      ),
      notes: [
        "Project file: .roo/mcp.json (or Edit Project MCP in Roo).",
        'Roo requires type: "streamable-http" for remote HTTP MCP.',
      ],
    },
    {
      harness: "codex",
      title: "Codex CLI",
      targetPath: ".codex/config.toml",
      format: "toml",
      body: buildCodexToml(serverName, mcpUrl, input),
      notes: [
        "Append to ~/.codex/config.toml or project .codex/config.toml.",
        "Codex uses mcp_servers (underscore) and bearer_token_env_var for auth.",
        ...buildNeedsBankPolicyNotes(),
      ],
    },
    {
      harness: "pi",
      title: "Pi",
      targetPath: "(pi mcp add -l)",
      format: "shell",
      body: buildPiCommand(serverName, mcpUrl, input),
      notes: [
        "Runs `pi mcp add -l` for project-local MCP config (see https://pi.dev/docs/latest/mcp).",
        "Single-bank URL pins tools to this project's bank.",
        ...buildNeedsBankPolicyNotes(),
      ],
    },
    {
      harness: "kiro",
      title: "Kiro",
      targetPath: ".kiro/settings/mcp.json",
      format: "json",
      body: JSON.stringify(
        {
          mcpServers: {
            [serverName]: {
              url: mcpUrl,
              ...(headers ? { headers } : {}),
            },
          },
        },
        null,
        2,
      ),
      notes: [
        "Workspace: .kiro/settings/mcp.json or ~/.kiro/settings/mcp.json.",
        ...buildNeedsBankPolicyNotes(),
      ],
    },
    {
      harness: "firstmate",
      title: "Firstmate",
      targetPath: "(claude mcp add, run from the Firstmate home)",
      format: "shell",
      body: buildFirstmateCommand(serverName, mcpUrl, headers),
      notes: [
        "Optional multi-agent captain workflow. Print-only: run this from the Firstmate home, not from this product repo.",
        "Captain-only: do not wire scouts or ships to this MCP server.",
        "Do not write MCP config into this product repo.",
        "Register this git project in Firstmate separately (this snippet only wires the MCP server).",
        ...buildNeedsBankPolicyNotes(),
      ],
    },
  ];
}

function buildHeaders(
  input: McpSnippetInput,
): Record<string, string> | undefined {
  if (!input.includeAuth) {
    return undefined;
  }
  const envVar = input.apiKeyEnvVar ?? DEFAULT_API_KEY_ENV;
  const value =
    input.apiKeyLiteral !== undefined
      ? `Bearer ${input.apiKeyLiteral}`
      : `Bearer \${${envVar}}`;
  return { Authorization: value };
}

function buildCursorHeaders(
  input: McpSnippetInput,
): Record<string, string> | undefined {
  if (!input.includeAuth) {
    return undefined;
  }
  const envVar = input.apiKeyEnvVar ?? DEFAULT_API_KEY_ENV;
  const value =
    input.apiKeyLiteral !== undefined
      ? `Bearer ${input.apiKeyLiteral}`
      : `Bearer \${env:${envVar}}`;
  return { Authorization: value };
}

function buildClaudeCodeCommand(
  serverName: string,
  mcpUrl: string,
  headers: Record<string, string> | undefined,
): string {
  const parts = [
    "claude",
    "mcp",
    "add",
    "--transport",
    "http",
    serverName,
    mcpUrl,
  ];
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      parts.push("--header", `"${key}: ${value}"`);
    }
  }
  return parts.join(" ");
}

function buildFirstmateCommand(
  serverName: string,
  mcpUrl: string,
  headers: Record<string, string> | undefined,
): string {
  const claudeParts = [
    "claude",
    "mcp",
    "add",
    "--transport",
    "http",
    serverName,
    mcpUrl,
  ];
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      claudeParts.push("--header", `"${key}: ${value}"`);
    }
  }
  return ["cd \"$FIRSTMATE_HOME\"", claudeParts.join(" ")].join("\n");
}

function buildPiCommand(
  serverName: string,
  mcpUrl: string,
  input: McpSnippetInput,
): string {
  const parts = ["pi", "mcp", "add", "-l", serverName, "--url", mcpUrl];
  if (input.includeAuth) {
    const envVar = input.apiKeyEnvVar ?? DEFAULT_API_KEY_ENV;
    parts.push("--bearer-token-env-var", envVar);
  }
  return parts.join(" ");
}

function buildCodexToml(
  serverName: string,
  mcpUrl: string,
  input: McpSnippetInput,
): string {
  const lines = [
    `[mcp_servers.${serverName}]`,
    `url = "${mcpUrl}"`,
  ];
  if (input.includeAuth) {
    const envVar = input.apiKeyEnvVar ?? DEFAULT_API_KEY_ENV;
    if (input.apiKeyLiteral !== undefined) {
      lines.push(
        `http_headers = { Authorization = "Bearer ${escapeToml(
          input.apiKeyLiteral,
        )}" }`,
      );
    } else {
      lines.push(`bearer_token_env_var = "${envVar}"`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function escapeToml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function filterSnippets(
  snippets: McpSnippet[],
  harnesses: McpHarness[],
): McpSnippet[] {
  const set = new Set(harnesses);
  return snippets.filter((s) => set.has(s.harness));
}
