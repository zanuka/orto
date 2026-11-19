import { describe, expect, it } from "vitest";
import { buildSingleBankMcpUrl } from "./mcp-url.js";
import {
  filterSnippets,
  generateMcpSnippets,
  parseHarnessList,
} from "./snippets.js";
import {
  AGENTS_BANK_BEGIN,
  buildCursorBankRule,
  upsertAgentsBankSection,
} from "./agent-rules.js";
import { mergeMcpServers } from "./write.js";

describe("buildSingleBankMcpUrl", () => {
  it("builds a trailing-slash single-bank MCP path", () => {
    expect(buildSingleBankMcpUrl("http://localhost:8888", "orto")).toBe(
      "http://localhost:8888/mcp/orto/",
    );
  });

  it("strips trailing slashes from the base URL", () => {
    expect(buildSingleBankMcpUrl("http://localhost:8888/", "bank")).toBe(
      "http://localhost:8888/mcp/bank/",
    );
  });
});

describe("generateMcpSnippets", () => {
  const input = {
    baseUrl: "http://localhost:8888",
    bankId: "orto",
    projectName: "Orto",
  };

  it("emits Cursor JSON with the single-bank URL and bank-scoped server name", () => {
    const cursor = generateMcpSnippets(input).find((s) => s.harness === "cursor");
    expect(cursor).toBeDefined();
    const parsed = JSON.parse(cursor!.body) as {
      mcpServers: { "hindsight-orto": { url: string } };
    };
    expect(parsed.mcpServers["hindsight-orto"].url).toBe(
      "http://localhost:8888/mcp/orto/",
    );
  });

  it("emits Roo with streamable-http type", () => {
    const roo = generateMcpSnippets(input).find((s) => s.harness === "roo");
    const parsed = JSON.parse(roo!.body) as {
      mcpServers: { "hindsight-orto": { type: string; url: string } };
    };
    expect(parsed.mcpServers["hindsight-orto"].type).toBe("streamable-http");
  });

  it("emits Claude Code shell with http transport", () => {
    const claude = generateMcpSnippets(input).find(
      (s) => s.harness === "claude-code",
    );
    expect(claude!.body).toContain("claude mcp add --transport http");
    expect(claude!.body).toContain("http://localhost:8888/mcp/orto/");
  });

  it("emits Codex TOML with mcp_servers", () => {
    const codex = generateMcpSnippets(input).find((s) => s.harness === "codex");
    expect(codex!.body).toContain("[mcp_servers.hindsight-orto]");
    expect(codex!.body).toContain('url = "http://localhost:8888/mcp/orto/"');
  });

  it("honors an explicit --server-name override", () => {
    const cursor = generateMcpSnippets({
      ...input,
      serverName: "custom-bank",
    }).find((s) => s.harness === "cursor");
    const parsed = JSON.parse(cursor!.body) as {
      mcpServers: { "custom-bank": { url: string } };
    };
    expect(parsed.mcpServers["custom-bank"].url).toContain("/mcp/orto/");
  });

  it("uses env placeholders for auth when writing-safe", () => {
    const cursor = generateMcpSnippets({
      ...input,
      includeAuth: true,
    }).find((s) => s.harness === "cursor");
    const parsed = JSON.parse(cursor!.body) as {
      mcpServers: {
        "hindsight-orto": { headers: { Authorization: string } };
      };
    };
    expect(parsed.mcpServers["hindsight-orto"].headers.Authorization).toBe(
      "Bearer ${env:ORTO_HINDSIGHT_API_KEY}",
    );
  });

  it("emits Firstmate as a print-only shell snippet with the single-bank URL", () => {
    const firstmate = generateMcpSnippets(input).find(
      (s) => s.harness === "firstmate",
    );
    expect(firstmate).toBeDefined();
    expect(firstmate!.format).toBe("shell");
    expect(firstmate!.body).toContain("cd ");
    expect(firstmate!.body).toContain("claude mcp add --transport http");
    expect(firstmate!.body).toContain("http://localhost:8888/mcp/orto/");
    expect(firstmate!.notes.join(" ")).toMatch(/Firstmate home/);
    expect(firstmate!.notes.join(" ")).toMatch(/Captain-only/);
    expect(firstmate!.notes.join(" ")).toMatch(/scouts or ships/);
    expect(firstmate!.notes.join(" ")).toMatch(/not write MCP config/);
    expect(firstmate!.notes.join(" ")).toMatch(/Register this git project/);
    expect(firstmate!.notes.join(" ")).toMatch(/needs_project_bank/);
    expect(firstmate!.notes.join(" ")).toMatch(/--confidence 0\.8/);
    expect(firstmate!.notes.join(" ")).toMatch(/ORTO_JEV_NEEDS_BANK/);
    expect(firstmate!.notes.join(" ")).toMatch(/skip_bank/);
    expect(firstmate!.notes.join(" ")).toMatch(/ORTO_JEV_TASK_FOLLOWUP/);
    expect(firstmate!.notes.join(" ")).toMatch(/judgeTaskFollowup/);
    expect(firstmate!.notes.join(" ")).toMatch(/retain_to_bank/);
    expect(firstmate!.notes.join(" ")).toMatch(/pr_only/);
    expect(firstmate!.notes.join(" ")).toMatch(/ORTO_JEV_ESCALATE_DISPATCH/);
    expect(firstmate!.notes.join(" ")).toMatch(/judgeEscalateDispatch/);
    expect(firstmate!.notes.join(" ")).toMatch(/needs_captain/);
    expect(firstmate!.notes.join(" ")).toMatch(/ask_captain/);
    expect(firstmate!.notes.join(" ")).toMatch(/ORTO_JEV_SCOUT_SEEDABILITY/);
    expect(firstmate!.notes.join(" ")).toMatch(/judgeScoutSeedability/);
    expect(firstmate!.notes.join(" ")).toMatch(/ORTO_JEV_BANK_ROUTE/);
    expect(firstmate!.notes.join(" ")).toMatch(/judgeBankRoute/);
    expect(firstmate!.notes.join(" ")).toMatch(/judgeDestinationKind/);
    expect(firstmate!.notes.join(" ")).toMatch(/ORTO_JEV_DESTINATION_KIND/);
    expect(firstmate!.notes.join(" ")).toMatch(/in_scope/);
    expect(firstmate!.notes.join(" ")).toMatch(/docs\.typesafe\.ai\/agent-skill\.md/);
    expect(firstmate!.notes.join(" ")).toMatch(/Claude Code/);
    expect(firstmate!.notes.join(" ")).toMatch(/\bPi\b/);
  });

  it("emits Pi shell with project-local mcp add", () => {
    const pi = generateMcpSnippets(input).find((s) => s.harness === "pi");
    expect(pi).toBeDefined();
    expect(pi!.format).toBe("shell");
    expect(pi!.body).toContain("pi mcp add -l hindsight-orto --url ");
    expect(pi!.body).toContain("http://localhost:8888/mcp/orto/");
    expect(pi!.notes.join(" ")).toMatch(/needs_project_bank/);
    expect(pi!.notes.join(" ")).toMatch(/judgeTaskFollowup/);
    expect(pi!.notes.join(" ")).toMatch(/judgeEscalateDispatch/);
    expect(pi!.notes.join(" ")).toMatch(/judgeScoutSeedability/);
    expect(pi!.notes.join(" ")).toMatch(/judgeBankRoute/);
    expect(pi!.notes.join(" ")).toMatch(/judgeDestinationKind/);
  });

  it("adds bearer env for Pi with --include-auth", () => {
    const pi = generateMcpSnippets({
      ...input,
      includeAuth: true,
    }).find((s) => s.harness === "pi");
    expect(pi!.body).toContain("--bearer-token-env-var ORTO_HINDSIGHT_API_KEY");
  });

  it("documents needs_project_bank, task followup, escalate/dispatch, and scout seedability on popular harnesses without a TypeSafe key", () => {
    for (const harness of ["cursor", "claude-code", "codex", "pi"] as const) {
      const snippet = generateMcpSnippets(input).find((s) => s.harness === harness);
      const notes = snippet!.notes.join("\n");
      expect(notes).toContain("needs_project_bank");
      expect(notes).toContain("judgeNeedsBank");
      expect(notes).toContain("judgeTaskFollowup");
      expect(notes).toContain("retain_to_bank");
      expect(notes).toContain("ORTO_JEV_TASK_FOLLOWUP");
      expect(notes).toContain("judgeEscalateDispatch");
      expect(notes).toContain("needs_captain");
      expect(notes).toContain("ORTO_JEV_ESCALATE_DISPATCH");
      expect(notes).toContain("judgeScoutSeedability");
      expect(notes).toContain("ORTO_JEV_SCOUT_SEEDABILITY");
      expect(notes).toContain("judgeBankRoute");
      expect(notes).toContain("ORTO_JEV_BANK_ROUTE");
      expect(notes).toContain("judgeDestinationKind");
      expect(notes).toContain("ORTO_JEV_DESTINATION_KIND");
      expect(notes).toContain("https://docs.typesafe.ai/agent-skill.md");
      expect(notes).toMatch(/Claude Code/);
      expect(notes).not.toMatch(/sk-[a-z0-9]{8,}/i);
      expect(notes).not.toMatch(/ORTO_TYPESAFE_API_KEY=\S+/);
    }
  });

  it("adds env placeholder auth headers for Firstmate with --include-auth", () => {
    const firstmate = generateMcpSnippets({
      ...input,
      includeAuth: true,
    }).find((s) => s.harness === "firstmate");
    expect(firstmate!.body).toContain(
      '--header "Authorization: Bearer ${ORTO_HINDSIGHT_API_KEY}"',
    );
  });

  it("filters harnesses", () => {
    const all = generateMcpSnippets(input);
    const filtered = filterSnippets(all, ["cursor", "codex"]);
    expect(filtered.map((s) => s.harness)).toEqual(["cursor", "codex"]);
  });
});

describe("parseHarnessList", () => {
  it("defaults to all", () => {
    expect(parseHarnessList(undefined).length).toBeGreaterThan(3);
  });

  it("rejects unknown harnesses", () => {
    expect(() => parseHarnessList("cursor,nope")).toThrow(/Unknown harness/);
  });

  it("still errors on --harness nope and lists pi and firstmate in the valid harnesses", () => {
    expect(() => parseHarnessList("nope")).toThrow(/Unknown harness "nope"/);
    try {
      parseHarnessList("nope");
      throw new Error("expected parseHarnessList to throw");
    } catch (error) {
      expect((error as Error).message).toContain("pi");
      expect((error as Error).message).toContain("firstmate");
    }
  });
});

describe("agent rules", () => {
  it("upserts AGENTS.md section idempotently", () => {
    const first = upsertAgentsBankSection("# Title\n\nBody.\n", {
      projectName: "Orto",
      bankId: "orto",
      baseUrl: "http://localhost:8888",
    });
    expect(first).toContain(AGENTS_BANK_BEGIN);
    expect(first).toContain("mcp/orto/");

    const second = upsertAgentsBankSection(first, {
      projectName: "Orto",
      bankId: "orto",
      baseUrl: "http://localhost:9999",
    });
    expect(second.match(/<!-- orto:hindsight-bank -->/g)?.length).toBe(1);
    expect(second).toContain("http://localhost:9999/mcp/orto/");
    expect(second).toContain("# Title");
  });

  it("builds a Cursor alwaysApply rule", () => {
    const rule = buildCursorBankRule({
      projectName: "Orto",
      bankId: "orto",
      baseUrl: "http://localhost:8888",
    });
    expect(rule).toContain("alwaysApply: true");
    expect(rule).toContain("orto");
    expect(rule).toContain("Prefer `reflect`");
    expect(rule).toContain("Prefer `recall`");
    expect(rule).toContain("Never MCP-`retain` chat");
    expect(rule).toContain("orto seed");
    expect(rule).toContain("judgeNeedsBank");
    expect(rule).toContain("judgeTaskFollowup");
    expect(rule).toContain("judgeEscalateDispatch");
    expect(rule).toContain("judgeScoutSeedability");
    expect(rule).toContain("judgeBankRoute");
    expect(rule).toContain("judgeDestinationKind");
    expect(rule).toContain("Claude Code");
    expect(rule).toContain("Pi");
  });

  it("documents the MCP retain guardrail in AGENTS bank section", () => {
    const section = upsertAgentsBankSection("", {
      projectName: "Orto",
      bankId: "orto",
      baseUrl: "http://localhost:8888",
    });
    expect(section).toContain("Do not use MCP `retain` for chat");
    expect(section).toContain("orto seed");
    expect(section).toContain("orto store");
    expect(section).toContain("judgeNeedsBank");
    expect(section).toContain("judgeTaskFollowup");
    expect(section).toContain("judgeEscalateDispatch");
    expect(section).toContain("judgeScoutSeedability");
    expect(section).toContain("judgeBankRoute");
    expect(section).toContain("judgeDestinationKind");
    expect(section).toContain("harness-agnostic");
    expect(section).toContain("Claude Code");
    expect(section).toContain("Pi");
  });
});

describe("mergeMcpServers", () => {
  it("merges without clobbering other servers", () => {
    const merged = mergeMcpServers(
      {
        mcpServers: {
          other: { url: "http://example" },
        },
      },
      {
        mcpServers: {
          hindsight: { url: "http://localhost:8888/mcp/orto/" },
        },
      },
      false,
    );
    expect(merged.mcpServers?.other).toEqual({ url: "http://example" });
    expect(merged.mcpServers?.hindsight).toEqual({
      url: "http://localhost:8888/mcp/orto/",
    });
  });

  it("refuses overwrite without force", () => {
    expect(() =>
      mergeMcpServers(
        { mcpServers: { hindsight: { url: "old" } } },
        { mcpServers: { hindsight: { url: "new" } } },
        false,
      ),
    ).toThrow(/already exists/);
  });
});
