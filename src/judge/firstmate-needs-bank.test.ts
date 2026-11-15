import { describe, expect, it } from "vitest";
import {
  firstmateNeedsBankQuestions,
  formatFirstmateNeedsBankLines,
  heuristicFirstmateNeedsBank,
  interpretFirstmateNeedsBank,
  judgeFirstmateNeedsBank,
  parseNeedsBankEnabled,
  passThroughFirstmateNeedsBank,
  resolveNeedsBankEnabled,
} from "./firstmate-needs-bank.js";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";

class ScriptedJudge implements Judge {
  readonly id = "jev" as const;
  readonly calls: JudgeEvaluateInput[] = [];
  noul = 0.95;
  fellBackFromJev = false;

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    return {
      judgeId: "jev",
      fellBackFromJev: this.fellBackFromJev,
      answers: {
        needs_project_bank: { type: "noul", noul: this.noul },
      },
    };
  }
}

describe("firstmate needs_project_bank", () => {
  it("asks needs_project_bank", () => {
    expect(Object.keys(firstmateNeedsBankQuestions())).toEqual([
      "needs_project_bank",
    ]);
    expect(firstmateNeedsBankQuestions().needs_project_bank?.type).toBe("noul");
  });

  it("is off by default via env parser", () => {
    expect(parseNeedsBankEnabled({})).toBe(false);
    expect(parseNeedsBankEnabled({ ORTO_JEV_FIRSTMATE_NEEDS_BANK: "0" })).toBe(
      false,
    );
    expect(parseNeedsBankEnabled({ ORTO_JEV_FIRSTMATE_NEEDS_BANK: "1" })).toBe(
      true,
    );
    expect(
      parseNeedsBankEnabled({ NOCCIOLO_JEV_FIRSTMATE_NEEDS_BANK: "true" }),
    ).toBe(true);
    expect(resolveNeedsBankEnabled({})).toBe(false);
    expect(resolveNeedsBankEnabled({ needsBank: true })).toBe(true);
    expect(
      resolveNeedsBankEnabled({
        needsBank: false,
        env: { ORTO_JEV_FIRSTMATE_NEEDS_BANK: "1" },
      }),
    ).toBe(false);
  });

  it("pass-through leaves verdict unset", () => {
    const decision = passThroughFirstmateNeedsBank();
    expect(decision.verdict).toBe("unset");
    expect(decision.source).toBe("pass_through");
  });

  it("default judgeFirstmateNeedsBank stays pass-through and skips TypeSafe", async () => {
    const judge = new ScriptedJudge();
    const result = await judgeFirstmateNeedsBank({
      request: "Why do we keep the bank local-first?",
      judge,
      confidence: 0.8,
    });
    expect(result.enabled).toBe(false);
    expect(result.decision.verdict).toBe("unset");
    expect(judge.calls).toHaveLength(0);
  });

  it("heuristically skips bank for pure code tasks", () => {
    expect(
      heuristicFirstmateNeedsBank("Fix typo in README and add unit tests").verdict,
    ).toBe("skip_bank");
    expect(
      heuristicFirstmateNeedsBank("Refactor parseFoo and add tests").verdict,
    ).toBe("skip_bank");
  });

  it("heuristically uses bank for architecture / playbook asks", () => {
    expect(
      heuristicFirstmateNeedsBank(
        "Why do we use Postgres instead of MySQL for the company brain?",
      ).verdict,
    ).toBe("use_bank");
    expect(
      heuristicFirstmateNeedsBank("Implement feature X per ADR-12 boundaries").verdict,
    ).toBe("use_bank");
  });

  it("heuristically escalates on ambiguous requests", () => {
    expect(heuristicFirstmateNeedsBank("Do the thing").verdict).toBe("escalate");
  });

  it("marks confident no as skip_bank when enabled", async () => {
    const judge = new ScriptedJudge();
    judge.noul = 0.05;
    const result = await judgeFirstmateNeedsBank({
      request: "Fix lint errors in src/cli.ts",
      judge,
      confidence: 0.8,
      needsBank: true,
    });
    expect(result.enabled).toBe(true);
    expect(result.decision.source).toBe("jev");
    expect(result.decision.verdict).toBe("skip_bank");
    expect(judge.calls).toHaveLength(1);
  });

  it("marks confident yes as use_bank when enabled", async () => {
    const judge = new ScriptedJudge();
    judge.noul = 0.94;
    const result = await judgeFirstmateNeedsBank({
      request: "Why do we keep Hindsight local-first?",
      judge,
      confidence: 0.8,
      needsBank: true,
    });
    expect(result.decision.verdict).toBe("use_bank");
    expect(result.decision.needsProjectBankBand).toBe("yes");
  });

  it("escalates when needs_project_bank is uncertain", () => {
    const decision = interpretFirstmateNeedsBank({
      confidence: 0.8,
      answers: {
        needs_project_bank: { type: "noul", noul: 0.5 },
      },
    });
    expect(decision.verdict).toBe("escalate");
    expect(decision.needsProjectBankBand).toBe("uncertain");
  });

  it("falls back to heuristic when Jev falls back", async () => {
    const judge = new ScriptedJudge();
    judge.fellBackFromJev = true;
    judge.noul = 0.99;
    const result = await judgeFirstmateNeedsBank({
      request: "Bump the lodash dependency",
      judge,
      confidence: 0.8,
      needsBank: true,
    });
    expect(result.decision.source).toBe("heuristic");
    expect(result.decision.verdict).toBe("skip_bank");
  });

  it("enables from ORTO_JEV_FIRSTMATE_NEEDS_BANK", async () => {
    const result = await judgeFirstmateNeedsBank({
      request: "Fix typo in AGENTS.md",
      confidence: 0.8,
      env: { ORTO_JEV_FIRSTMATE_NEEDS_BANK: "1" },
    });
    expect(result.enabled).toBe(true);
    expect(result.decision.verdict).toBe("skip_bank");
  });

  it("skips TypeSafe when the request contains a secret", async () => {
    const judge = new ScriptedJudge();
    const result = await judgeFirstmateNeedsBank({
      request: "Rotate sk-ant-api03-abcdefghijklmnopqrstuvwxyz in docs",
      judge,
      confidence: 0.8,
      needsBank: true,
    });
    expect(judge.calls).toHaveLength(0);
    expect(result.decision.source).toBe("heuristic");
  });

  it("formatFirstmateNeedsBankLines includes verdict and latency", () => {
    const decision = interpretFirstmateNeedsBank({
      confidence: 0.8,
      answers: {
        needs_project_bank: { type: "noul", noul: 0.1 },
      },
    });
    const lines = formatFirstmateNeedsBankLines({
      decision,
      latencyMs: 12,
    });
    expect(
      lines.some((line) => line.includes("Firstmate needs_bank: skip_bank")),
    ).toBe(true);
    expect(
      lines.some((line) =>
        line.includes("latency: 12ms vs ungated captain request"),
      ),
    ).toBe(true);
  });
});
