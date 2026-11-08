import { describe, expect, it } from "vitest";
import type { ChoiceAnswer, Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";
import {
  AUDIT_ACTIONS,
  auditQuestions,
  interpretAudit,
  judgeAuditItem,
} from "./audit.js";

function actionAnswer(choice: string, confidence: number): ChoiceAnswer {
  const rest = AUDIT_ACTIONS.filter((id) => id !== choice);
  const share = (1 - confidence) / rest.length;
  const probabilities: Record<string, number> = { [choice]: confidence };
  for (const id of rest) {
    probabilities[id] = share;
  }
  return { type: "choice", choice, probabilities, confidence };
}

class ScriptedJudge implements Judge {
  readonly id = "jev" as const;
  readonly calls: JudgeEvaluateInput[] = [];
  supported = 0.96;
  superseded = 0.05;
  action = "keep";
  actionConfidence = 0.93;

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    return {
      judgeId: "jev",
      answers: {
        still_supported_by_repo: { type: "noul", noul: this.supported },
        superseded: { type: "noul", noul: this.superseded },
        action: actionAnswer(this.action, this.actionConfidence),
      },
    };
  }
}

describe("audit judge", () => {
  it("asks still_supported_by_repo, superseded, and action", () => {
    expect(Object.keys(auditQuestions())).toEqual([
      "still_supported_by_repo",
      "superseded",
      "action",
    ]);
  });

  it("keeps a still-supported claim", async () => {
    const judge = new ScriptedJudge();
    const decision = await judgeAuditItem({
      item: {
        type: "document",
        id: "orto:docs/adr/0001.md#decision",
        text: "We keep the bank local.",
        sourceStillExists: true,
        currentFileExcerpt: "We keep the bank local.",
        bankMission: "Hold durable decisions.",
      },
      judge,
      confidence: 0.8,
    });
    expect(decision.action).toBe("keep");
    expect(decision.confidence).toBeGreaterThanOrEqual(0.8);
    expect(decision.reason).toContain("action=keep");
    expect(decision.reason).toContain("still_supported_by_repo=");
  });

  it("marks an unsupported superseded claim as delete_candidate", () => {
    const decision = interpretAudit({
      id: "orto:docs/adr/0001.md#decision",
      confidence: 0.8,
      answers: {
        still_supported_by_repo: { type: "noul", noul: 0.05 },
        superseded: { type: "noul", noul: 0.94 },
        action: actionAnswer("delete_candidate", 0.5),
      },
    });
    expect(decision.action).toBe("delete_candidate");
    expect(decision.reason).toContain("still_supported_by_repo=");
    expect(decision.reason).toContain("superseded=");
  });

  it("skips secret text without calling Jev", async () => {
    const judge = new ScriptedJudge();
    const decision = await judgeAuditItem({
      item: {
        type: "document",
        id: "orto:docs/adr/0001.md#decision",
        text: "token sk-test-abcdefghijklmnopqrstuvwxyz",
        sourceStillExists: true,
      },
      judge,
      confidence: 0.8,
    });
    expect(decision.action).toBe("keep");
    expect(decision.reason).toMatch(/secret/);
    expect(judge.calls).toHaveLength(0);
  });
});
