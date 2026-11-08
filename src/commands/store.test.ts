import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { KNOWLEDGE_KIND_IDS } from "../judge/knowledge-kinds.js";
import type { ChoiceAnswer, Judge, JudgeEvaluateInput, JudgeResult } from "../judge/types.js";
import type { ResolvedJudge } from "../judge/resolve.js";
import { runStore } from "./store.js";

const execFileAsync = promisify(execFile);

describe("runStore", () => {
  const dirs: string[] = [];
  const originalFmHome = process.env.FM_HOME;

  beforeEach(() => {
    process.env.FM_HOME = "/dev/null/no-fm-home-in-tests";
  });

  afterEach(async () => {
    if (originalFmHome === undefined) {
      delete process.env.FM_HOME;
    } else {
      process.env.FM_HOME = originalFmHome;
    }
    vi.unstubAllGlobals();
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "orto-store-"));
    dirs.push(dir);
    return dir;
  }

  async function writeConfig(
    root: string,
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
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
        ...overrides,
      }),
      "utf8",
    );
  }

  function stubRetainSuccess(): void {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({ success: true, bank_id: "fixture-bank", items_count: 1 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchImpl);
  }

  it("dry-run lists known/new/changed/unchanged with explicit zeros and never calls Hindsight", async () => {
    const root = await tempProject();
    await writeConfig(root);
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const result = await runStore({ cwd: root, dryRun: true });

    expect(result.buckets.known).toHaveLength(0);
    expect(result.buckets.new).toHaveLength(0);
    expect(result.buckets.changed).toHaveLength(0);
    expect(result.buckets.unchanged).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("lists a durable file as new when it is not yet allowlisted", async () => {
    const root = await tempProject();
    await writeConfig(root);
    await writeFile(join(root, "README.md"), "# Fixture\n\nSome durable overview content here.");

    const result = await runStore({ cwd: root, dryRun: true });

    expect(result.buckets.new.map((b) => b.relativePath)).toEqual(["README.md"]);
    expect(result.buckets.known).toHaveLength(0);
  });

  it("--add-files updates the allowlist only, without retaining", async () => {
    const root = await tempProject();
    await writeConfig(root);
    await writeFile(join(root, "README.md"), "# Fixture\n\nSome durable overview content here.");
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const result = await runStore({ cwd: root, addFiles: "README.md" });

    expect(result.addFilesOnly).toBe(true);
    expect(result.addedToAllowlist).toEqual(["README.md"]);
    expect(result.retained).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();

    const config = JSON.parse(
      await readFile(join(root, ".orto", "config.json"), "utf8"),
    ) as { store?: { allowlist: string[] } };
    expect(config.store?.allowlist).toEqual(["README.md"]);
  });

  it("--files allowlists and retains the given file; a later dry-run shows it as known", async () => {
    const root = await tempProject();
    await writeConfig(root);
    await writeFile(
      join(root, "README.md"),
      "# Fixture\n\n## Architecture\n\nThis module owns retain boundaries and stays separate from scanning.",
    );
    stubRetainSuccess();

    const stored = await runStore({
      cwd: root,
      files: "README.md",
      apiKey: "test-key",
    });

    expect(stored.retained).toBeGreaterThan(0);
    const config = JSON.parse(
      await readFile(join(root, ".orto", "config.json"), "utf8"),
    ) as { store?: { allowlist: string[] } };
    expect(config.store?.allowlist).toEqual(["README.md"]);

    const laterDryRun = await runStore({ cwd: root, dryRun: true });
    expect(laterDryRun.buckets.known.map((b) => b.relativePath)).toEqual([
      "README.md",
    ]);
    expect(laterDryRun.buckets.unchanged.map((b) => b.relativePath)).toEqual([
      "README.md",
    ]);
    expect(laterDryRun.buckets.new).toHaveLength(0);
  });

  it("--yes stores changed known files only and skips new files without adopting them", async () => {
    const root = await tempProject();
    await writeConfig(root, { store: { allowlist: ["README.md"] } });
    await writeFile(
      join(root, "README.md"),
      "# Fixture\n\n## Architecture\n\nThis module owns retain boundaries.",
    );
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(
      join(root, "docs", "NEW.md"),
      "# New doc\n\n## Architecture\n\nA brand new durable doc not yet allowlisted.",
    );
    stubRetainSuccess();

    const result = await runStore({ cwd: root, yes: true, apiKey: "test-key" });

    expect(result.skippedNew).toEqual(["docs/NEW.md"]);
    expect(result.selected).toEqual(["README.md"]);

    const config = JSON.parse(
      await readFile(join(root, ".orto", "config.json"), "utf8"),
    ) as { store?: { allowlist: string[] } };
    expect(config.store?.allowlist).toEqual(["README.md"]);
  });

  it("denylist wins: refuses to allowlist a secrets-shaped path even with --add-files", async () => {
    const root = await tempProject();
    await writeConfig(root);
    await mkdir(join(root, "secrets"), { recursive: true });
    await writeFile(join(root, "secrets", "api-keys.md"), "shh");

    await expect(
      runStore({ cwd: root, addFiles: "secrets/api-keys.md" }),
    ).rejects.toThrow(/Refusing to allowlist/);
  });

  it("denylist wins: refuses --files for a non-markdown path", async () => {
    const root = await tempProject();
    await writeConfig(root);
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfile");

    await expect(
      runStore({ cwd: root, files: "pnpm-lock.yaml" }),
    ).rejects.toThrow(/Refusing to store/);
  });

  it("never stores from a disposable git worktree", async () => {
    const durable = await tempProject();
    await execFileAsync("git", ["init", "-q"], { cwd: durable });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: durable,
    });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: durable });
    await writeConfig(durable);
    await writeFile(join(durable, ".gitignore"), "node_modules\n");
    await execFileAsync("git", ["add", "-A"], { cwd: durable });
    await execFileAsync("git", ["commit", "-q", "-m", "init"], { cwd: durable });

    const worktreeParent = await tempProject();
    const worktreePath = join(worktreeParent, "linked");
    await execFileAsync(
      "git",
      ["worktree", "add", "-b", "wt-branch", worktreePath],
      { cwd: durable },
    );

    await expect(runStore({ cwd: worktreePath, dryRun: true })).rejects.toThrow(
      /disposable git worktree/,
    );
  });

  it("proposes a new ADR and does not propose a dependency readme or scratch markdown", async () => {
    const root = await tempProject();
    await writeConfig(root, { store: { allowlist: [] } });
    await mkdir(join(root, "docs", "adr"), { recursive: true });
    await mkdir(join(root, "node_modules", "left-pad"), { recursive: true });
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(
      join(root, "docs", "adr", "0002-keep-local.md"),
      "# ADR 0002\n\n## Decision\n\nWe keep the Hindsight bank on the machine. This is a project invariant.\n",
    );
    await writeFile(
      join(root, "docs", "scratch.md"),
      "# Scratch\n\nTODO dump and a badge wall. Not a decision.\n",
    );
    await writeFile(
      join(root, "node_modules", "left-pad", "README.md"),
      "# left-pad\n\nA dependency readme.\n",
    );
    await writeFile(join(root, "notes", "random.md"), "# Random\n\nMeeting notes.\n");
    const calls: string[] = [];
    const judge: Judge = {
      id: "jev",
      async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
        const path = (input.state as { path?: string }).path ?? "";
        calls.push(path);
        const adopt = path.includes("docs/adr/");
        return {
          judgeId: "jev",
          answers: {
            should_adopt: { type: "noul", noul: adopt ? 0.96 : 0.04 },
            kind: adoptKind(adopt ? "adr" : "noise", adopt ? 0.93 : 0.95),
          },
        };
      },
    };
    const resolvedJudge: ResolvedJudge = {
      judgeId: "jev",
      confidence: 0.8,
      strict: false,
      judge,
    };
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const result = await runStore({
      cwd: root,
      proposeAdopt: true,
      resolvedJudge,
    });

    expect(calls.sort()).toEqual([
      "docs/adr/0002-keep-local.md",
      "docs/scratch.md",
    ]);
    expect(result.proposals?.filter((proposal) => proposal.verdict === "propose").map((proposal) => proposal.path)).toEqual([
      "docs/adr/0002-keep-local.md",
    ]);
    expect(result.addedToAllowlist).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    const config = JSON.parse(
      await readFile(join(root, ".orto", "config.json"), "utf8"),
    ) as { store?: { allowlist: string[] } };
    expect(config.store?.allowlist).toEqual([]);
  });

  it("--apply writes only the proposed ADR and does not retain", async () => {
    const root = await tempProject();
    await writeConfig(root, { store: { allowlist: [] } });
    await mkdir(join(root, "docs", "adr"), { recursive: true });
    await writeFile(
      join(root, "docs", "adr", "0002-keep-local.md"),
      "# ADR 0002\n\n## Decision\n\nWe keep the Hindsight bank on the machine.\n",
    );
    const judge: Judge = {
      id: "jev",
      async evaluate(): Promise<JudgeResult> {
        return {
          judgeId: "jev",
          answers: {
            should_adopt: { type: "noul", noul: 0.96 },
            kind: adoptKind("adr", 0.93),
          },
        };
      },
    };
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const resolvedJudge: ResolvedJudge = {
      judgeId: "jev",
      confidence: 0.8,
      strict: false,
      judge,
    };

    const preview = await runStore({
      cwd: root,
      proposeAdopt: true,
      apply: true,
      dryRun: true,
      resolvedJudge,
    });
    expect(preview.addedToAllowlist).toEqual([]);
    let config = JSON.parse(
      await readFile(join(root, ".orto", "config.json"), "utf8"),
    ) as { store?: { allowlist: string[] } };
    expect(config.store?.allowlist).toEqual([]);

    const result = await runStore({
      cwd: root,
      proposeAdopt: true,
      apply: true,
      resolvedJudge,
    });

    expect(result.addedToAllowlist).toEqual(["docs/adr/0002-keep-local.md"]);
    expect(result.retained).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    config = JSON.parse(
      await readFile(join(root, ".orto", "config.json"), "utf8"),
    ) as { store?: { allowlist: string[] } };
    expect(config.store?.allowlist).toEqual(["docs/adr/0002-keep-local.md"]);
  });

  it("skips a typo-only edit with --judge jev and still updates the content hash", async () => {
    const root = await tempProject();
    const previous =
      "# ADR 0001\n\n## Decision\n\nWe use Redis for the local bank. This architecture decision is a project invariant.\n";
    const typo =
      "# ADR 0001\n\n## Decision\n\nWe use Redis for the local bank. This architecture decision is a project invariant!\n";
    await writeConfig(root, { store: { allowlist: ["docs/adr/0001.md"] } });
    await mkdir(join(root, "docs", "adr"), { recursive: true });
    await mkdir(join(root, ".orto", "local"), { recursive: true });
    await writeFile(join(root, "docs", "adr", "0001.md"), typo, "utf8");
    await writeFile(
      join(root, ".orto", "local", "seed-manifest.json"),
      JSON.stringify({
        version: 1,
        bankId: "fixture-bank",
        updatedAt: new Date().toISOString(),
        sources: {
          "docs/adr/0001.md": {
            contentHash: "old-hash",
            factIds: ["orto:docs/adr/0001.md#decision"],
            seededAt: "2020-01-01T00:00:00.000Z",
          },
        },
      }),
      "utf8",
    );
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const judge: Judge = {
      id: "jev",
      async evaluate(): Promise<JudgeResult> {
        return {
          judgeId: "jev",
          answers: {
            claim_changed: { type: "noul", noul: 0.04 },
            looks_like_workaround: { type: "noul", noul: 0.03 },
            action: editAction("skip", 0.93),
          },
        };
      },
    };

    const result = await runStore({
      cwd: root,
      yes: true,
      apiKey: "test-key",
      resolvedJudge: {
        judgeId: "jev",
        confidence: 0.8,
        strict: false,
        judge,
      },
      previousByPath: { "docs/adr/0001.md": previous },
    });

    expect(result.editDurability?.map((row) => row.action)).toEqual(["skip"]);
    expect(result.retained).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    const manifest = JSON.parse(
      await readFile(join(root, ".orto", "local", "seed-manifest.json"), "utf8"),
    ) as {
      sources: Record<string, { contentHash: string; factIds: string[] }>;
    };
    expect(manifest.sources["docs/adr/0001.md"]?.contentHash).not.toBe("old-hash");
    expect(manifest.sources["docs/adr/0001.md"]?.factIds).toEqual([
      "orto:docs/adr/0001.md#decision",
    ]);
  });

  it("re-retains when Redis becomes SQLite under --judge jev", async () => {
    const root = await tempProject();
    const previous =
      "# ADR 0001\n\n## Decision\n\nWe use Redis for the local bank. This architecture decision is a project invariant.\n";
    const changed =
      "# ADR 0001\n\n## Decision\n\nWe no longer use Redis; use SQLite for the local bank. This architecture decision is a project invariant.\n";
    await writeConfig(root, { store: { allowlist: ["docs/adr/0001.md"] } });
    await mkdir(join(root, "docs", "adr"), { recursive: true });
    await mkdir(join(root, ".orto", "local"), { recursive: true });
    await writeFile(join(root, "docs", "adr", "0001.md"), changed, "utf8");
    await writeFile(
      join(root, ".orto", "local", "seed-manifest.json"),
      JSON.stringify({
        version: 1,
        bankId: "fixture-bank",
        updatedAt: new Date().toISOString(),
        sources: {
          "docs/adr/0001.md": {
            contentHash: "old-hash",
            factIds: ["orto:docs/adr/0001.md#decision"],
            seededAt: "2020-01-01T00:00:00.000Z",
          },
        },
      }),
      "utf8",
    );
    stubRetainSuccess();
    const judge: Judge = {
      id: "jev",
      async evaluate(): Promise<JudgeResult> {
        return {
          judgeId: "jev",
          answers: {
            claim_changed: { type: "noul", noul: 0.96 },
            looks_like_workaround: { type: "noul", noul: 0.05 },
            action: editAction("re_retain", 0.94),
          },
        };
      },
    };

    const result = await runStore({
      cwd: root,
      yes: true,
      apiKey: "test-key",
      resolvedJudge: {
        judgeId: "jev",
        confidence: 0.8,
        strict: false,
        judge,
      },
      previousByPath: { "docs/adr/0001.md": previous },
    });

    expect(result.editDurability?.map((row) => row.action)).toEqual(["re_retain"]);
    expect(result.retained).toBeGreaterThan(0);
  });

  it("default store without --judge is unchanged", async () => {
    const root = await tempProject();
    await writeConfig(root, { store: { allowlist: ["README.md"] } });
    await writeFile(
      join(root, "README.md"),
      "# Fixture\n\n## Architecture\n\nThis module owns retain boundaries and stays separate from scanning.",
    );
    stubRetainSuccess();

    const result = await runStore({ cwd: root, yes: true, apiKey: "test-key" });

    expect(result.editDurability).toBeUndefined();
    expect(result.retained).toBeGreaterThan(0);
  });
});

function editAction(choice: string, confidence: number): ChoiceAnswer {
  const rest = ["re_retain", "skip", "review"].filter((id) => id !== choice);
  const share = (1 - confidence) / rest.length;
  const probabilities: Record<string, number> = { [choice]: confidence };
  for (const id of rest) {
    probabilities[id] = share;
  }
  return { type: "choice", choice, probabilities, confidence };
}

function adoptKind(choice: string, confidence: number): ChoiceAnswer {
  const probabilities: Record<string, number> = {};
  const rest = KNOWLEDGE_KIND_IDS.filter((id) => id !== choice);
  const share = (1 - confidence) / rest.length;
  for (const id of KNOWLEDGE_KIND_IDS) {
    probabilities[id] = id === choice ? confidence : share;
  }
  return { type: "choice", choice, probabilities, confidence };
}
