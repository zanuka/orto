import { describe, expect, it } from "vitest";
import { listMentalModelCatalog } from "./mental-model-catalog.js";
import {
  formatMentalModelProposeLines,
  interpretMentalModelPropose,
  judgeMentalModelCatalogEntry,
  mentalModelProposeQuestions,
} from "./mental-model-propose.js";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";

class ScriptedJudge implements Judge {
  readonly id = "jev" as const;
  readonly calls: JudgeEvaluateInput[] = [];
  noul = 0.94;

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    return {
      judgeId: "jev",
      answers: {
        should_propose: { type: "noul", noul: this.noul },
      },
    };
  }
}

describe("mental model propose", () => {
  const entry = listMentalModelCatalog().find(
    (item) => item.id === "module-boundaries",
  )!;

  it("asks should_propose", () => {
    expect(Object.keys(mentalModelProposeQuestions())).toEqual([
      "should_propose",
    ]);
  });

  it("proposes on a confident yes", async () => {
    const judge = new ScriptedJudge();
    const decision = await judgeMentalModelCatalogEntry({
      entry,
      projectName: "orto",
      snapshot: {
        readmeCount: 1,
        docsCount: 2,
        adrCount: 1,
        markdownFileCount: 4,
        docsBytes: 12_000,
        hasAdrTree: true,
      },
      repoExcerpt: "Orto is a TypeScript CLI for Hindsight banks.",
      judge,
      confidence: 0.8,
    });
    expect(decision.verdict).toBe("propose");
    expect(decision.title).toBe("Module Boundaries");
    expect(decision.sourceQuery).toContain("orto");
    expect(decision.kind).toBe("architecture");
    expect(decision.confidence).toBeCloseTo(0.94);
    expect(judge.calls[0]?.questions).toEqual(mentalModelProposeQuestions());
  });

  it("skips on a confident no", () => {
    const decision = interpretMentalModelPropose({
      entry,
      sourceQuery: entry.sourceQuery("orto"),
      confidence: 0.8,
      answers: {
        should_propose: { type: "noul", noul: 0.05 },
      },
    });
    expect(decision.verdict).toBe("skip");
  });

  it("reviews mid-range answers", () => {
    const decision = interpretMentalModelPropose({
      entry,
      sourceQuery: entry.sourceQuery("orto"),
      confidence: 0.8,
      answers: {
        should_propose: { type: "noul", noul: 0.5 },
      },
    });
    expect(decision.verdict).toBe("review");
  });

  it("formats proposal lines with title, source_query, kind, confidence", () => {
    const lines = formatMentalModelProposeLines({
      dryRun: false,
      proposals: [
        {
          id: "module-boundaries",
          title: "Module Boundaries",
          sourceQuery: "What are the module boundaries?",
          kind: "architecture",
          verdict: "propose",
          reason: "architecture",
          confidence: 0.94,
          shouldPropose: 0.94,
          shouldProposeBand: "yes",
        },
      ],
    });
    expect(lines[1]).toContain('title="Module Boundaries"');
    expect(lines[1]).toContain('source_query="What are the module boundaries?"');
    expect(lines[1]).toContain("kind=architecture");
    expect(lines[1]).toContain("confidence=0.94");
  });
});
