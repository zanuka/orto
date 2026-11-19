import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatDriftLine } from "../judge/drift.js";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "../judge/types.js";
import type { ResolvedJudge } from "../judge/resolve.js";
import type { DocumentSummary } from "../providers/hindsight/client.js";
import { auditPlanPath } from "../seeder/audit-plan.js";
import { pathExists } from "../utils/fs.js";
import { runStatus } from "./status.js";

describe("runStatus", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "orto-status-"));
    dirs.push(dir);
    await mkdir(join(dir, ".orto"), { recursive: true });
    await mkdir(join(dir, "docs", "adr"), { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "fixture", private: true }),
      "utf8",
    );
    await writeFile(
      join(dir, ".orto", "config.json"),
      JSON.stringify({
        version: 1,
        name: "fixture",
        provider: "hindsight",
        bankId: "fixture",
        root: ".",
        createdAt: "2026-11-01T00:00:00.000Z",
        hindsightBaseUrl: "http://localhost:8888",
      }),
      "utf8",
    );
    await writeFile(
      join(dir, "docs", "adr", "0001-local.md"),
      "# ADR 0001\n\n## Decision\n\nWe keep the Hindsight bank on the machine. This architecture decision is a project invariant.\n",
      "utf8",
    );
    return dir;
  }

  function docs(count: number): DocumentSummary[] {
    return Array.from({ length: count }, (_, index) => ({
      id: `orto:docs/adr/0001-local.md#section-${index}`,
    }));
  }

  it("prints a hash-only drift line when the judge is off", async () => {
    const root = await tempProject();
    const judge: Judge = {
      id: "jev",
      async evaluate(): Promise<JudgeResult> {
        throw new Error("hash status must not call Jev");
      },
    };
    const result = await runStatus({
      cwd: root,
      dryRun: true,
      sampledAt: "2026-11-19T05:00:00.000Z",
      apiKey: "test-key",
      resolvedJudge: { judgeId: "heuristic", confidence: 0.8, strict: false, judge },
      documents: [
        { id: "orto:docs/adr/0001-local.md#decision" },
        { id: "orto:docs/gone.md#note" },
      ],
    });
    expect(formatDriftLine(result.drift)).toBe(
      "Drift: 1/2 supported (50%) as of 2026-11-19",
    );
    expect(result.drift.mode).toBe("hash");
    expect(await pathExists(auditPlanPath(root))).toBe(false);
  });

  it("asks Jev only for the bounded sample", async () => {
    const root = await tempProject();
    const calls: JudgeEvaluateInput[] = [];
    const judge: Judge = {
      id: "jev",
      async evaluate(input): Promise<JudgeResult> {
        calls.push(input);
        const gone = JSON.stringify(input.state).includes("gone.md");
        return {
          judgeId: "jev",
          answers: {
            still_supported_by_repo: { type: "noul", noul: gone ? 0.05 : 0.96 },
            superseded: { type: "noul", noul: gone ? 0.9 : 0.04 },
            action: {
              type: "choice",
              choice: gone ? "delete_candidate" : "keep",
              probabilities: { [gone ? "delete_candidate" : "keep"]: 0.92 },
              confidence: 0.92,
            },
          },
        };
      },
    };
    const resolved: ResolvedJudge = {
      judgeId: "jev",
      confidence: 0.8,
      strict: false,
      judge,
    };
    const result = await runStatus({
      cwd: root,
      sampledAt: "2026-11-19T05:00:00.000Z",
      apiKey: "test-key",
      judge: "jev",
      resolvedJudge: resolved,
      sample: 2,
      documents: [
        { id: "orto:docs/adr/0001-local.md#decision" },
        { id: "orto:docs/gone.md#note" },
        { id: "orto:docs/adr/0001-local.md#extra" },
      ],
    });
    expect(calls).toHaveLength(2);
    expect(result.drift.sampled).toBe(2);
    expect(result.drift.supported).toBe(1);
    expect(result.drift.mode).toBe("jev");
    expect(formatDriftLine(result.drift)).toContain("as of 2026-11-19");
  });

  it("lists one page and does not sample past the cap", async () => {
    const root = await tempProject();
    const limits: number[] = [];
    const result = await runStatus({
      cwd: root,
      sampledAt: "2026-11-19T05:00:00.000Z",
      apiKey: "test-key",
      sample: 80,
      listDocuments: async (_bankId, limit) => {
        limits.push(limit);
        return docs(limit);
      },
    });
    expect(limits).toEqual([50]);
    expect(result.drift.sampled).toBe(50);
    expect(result.drift.supported).toBe(50);
  });
});
