import { describe, expect, it } from "vitest";
import {
  formatTaskFollowupLines,
  heuristicTaskFollowup,
  interpretTaskFollowup,
  judgeTaskFollowup,
  parseTaskFollowupEnabled,
  passThroughTaskFollowup,
  resolveTaskFollowupEnabled,
  taskFollowupQuestions,
} from "./task-followup.js";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";

class ScriptedJudge implements Judge {
  readonly id = "jev" as const;
  readonly calls: JudgeEvaluateInput[] = [];
  choice = "both";
  confidence = 0.93;
  fellBackFromJev = false;

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    return {
      judgeId: "jev",
      fellBackFromJev: this.fellBackFromJev,
      answers: {
        followup: {
          type: "choice",
          choice: this.choice,
          probabilities: { [this.choice]: this.confidence },
          confidence: this.confidence,
        },
      },
    };
  }
}

describe("task followup", () => {
  it("asks a followup choice with retain_to_bank, pr_only, and both", () => {
    const questions = taskFollowupQuestions();
    expect(questions.followup?.type).toBe("choice");
    if (questions.followup?.type === "choice") {
      expect(Object.keys(questions.followup.criteria).sort()).toEqual([
        "both",
        "pr_only",
        "retain_to_bank",
      ]);
    }
  });

  it("is off by default via env parser", () => {
    expect(parseTaskFollowupEnabled({})).toBe(false);
    expect(parseTaskFollowupEnabled({ ORTO_JEV_TASK_FOLLOWUP: "0" })).toBe(false);
    expect(parseTaskFollowupEnabled({ ORTO_JEV_TASK_FOLLOWUP: "1" })).toBe(true);
    expect(parseTaskFollowupEnabled({ ORTO_JEV_FIRSTMATE_FOLLOWUP: "true" })).toBe(
      true,
    );
    expect(resolveTaskFollowupEnabled({})).toBe(false);
    expect(resolveTaskFollowupEnabled({ followup: true })).toBe(true);
    expect(
      resolveTaskFollowupEnabled({
        followup: false,
        env: { ORTO_JEV_TASK_FOLLOWUP: "1" },
      }),
    ).toBe(false);
  });

  it("pass-through leaves verdict unset", () => {
    const decision = passThroughTaskFollowup();
    expect(decision.verdict).toBe("unset");
    expect(decision.source).toBe("pass_through");
  });

  it("default judgeTaskFollowup stays pass-through and skips TypeSafe", async () => {
    const judge = new ScriptedJudge();
    const result = await judgeTaskFollowup({
      description: "Merged ADR-12: keep the bank local-first.",
      judge,
      confidence: 0.8,
    });
    expect(result.enabled).toBe(false);
    expect(result.decision.verdict).toBe("unset");
    expect(judge.calls).toHaveLength(0);
  });

  it("ADR merge description prefers both or retain_to_bank", () => {
    const adr = heuristicTaskFollowup(
      "Merged ADR-12: keep the Hindsight bank local-first.",
    );
    expect(["both", "retain_to_bank"]).toContain(adr.verdict);
    expect(adr.agentMessage).toMatch(/orto store|orto seed/);
    expect(adr.agentMessage).toMatch(/Do not MCP-retain/);

    const withPr = heuristicTaskFollowup(
      "Implement feature X per ADR-12 and open a PR for the ADR merge.",
    );
    expect(withPr.verdict).toBe("both");
  });

  it("pure bugfix PR prefers pr_only", () => {
    const decision = heuristicTaskFollowup(
      "Fix null pointer in parser (bugfix).",
    );
    expect(decision.verdict).toBe("pr_only");
    expect(decision.agentMessage).toMatch(/PR only/i);
  });

  it("uses Jev when followup is opted in", async () => {
    const judge = new ScriptedJudge();
    judge.choice = "retain_to_bank";
    const result = await judgeTaskFollowup({
      description: "Updated coding standards in docs/standards.md",
      judge,
      confidence: 0.8,
      followup: true,
    });
    expect(result.enabled).toBe(true);
    expect(result.decision.source).toBe("jev");
    expect(result.decision.verdict).toBe("retain_to_bank");
    expect(judge.calls).toHaveLength(1);
    expect((judge.calls[0]?.state as { type?: string }).type).toBe(
      "task_followup",
    );
  });

  it("escalates on low-confidence Jev choice", () => {
    const decision = interpretTaskFollowup({
      description: "Fix null pointer in parser (bugfix).",
      confidence: 0.8,
      answers: {
        followup: {
          type: "choice",
          choice: "pr_only",
          probabilities: { pr_only: 0.4 },
          confidence: 0.4,
        },
      },
    });
    expect(decision.verdict).toBe("escalate");
    expect(decision.reason).toContain("escalate");
  });

  it("falls back to heuristic when Jev falls back", async () => {
    const judge = new ScriptedJudge();
    judge.fellBackFromJev = true;
    judge.choice = "both";
    const result = await judgeTaskFollowup({
      description: "Fix null pointer in parser (bugfix).",
      judge,
      confidence: 0.8,
      followup: true,
    });
    expect(result.decision.source).toBe("heuristic");
    expect(result.decision.verdict).toBe("pr_only");
  });

  it("enables from ORTO_JEV_TASK_FOLLOWUP", async () => {
    const result = await judgeTaskFollowup({
      description: "Merged ADR-7: prefer durable ADRs for bank seeding.",
      confidence: 0.8,
      env: { ORTO_JEV_TASK_FOLLOWUP: "1" },
    });
    expect(result.enabled).toBe(true);
    expect(["both", "retain_to_bank"]).toContain(result.decision.verdict);
  });

  it("formatTaskFollowupLines includes verdict and latency", () => {
    const decision = heuristicTaskFollowup(
      "Fix null pointer in parser (bugfix).",
    );
    const lines = formatTaskFollowupLines({
      decision,
      latencyMs: 18,
    });
    expect(lines.some((line) => line.includes("Task followup: pr_only"))).toBe(
      true,
    );
    expect(
      lines.some((line) => line.includes("latency: 18ms vs ungated followup")),
    ).toBe(true);
  });
});
