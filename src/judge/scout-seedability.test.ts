import { describe, expect, it } from "vitest";
import {
  formatScoutSeedabilityLines,
  heuristicScoutSeedability,
  interpretScoutSeedability,
  judgeScoutSeedability,
  looksLikeScoutReportPath,
  parseScoutSeedabilityEnabled,
  passThroughScoutSeedability,
  resolveScoutSeedabilityEnabled,
  scoutSeedabilityQuestions,
} from "./scout-seedability.js";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";

const DURABLE_REPORT = `# Investigation findings

## Decision

We must keep the Hindsight bank local-first. This architecture invariant and
standard should outlive the scout run. Recommendation: document the trade-off
in an ADR.
`;

const SCRATCH_REPORT = `# WIP scratch notes

TODO: try X
TODO: brainstorm more
Temporary debug log and meeting notes transcript. Ignore this raw dump for now.
`;

class ScriptedJudge implements Judge {
  readonly id = "jev" as const;
  readonly calls: JudgeEvaluateInput[] = [];
  durable = 0.94;
  scratch = 0.05;
  action = "seed";
  actionConfidence = 0.93;
  fellBackFromJev = false;

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    return {
      judgeId: "jev",
      fellBackFromJev: this.fellBackFromJev,
      answers: {
        is_durable_scout_report: { type: "noul", noul: this.durable },
        is_scratch_pad: { type: "noul", noul: this.scratch },
        action: {
          type: "choice",
          choice: this.action,
          probabilities: { [this.action]: this.actionConfidence },
          confidence: this.actionConfidence,
        },
      },
    };
  }
}

describe("scout seedability", () => {
  it("asks durable, scratch, and action questions", () => {
    const questions = scoutSeedabilityQuestions();
    expect(questions.is_durable_scout_report?.type).toBe("noul");
    expect(questions.is_scratch_pad?.type).toBe("noul");
    expect(questions.action?.type).toBe("choice");
    if (questions.action?.type === "choice") {
      expect(Object.keys(questions.action.criteria).sort()).toEqual([
        "review",
        "seed",
        "skip",
      ]);
    }
  });

  it("recognizes data/<id>/report.md paths", () => {
    expect(looksLikeScoutReportPath("data/abc123/report.md")).toBe(true);
    expect(looksLikeScoutReportPath("/tmp/data/scout-9/report.md")).toBe(true);
    expect(looksLikeScoutReportPath("docs/adr/0001.md")).toBe(false);
    expect(looksLikeScoutReportPath("data/abc/notes.md")).toBe(false);
  });

  it("is off by default via env parser", () => {
    expect(parseScoutSeedabilityEnabled({})).toBe(false);
    expect(
      parseScoutSeedabilityEnabled({ ORTO_JEV_SCOUT_SEEDABILITY: "0" }),
    ).toBe(false);
    expect(
      parseScoutSeedabilityEnabled({ ORTO_JEV_SCOUT_SEEDABILITY: "1" }),
    ).toBe(true);
    expect(
      parseScoutSeedabilityEnabled({ ORTO_JEV_FIRSTMATE_SCOUT_SEED: "true" }),
    ).toBe(true);
    expect(resolveScoutSeedabilityEnabled({})).toBe(false);
    expect(resolveScoutSeedabilityEnabled({ scoutSeed: true })).toBe(true);
    expect(
      resolveScoutSeedabilityEnabled({
        scoutSeed: false,
        env: { ORTO_JEV_SCOUT_SEEDABILITY: "1" },
      }),
    ).toBe(false);
  });

  it("pass-through leaves verdict unset", () => {
    const decision = passThroughScoutSeedability();
    expect(decision.verdict).toBe("unset");
    expect(decision.source).toBe("pass_through");
  });

  it("default judgeScoutSeedability stays pass-through and skips TypeSafe", async () => {
    const judge = new ScriptedJudge();
    const result = await judgeScoutSeedability({
      text: DURABLE_REPORT,
      path: "data/abc/report.md",
      judge,
      confidence: 0.8,
    });
    expect(result.enabled).toBe(false);
    expect(result.decision.verdict).toBe("unset");
    expect(judge.calls).toHaveLength(0);
  });

  it("heuristic seeds durable scout findings", () => {
    const decision = heuristicScoutSeedability({
      text: DURABLE_REPORT,
      path: "data/abc/report.md",
    });
    expect(decision.verdict).toBe("seed");
    expect(decision.agentMessage).toMatch(/orto store|orto seed/);
    expect(decision.agentMessage).toMatch(/Do not MCP-retain/);
  });

  it("heuristic skips scratch-pad scout reports", () => {
    const decision = heuristicScoutSeedability({
      text: SCRATCH_REPORT,
      path: "data/abc/report.md",
    });
    expect(decision.verdict).toBe("skip");
  });

  it("non report.md path stays in review", () => {
    const decision = heuristicScoutSeedability({
      text: DURABLE_REPORT,
      path: "docs/notes.md",
    });
    expect(decision.verdict).toBe("review");
    expect(decision.reason).toMatch(/report\.md/);
  });

  it("uses Jev when scoutSeed is opted in", async () => {
    const judge = new ScriptedJudge();
    const result = await judgeScoutSeedability({
      text: DURABLE_REPORT,
      path: "data/abc/report.md",
      judge,
      confidence: 0.8,
      scoutSeed: true,
    });
    expect(result.enabled).toBe(true);
    expect(result.decision.source).toBe("jev");
    expect(result.decision.verdict).toBe("seed");
    expect(judge.calls).toHaveLength(1);
    expect((judge.calls[0]?.state as { type?: string }).type).toBe(
      "scout_seedability",
    );
  });

  it("skips when scratch pad is confident yes", () => {
    const decision = interpretScoutSeedability({
      confidence: 0.8,
      path: "data/abc/report.md",
      answers: {
        is_durable_scout_report: { type: "noul", noul: 0.2 },
        is_scratch_pad: { type: "noul", noul: 0.95 },
        action: {
          type: "choice",
          choice: "seed",
          probabilities: { seed: 0.9 },
          confidence: 0.9,
        },
      },
    });
    expect(decision.verdict).toBe("skip");
    expect(decision.isScratchPadBand).toBe("yes");
  });

  it("reviews when seed lacks confident durability", () => {
    const decision = interpretScoutSeedability({
      confidence: 0.8,
      answers: {
        is_durable_scout_report: { type: "noul", noul: 0.4 },
        is_scratch_pad: { type: "noul", noul: 0.2 },
        action: {
          type: "choice",
          choice: "seed",
          probabilities: { seed: 0.9 },
          confidence: 0.9,
        },
      },
    });
    expect(decision.verdict).toBe("review");
  });

  it("falls back to heuristic when Jev falls back", async () => {
    const judge = new ScriptedJudge();
    judge.fellBackFromJev = true;
    judge.action = "seed";
    const result = await judgeScoutSeedability({
      text: SCRATCH_REPORT,
      path: "data/abc/report.md",
      judge,
      confidence: 0.8,
      scoutSeed: true,
    });
    expect(result.decision.source).toBe("heuristic");
    expect(result.decision.verdict).toBe("skip");
  });

  it("enables from ORTO_JEV_SCOUT_SEEDABILITY", async () => {
    const result = await judgeScoutSeedability({
      text: DURABLE_REPORT,
      path: "data/abc/report.md",
      confidence: 0.8,
      env: { ORTO_JEV_SCOUT_SEEDABILITY: "1" },
    });
    expect(result.enabled).toBe(true);
    expect(result.decision.verdict).toBe("seed");
  });

  it("formatScoutSeedabilityLines includes verdict and latency", () => {
    const decision = heuristicScoutSeedability({
      text: DURABLE_REPORT,
      path: "data/abc/report.md",
    });
    const lines = formatScoutSeedabilityLines({
      decision,
      latencyMs: 17,
    });
    expect(lines.some((line) => line.includes("Scout seedability: seed"))).toBe(
      true,
    );
    expect(
      lines.some((line) =>
        line.includes("latency: 17ms vs ungated scout seedability"),
      ),
    ).toBe(true);
  });
});
