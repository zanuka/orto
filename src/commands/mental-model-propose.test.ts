import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "../judge/types.js";
import type { ResolvedJudge } from "../judge/resolve.js";
import { runMentalModelPropose } from "./mental-model-propose.js";

describe("runMentalModelPropose", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempProject(withTemplate: boolean): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "orto-mm-propose-"));
    dirs.push(dir);
    await mkdir(join(dir, ".orto", "hindsight"), { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "fixture", private: true }),
      "utf8",
    );
    await writeFile(
      join(dir, "README.md"),
      "# Fixture\n\nLocal-first CLI with docs and ADRs.\n",
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
      }),
      "utf8",
    );
    if (withTemplate) {
      await writeFile(
        join(dir, ".orto", "hindsight", "bank-template.json"),
        JSON.stringify({
          version: "1",
          bank: {
            retain_mission: "mission",
            retain_extraction_mode: "verbose",
            enable_observations: true,
            observations_mission: "obs",
            reflect_mission: "reflect",
            disposition_skepticism: 4,
            disposition_literalism: 4,
            disposition_empathy: 2,
            entities_allow_free_form: true,
            entity_labels: [],
          },
          mental_models: [
            {
              id: "project-context",
              name: "Project Context",
              source_query: "overview",
              max_tokens: 1024,
              tags: ["orto"],
              trigger: { refresh_after_consolidation: true },
            },
            {
              id: "architecture-decisions",
              name: "Architecture Decisions",
              source_query: "decisions",
              max_tokens: 1024,
              tags: ["orto"],
              trigger: { refresh_after_consolidation: true },
            },
            {
              id: "coding-standards",
              name: "Coding Standards",
              source_query: "standards",
              max_tokens: 1024,
              tags: ["orto"],
              trigger: { refresh_after_consolidation: false },
            },
          ],
          directives: [],
        }),
        "utf8",
      );
    }
    return dir;
  }

  function resolved(judge: Judge): ResolvedJudge {
    return { judgeId: "jev", confidence: 0.8, strict: false, judge };
  }

  class RoutingJudge implements Judge {
    readonly id = "jev" as const;
    readonly calls: JudgeEvaluateInput[] = [];
    created = false;

    async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
      this.calls.push(input);
      const id =
        typeof (input.state as { id?: unknown }).id === "string"
          ? (input.state as { id: string }).id
          : "";
      const noul =
        id === "module-boundaries" || id === "auth-and-identity" ? 0.93 : 0.08;
      return {
        judgeId: "jev",
        answers: {
          should_propose: { type: "noul", noul },
        },
      };
    }
  }

  it("requires --judge jev", async () => {
    const root = await tempProject(false);
    await expect(
      runMentalModelPropose({
        cwd: root,
        judge: "heuristic",
      }),
    ).rejects.toThrow(/requires --judge jev/);
  });

  it("prints proposals without creating and skips template ids", async () => {
    const root = await tempProject(true);
    const judge = new RoutingJudge();
    const result = await runMentalModelPropose({
      cwd: root,
      judge: "jev",
      resolvedJudge: resolved(judge),
    });

    expect(result.existingIds).toEqual([
      "project-context",
      "architecture-decisions",
      "coding-standards",
    ]);
    expect(result.proposals.every((item) => item.id !== "project-context")).toBe(
      true,
    );
    const proposed = result.proposals.filter((item) => item.verdict === "propose");
    expect(proposed.map((item) => item.id).sort()).toEqual([
      "auth-and-identity",
      "module-boundaries",
    ]);
    expect(proposed[0]?.title).toBeTruthy();
    expect(proposed[0]?.sourceQuery).toBeTruthy();
    expect(proposed[0]?.kind).toBeTruthy();
    expect(proposed[0]?.confidence).toBeGreaterThan(0.8);
    expect(judge.created).toBe(false);
    expect(judge.calls.length).toBeGreaterThan(0);
  });
});
