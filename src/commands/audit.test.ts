import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Judge, JudgeResult } from "../judge/types.js";
import type { ResolvedJudge } from "../judge/resolve.js";
import { AUDIT_ACTIONS } from "../judge/audit.js";
import { MENTAL_MODEL_FRESHNESS_ACTIONS } from "../judge/mental-model-freshness.js";
import { runAudit } from "./audit.js";

function actionAnswer(choice: string, confidence: number) {
  const rest = AUDIT_ACTIONS.filter((id) => id !== choice);
  const share = (1 - confidence) / rest.length;
  const probabilities: Record<string, number> = { [choice]: confidence };
  for (const id of rest) {
    probabilities[id] = share;
  }
  return { type: "choice" as const, choice, probabilities, confidence };
}

function freshnessActionAnswer(choice: string, confidence: number) {
  const rest = MENTAL_MODEL_FRESHNESS_ACTIONS.filter((id) => id !== choice);
  const share = (1 - confidence) / rest.length;
  const probabilities: Record<string, number> = { [choice]: confidence };
  for (const id of rest) {
    probabilities[id] = share;
  }
  return { type: "choice" as const, choice, probabilities, confidence };
}

describe("runAudit", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "orto-audit-"));
    dirs.push(dir);
    await mkdir(join(dir, ".orto", "hindsight"), { recursive: true });
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
        createdAt: new Date().toISOString(),
        hindsightBaseUrl: "http://localhost:8888",
      }),
      "utf8",
    );
    await writeFile(
      join(dir, ".orto", "hindsight", "bank-template.json"),
      JSON.stringify({
        version: "1",
        bank: { retain_mission: "Hold durable decisions for Fixture." },
        mental_models: [],
        directives: [],
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

  function resolved(judge: Judge): ResolvedJudge {
    return { judgeId: "jev", confidence: 0.8, strict: false, judge };
  }

  it("writes a plan with id, action, confidence, and reason-from-answers", async () => {
    const root = await tempProject();
    const judge: Judge = {
      id: "jev",
      async evaluate(): Promise<JudgeResult> {
        return {
          judgeId: "jev",
          answers: {
            still_supported_by_repo: { type: "noul", noul: 0.96 },
            superseded: { type: "noul", noul: 0.04 },
            action: actionAnswer("keep", 0.92),
          },
        };
      },
    };

    const result = await runAudit({
      cwd: root,
      resolvedJudge: resolved(judge),
      apiKey: "test-key",
      mentalModels: [],
      documents: [
        {
          id: "orto:docs/adr/0001-local.md#decision",
          document_metadata: { source: "docs/adr/0001-local.md" },
          updated_at: "2026-11-01T00:00:00.000Z",
        },
      ],
    });

    expect(result.wrotePlan).toBe(true);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]?.id).toBe("orto:docs/adr/0001-local.md#decision");
    expect(result.decisions[0]?.action).toBe("keep");
    expect(result.decisions[0]?.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.decisions[0]?.reason).toContain("action=keep");
    expect(result.decisions[0]?.reason).toContain("still_supported_by_repo=");

    const plan = JSON.parse(await readFile(result.planPath, "utf8")) as {
      version: number;
      items: Array<{ id: string; action: string; confidence: number; reason: string }>;
    };
    expect(plan.version).toBe(1);
    expect(plan.items[0]).toMatchObject({
      id: "orto:docs/adr/0001-local.md#decision",
      action: "keep",
    });
    expect(plan.items[0]?.reason).toContain("still_supported_by_repo=");
  });

  it("is dry by default when --dry-run is set and does not write the plan", async () => {
    const root = await tempProject();
    const judge: Judge = {
      id: "jev",
      async evaluate(): Promise<JudgeResult> {
        return {
          judgeId: "jev",
          answers: {
            still_supported_by_repo: { type: "noul", noul: 0.1 },
            superseded: { type: "noul", noul: 0.9 },
            action: actionAnswer("delete_candidate", 0.91),
          },
        };
      },
    };

    const result = await runAudit({
      cwd: root,
      dryRun: true,
      resolvedJudge: resolved(judge),
      apiKey: "test-key",
      mentalModels: [],
      documents: [
        {
          id: "orto:docs/adr/0001-local.md#decision",
          document_metadata: { source: "docs/adr/0001-local.md" },
        },
      ],
    });

    expect(result.wrotePlan).toBe(false);
    expect(result.decisions[0]?.action).toBe("delete_candidate");
    await expect(readFile(result.planPath, "utf8")).rejects.toThrow();
  });

  it("marks a mental model refresh without proposing delete", async () => {
    const root = await tempProject();
    const judge: Judge = {
      id: "jev",
      async evaluate(): Promise<JudgeResult> {
        return {
          judgeId: "jev",
          answers: {
            model_still_answers_source_query: { type: "noul", noul: 0.9 },
            new_evidence_since_refresh: { type: "noul", noul: 0.94 },
            action: freshnessActionAnswer("refresh", 0.93),
          },
        };
      },
    };

    const result = await runAudit({
      cwd: root,
      resolvedJudge: resolved(judge),
      apiKey: "test-key",
      documents: [],
      mentalModels: [
        {
          id: "architecture-decisions",
          name: "Architecture Decisions",
          source_query: "What architectural decisions were made?",
          content: "We keep banks local-first.",
          last_refreshed_at: "2026-10-01T00:00:00.000Z",
        },
      ],
      recallObservations: async () => [
        {
          id: "obs-sqlite",
          text: "SQLite is the local store for Orto banks.",
        },
      ],
    });

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]?.id).toBe("architecture-decisions");
    expect(result.decisions[0]?.action).toBe("refresh_mental_model");
    expect(result.decisions[0]?.action).not.toBe("delete_candidate");
    expect(result.decisions[0]?.freshnessAction).toBe("refresh");
    expect(result.decisions[0]?.layer).toBe("mental_model");

    const plan = JSON.parse(await readFile(result.planPath, "utf8")) as {
      items: Array<{
        id: string;
        action: string;
        freshnessAction?: string;
        reviewOnly?: boolean;
      }>;
    };
    expect(plan.items[0]).toMatchObject({
      id: "architecture-decisions",
      action: "refresh_mental_model",
      freshnessAction: "refresh",
    });
    expect(plan.items[0]?.action).not.toBe("delete_candidate");
  });

  it("records retarget_query as review-only and does not rewrite the source query", async () => {
    const root = await tempProject();
    const sourceQuery =
      "What architectural decisions use Redis for the primary store?";
    const seenQueries: string[] = [];
    const judge: Judge = {
      id: "jev",
      async evaluate(input): Promise<JudgeResult> {
        const state = input.state as { sourceQuery?: string };
        if (typeof state.sourceQuery === "string") {
          seenQueries.push(state.sourceQuery);
        }
        return {
          judgeId: "jev",
          answers: {
            model_still_answers_source_query: { type: "noul", noul: 0.06 },
            new_evidence_since_refresh: { type: "noul", noul: 0.2 },
            action: freshnessActionAnswer("retarget_query", 0.9),
          },
        };
      },
    };

    const result = await runAudit({
      cwd: root,
      dryRun: true,
      resolvedJudge: resolved(judge),
      apiKey: "test-key",
      documents: [],
      mentalModels: [
        {
          id: "architecture-decisions",
          name: "Architecture Decisions",
          source_query: sourceQuery,
        },
      ],
      recallObservations: async () => [],
    });

    expect(result.decisions[0]?.freshnessAction).toBe("retarget_query");
    expect(result.decisions[0]?.reviewOnly).toBe(true);
    expect(result.decisions[0]?.action).toBe("keep");
    expect(result.decisions[0]?.reason).toContain("review_only");
    expect(seenQueries).toEqual([sourceQuery]);
    expect(result.wrotePlan).toBe(false);
  });

  it("errors clearly when --judge jev is missing", async () => {
    const root = await tempProject();
    await expect(runAudit({ cwd: root, judge: "heuristic" })).rejects.toThrow(
      /requires --judge jev/,
    );
  });

  it("errors clearly when the TypeSafe key is missing", async () => {
    const root = await tempProject();
    const previous = process.env.ORTO_TYPESAFE_API_KEY;
    delete process.env.ORTO_TYPESAFE_API_KEY;
    try {
      await expect(
        runAudit({
          cwd: root,
          judge: "jev",
          apiKey: "hindsight-key",
        }),
      ).rejects.toThrow(/ORTO_TYPESAFE_API_KEY/);
    } finally {
      if (previous === undefined) {
        delete process.env.ORTO_TYPESAFE_API_KEY;
      } else {
        process.env.ORTO_TYPESAFE_API_KEY = previous;
      }
    }
  });
});
