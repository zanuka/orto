import { describe, expect, it } from "vitest";
import {
  ASK_CAPTAIN,
  buildCrewmateCriteria,
  escalateDispatchQuestions,
  formatEscalateDispatchLines,
  heuristicEscalateDispatch,
  interpretEscalateDispatch,
  judgeEscalateDispatch,
  normalizeCrewmateCharters,
  parseEscalateDispatchEnabled,
  passThroughEscalateDispatch,
  resolveEscalateDispatchEnabled,
} from "./escalate-dispatch.js";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";

const IMPLEMENTER = {
  id: "implementer",
  name: "Implementer",
  description: "Writes code, fixes tests, and lands routine PRs.",
};

const REVIEWER = {
  id: "reviewer",
  name: "Reviewer",
  description: "Reviews diffs for correctness.",
};

class ScriptedJudge implements Judge {
  readonly id = "jev" as const;
  readonly calls: JudgeEvaluateInput[] = [];
  needsCaptain = 0.1;
  crewmate = "implementer";
  crewmateConfidence = 0.93;
  fellBackFromJev = false;

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    return {
      judgeId: "jev",
      fellBackFromJev: this.fellBackFromJev,
      answers: {
        needs_captain: {
          type: "noul",
          noul: this.needsCaptain,
        },
        crewmate: {
          type: "choice",
          choice: this.crewmate,
          probabilities: { [this.crewmate]: this.crewmateConfidence },
          confidence: this.crewmateConfidence,
        },
      },
    };
  }
}

describe("escalate vs dispatch", () => {
  it("builds crewmate criteria only from listed charters plus ask_captain", () => {
    const criteria = buildCrewmateCriteria([IMPLEMENTER, REVIEWER]);
    expect(Object.keys(criteria).sort()).toEqual([
      ASK_CAPTAIN,
      "implementer",
      "reviewer",
    ]);
    const empty = buildCrewmateCriteria([]);
    expect(Object.keys(empty)).toEqual([ASK_CAPTAIN]);
  });

  it("asks needs_captain and crewmate together", () => {
    const questions = escalateDispatchQuestions([IMPLEMENTER]);
    expect(questions.needs_captain?.type).toBe("noul");
    expect(questions.crewmate?.type).toBe("choice");
    if (questions.crewmate?.type === "choice") {
      expect(Object.keys(questions.crewmate.criteria).sort()).toEqual([
        ASK_CAPTAIN,
        "implementer",
      ]);
    }
  });

  it("normalizes ids and drops ask_captain duplicates / blanks", () => {
    const normalized = normalizeCrewmateCharters([
      { id: "Ask Captain", name: "Nope" },
      { id: "  Impl Engineer ", name: "Impl" },
      { id: "impl_engineer", name: "Dup" },
      { id: "", name: "Empty" },
      { id: "ok", name: "  " },
    ]);
    expect(normalized.map((c) => c.id)).toEqual(["impl_engineer"]);
  });

  it("is off by default via env parser", () => {
    expect(parseEscalateDispatchEnabled({})).toBe(false);
    expect(parseEscalateDispatchEnabled({ ORTO_JEV_ESCALATE_DISPATCH: "0" })).toBe(
      false,
    );
    expect(parseEscalateDispatchEnabled({ ORTO_JEV_ESCALATE_DISPATCH: "1" })).toBe(
      true,
    );
    expect(
      parseEscalateDispatchEnabled({ ORTO_JEV_FIRSTMATE_DISPATCH: "true" }),
    ).toBe(true);
    expect(resolveEscalateDispatchEnabled({})).toBe(false);
    expect(resolveEscalateDispatchEnabled({ dispatch: true })).toBe(true);
    expect(
      resolveEscalateDispatchEnabled({
        dispatch: false,
        env: { ORTO_JEV_ESCALATE_DISPATCH: "1" },
      }),
    ).toBe(false);
  });

  it("pass-through leaves verdict unset", () => {
    const decision = passThroughEscalateDispatch();
    expect(decision.verdict).toBe("unset");
    expect(decision.crewmate).toBe(ASK_CAPTAIN);
    expect(decision.source).toBe("pass_through");
  });

  it("default judgeEscalateDispatch stays pass-through and skips TypeSafe", async () => {
    const judge = new ScriptedJudge();
    const result = await judgeEscalateDispatch({
      request: "Fix a typo in README",
      charters: [IMPLEMENTER],
      judge,
      confidence: 0.8,
    });
    expect(result.enabled).toBe(false);
    expect(result.decision.verdict).toBe("unset");
    expect(judge.calls).toHaveLength(0);
  });

  it("architecture-invariant change scores needs_captain high / escalate", () => {
    const decision = heuristicEscalateDispatch({
      request:
        "Change a non-negotiable architecture invariant in the company brain playbook.",
      charters: [IMPLEMENTER, REVIEWER],
    });
    expect(decision.verdict).toBe("escalate");
    expect(decision.crewmate).toBe(ASK_CAPTAIN);
    expect(decision.needsCaptainBand).toBe("yes");
  });

  it("typo / test-fix can dispatch to an implementer charter when listed", () => {
    const decision = heuristicEscalateDispatch({
      request: "Fix typo in parser comments and land the test-fix.",
      charters: [IMPLEMENTER, REVIEWER],
    });
    expect(decision.verdict).toBe("dispatch");
    expect(decision.crewmate).toBe("implementer");
    expect(decision.needsCaptainBand).toBe("no");
  });

  it("missing charter list → only ask_captain", () => {
    const decision = heuristicEscalateDispatch({
      request: "Fix typo in parser comments and land the test-fix.",
      charters: [],
    });
    expect(decision.verdict).toBe("escalate");
    expect(decision.crewmate).toBe(ASK_CAPTAIN);
    expect(decision.reason).toMatch(/no crewmate charters/i);

    const criteria = buildCrewmateCriteria([]);
    expect(Object.keys(criteria)).toEqual([ASK_CAPTAIN]);
  });

  it("uses Jev when dispatch is opted in", async () => {
    const judge = new ScriptedJudge();
    judge.needsCaptain = 0.05;
    judge.crewmate = "implementer";
    const result = await judgeEscalateDispatch({
      request: "Fix typo in parser comments.",
      charters: [IMPLEMENTER],
      judge,
      confidence: 0.8,
      dispatch: true,
    });
    expect(result.enabled).toBe(true);
    expect(result.decision.source).toBe("jev");
    expect(result.decision.verdict).toBe("dispatch");
    expect(result.decision.crewmate).toBe("implementer");
    expect(judge.calls).toHaveLength(1);
    expect((judge.calls[0]?.state as { type?: string }).type).toBe(
      "escalate_dispatch",
    );
    const questions = judge.calls[0]?.questions;
    expect(questions?.needs_captain?.type).toBe("noul");
    expect(questions?.crewmate?.type).toBe("choice");
  });

  it("escalates when needs_captain is confidently high", () => {
    const decision = interpretEscalateDispatch({
      confidence: 0.8,
      charters: [IMPLEMENTER],
      answers: {
        needs_captain: { type: "noul", noul: 0.94 },
        crewmate: {
          type: "choice",
          choice: "implementer",
          probabilities: { implementer: 0.9 },
          confidence: 0.9,
        },
      },
    });
    expect(decision.verdict).toBe("escalate");
    expect(decision.crewmate).toBe(ASK_CAPTAIN);
    expect(decision.needsCaptainBand).toBe("yes");
  });

  it("escalates on low-confidence crewmate even when needs_captain is no", () => {
    const decision = interpretEscalateDispatch({
      confidence: 0.8,
      charters: [IMPLEMENTER],
      answers: {
        needs_captain: { type: "noul", noul: 0.1 },
        crewmate: {
          type: "choice",
          choice: "implementer",
          probabilities: { implementer: 0.4 },
          confidence: 0.4,
        },
      },
    });
    expect(decision.verdict).toBe("escalate");
    expect(decision.crewmate).toBe(ASK_CAPTAIN);
  });

  it("never dispatches an invented crewmate id", () => {
    const decision = interpretEscalateDispatch({
      confidence: 0.8,
      charters: [IMPLEMENTER],
      answers: {
        needs_captain: { type: "noul", noul: 0.05 },
        crewmate: {
          type: "choice",
          choice: "ghost_writer",
          probabilities: { ghost_writer: 0.99 },
          confidence: 0.99,
        },
      },
    });
    expect(decision.verdict).toBe("escalate");
    expect(decision.crewmate).toBe(ASK_CAPTAIN);
  });

  it("falls back to heuristic when Jev falls back", async () => {
    const judge = new ScriptedJudge();
    judge.fellBackFromJev = true;
    judge.needsCaptain = 0.05;
    judge.crewmate = "implementer";
    const result = await judgeEscalateDispatch({
      request:
        "Change a non-negotiable architecture invariant across the bank.",
      charters: [IMPLEMENTER],
      judge,
      confidence: 0.8,
      dispatch: true,
    });
    expect(result.decision.source).toBe("heuristic");
    expect(result.decision.verdict).toBe("escalate");
  });

  it("enables from ORTO_JEV_ESCALATE_DISPATCH", async () => {
    const result = await judgeEscalateDispatch({
      request: "Fix typo in parser comments and land the test-fix.",
      charters: [IMPLEMENTER],
      confidence: 0.8,
      env: { ORTO_JEV_ESCALATE_DISPATCH: "1" },
    });
    expect(result.enabled).toBe(true);
    expect(result.decision.verdict).toBe("dispatch");
    expect(result.decision.crewmate).toBe("implementer");
  });

  it("formatEscalateDispatchLines includes verdict and latency", () => {
    const decision = heuristicEscalateDispatch({
      request: "Fix typo in parser comments and land the test-fix.",
      charters: [IMPLEMENTER],
    });
    const lines = formatEscalateDispatchLines({
      decision,
      latencyMs: 22,
    });
    expect(
      lines.some((line) => line.includes("Escalate/dispatch: dispatch → implementer")),
    ).toBe(true);
    expect(
      lines.some((line) =>
        line.includes("latency: 22ms vs ungated escalate/dispatch"),
      ),
    ).toBe(true);
  });
});
