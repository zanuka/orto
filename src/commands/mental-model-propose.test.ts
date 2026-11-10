import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "../judge/types.js";
import type { ResolvedJudge } from "../judge/resolve.js";
import type { HindsightClient } from "../providers/hindsight/client.js";
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

  function mockClient(): HindsightClient {
    return {
      createMentalModel: vi.fn(async (_bankId: string, body: { id?: string }) => {
        return { id: body.id ?? "generated" };
      }),
    } as unknown as HindsightClient;
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
    const client = mockClient();
    const result = await runMentalModelPropose({
      cwd: root,
      judge: "jev",
      resolvedJudge: resolved(judge),
      client,
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
    expect(result.created).toEqual([]);
    expect(client.createMentalModel).not.toHaveBeenCalled();
  });

  it("applies selected proposals with --ids and writes the template", async () => {
    const root = await tempProject(true);
    const judge = new RoutingJudge();
    const client = mockClient();
    const result = await runMentalModelPropose({
      cwd: root,
      judge: "jev",
      resolvedJudge: resolved(judge),
      apply: true,
      ids: ["module-boundaries"],
      client,
    });

    expect(result.selected.map((item) => item.id)).toEqual(["module-boundaries"]);
    expect(result.created).toEqual(["module-boundaries"]);
    expect(result.templateUpdated).toBe(true);
    expect(client.createMentalModel).toHaveBeenCalledTimes(1);
    expect(client.createMentalModel).toHaveBeenCalledWith(
      "fixture",
      expect.objectContaining({
        id: "module-boundaries",
        name: "Module Boundaries",
        tags: ["knowledge:architecture"],
      }),
    );
    const template = JSON.parse(
      await readFile(join(root, ".orto", "hindsight", "bank-template.json"), "utf8"),
    ) as { mental_models: Array<{ id: string }> };
    expect(template.mental_models.some((model) => model.id === "module-boundaries")).toBe(
      true,
    );
  });

  it("applies all proposals with --yes without prompting", async () => {
    const root = await tempProject(true);
    const judge = new RoutingJudge();
    const client = mockClient();
    const selectProposals = vi.fn();
    const result = await runMentalModelPropose({
      cwd: root,
      judge: "jev",
      resolvedJudge: resolved(judge),
      apply: true,
      yes: true,
      client,
      selectProposals,
    });

    expect(selectProposals).not.toHaveBeenCalled();
    expect(result.created.sort()).toEqual([
      "auth-and-identity",
      "module-boundaries",
    ]);
    expect(client.createMentalModel).toHaveBeenCalledTimes(2);
  });

  it("uses interactive selection callback when provided", async () => {
    const root = await tempProject(true);
    const judge = new RoutingJudge();
    const client = mockClient();
    const result = await runMentalModelPropose({
      cwd: root,
      judge: "jev",
      resolvedJudge: resolved(judge),
      apply: true,
      client,
      selectProposals: async (proposed) =>
        proposed.filter((item) => item.id === "auth-and-identity"),
    });

    expect(result.created).toEqual(["auth-and-identity"]);
    expect(client.createMentalModel).toHaveBeenCalledTimes(1);
  });

  it("dry-run --apply previews create without calling Hindsight", async () => {
    const root = await tempProject(true);
    const judge = new RoutingJudge();
    const client = mockClient();
    const result = await runMentalModelPropose({
      cwd: root,
      judge: "jev",
      resolvedJudge: resolved(judge),
      apply: true,
      yes: true,
      dryRun: true,
      client,
    });

    expect(result.created.sort()).toEqual([
      "auth-and-identity",
      "module-boundaries",
    ]);
    expect(client.createMentalModel).not.toHaveBeenCalled();
    expect(result.templateUpdated).toBe(false);
  });
});
