import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMcp } from "./mcp.js";

describe("runMcp --write-firstmate", () => {
  const dirs: string[] = [];
  const originalFmHome = process.env.FM_HOME;

  afterEach(async () => {
    if (originalFmHome === undefined) {
      delete process.env.FM_HOME;
    } else {
      process.env.FM_HOME = originalFmHome;
    }
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  }

  async function tempProject(): Promise<string> {
    const root = await tempDir("orto-mcp-project-");
    await mkdir(join(root, ".orto"), { recursive: true });
    await writeFile(
      join(root, ".orto", "config.json"),
      JSON.stringify({
        version: 1,
        name: "fixture",
        provider: "hindsight",
        bankId: "fixture-bank",
        root: ".",
        createdAt: new Date().toISOString(),
      }),
      "utf8",
    );
    return root;
  }

  it("prints install steps and writes nothing when FM_HOME is unset", async () => {
    delete process.env.FM_HOME;
    const root = await tempProject();

    const result = await runMcp({
      cwd: root,
      harness: "firstmate",
      writeFirstmate: true,
    });

    expect(result.firstmateSkill?.printOnly).toBe(true);
    expect(result.firstmateSkill?.installed).toBe(false);
  });

  it("writes the skill file and registry entry under FM_HOME", async () => {
    const fmHome = await tempDir("orto-fm-home-");
    process.env.FM_HOME = fmHome;
    const root = await tempProject();

    const result = await runMcp({
      cwd: root,
      harness: "firstmate",
      writeFirstmate: true,
    });

    expect(result.firstmateSkill?.installed).toBe(true);
    const skillPath = join(fmHome, ".agents", "skills", "project-bank", "SKILL.md");
    const skill = await readFile(skillPath, "utf8");
    expect(skill).toContain("project-bank");
    expect(skill).toContain("recall");
    expect(skill).toContain("needs_project_bank");
    expect(skill).toContain("ORTO_JEV_NEEDS_BANK");
    expect(skill).toContain("judgeNeedsBank");
    expect(skill).toContain("ORTO_JEV_TASK_FOLLOWUP");
    expect(skill).toContain("judgeTaskFollowup");
    expect(skill).toContain("retain_to_bank");
    expect(skill).toContain("ORTO_JEV_ESCALATE_DISPATCH");
    expect(skill).toContain("judgeEscalateDispatch");
    expect(skill).toContain("needs_captain");
    expect(skill).toContain("ask_captain");

    const registryPath = join(fmHome, ".orto", "projects.json");
    const registry = JSON.parse(await readFile(registryPath, "utf8")) as {
      projects: Record<string, { bankId: string; hindsightBaseUrl?: string }>;
    };
    expect(registry.projects[root]).toMatchObject({ bankId: "fixture-bank" });
  });

  it("dry-run previews without writing", async () => {
    const fmHome = await tempDir("orto-fm-home-");
    process.env.FM_HOME = fmHome;
    const root = await tempProject();

    const result = await runMcp({
      cwd: root,
      harness: "firstmate",
      writeFirstmate: true,
      dryRun: true,
    });

    expect(result.firstmateSkill?.dryRun).toBe(true);
    expect(result.firstmateSkill?.installed).toBe(false);
    await expect(
      readFile(join(fmHome, ".agents", "skills", "project-bank", "SKILL.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("does not write into the product repo tree", async () => {
    const fmHome = await tempDir("orto-fm-home-");
    process.env.FM_HOME = fmHome;
    const root = await tempProject();

    await runMcp({ cwd: root, harness: "firstmate", writeFirstmate: true });

    await expect(
      readFile(join(root, ".agents", "skills", "project-bank", "SKILL.md"), "utf8"),
    ).rejects.toThrow();
  });
});

describe("runMcp --harness firstmate (judge off)", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("emits firstmate snippets with needs_project_bank policy and no TypeSafe call", async () => {
    const root = await mkdtemp(join(tmpdir(), "orto-mcp-fm-"));
    dirs.push(root);
    await mkdir(join(root, ".orto"), { recursive: true });
    await writeFile(
      join(root, ".orto", "config.json"),
      JSON.stringify({
        version: 1,
        name: "fixture",
        provider: "hindsight",
        bankId: "fixture-bank",
        root: ".",
        createdAt: new Date().toISOString(),
      }),
      "utf8",
    );

    const previousKey = process.env.ORTO_TYPESAFE_API_KEY;
    delete process.env.ORTO_TYPESAFE_API_KEY;
    try {
      const result = await runMcp({
        cwd: root,
        harness: "firstmate",
      });
      const notes = result.snippets
        .filter((snippet) => snippet.harness === "firstmate")
        .flatMap((snippet) => snippet.notes)
        .join("\n");
      expect(notes).toContain("needs_project_bank");
      expect(notes).toContain("--confidence 0.8");
      expect(result.writes).toEqual([]);
    } finally {
      if (previousKey === undefined) {
        delete process.env.ORTO_TYPESAFE_API_KEY;
      } else {
        process.env.ORTO_TYPESAFE_API_KEY = previousKey;
      }
    }
  });
});

describe("runMcp --write-agents", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("dry-run previews retain-guardrail bullets without writing AGENTS.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "orto-mcp-agents-"));
    dirs.push(root);
    await mkdir(join(root, ".orto"), { recursive: true });
    await writeFile(
      join(root, ".orto", "config.json"),
      JSON.stringify({
        version: 1,
        name: "fixture",
        provider: "hindsight",
        bankId: "fixture-bank",
        root: ".",
        createdAt: new Date().toISOString(),
      }),
      "utf8",
    );

    const result = await runMcp({
      cwd: root,
      harness: "cursor",
      writeAgents: true,
      dryRun: true,
    });

    const preview = result.writes[0]?.preview ?? "";
    expect(preview).toContain("Do not use MCP `retain` for chat");
    expect(preview).toContain("orto seed");
    expect(preview).toContain("MCP retain is gated");
    await expect(readFile(join(root, "AGENTS.md"), "utf8")).rejects.toThrow();
  });
});
