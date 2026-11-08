import { describe, expect, it } from "vitest";
import type { ChoiceAnswer, Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";
import {
  editDurabilityQuestions,
  interpretEditDurability,
  judgeEditDurability,
} from "./edit-durability.js";

const PREVIOUS = `# ADR 0001

## Decision

We use Redis for the local bank. This architecture decision is a project invariant.
`;

const TYPO_ONLY = `# ADR 0001

## Decision

We use Redis for the local bank. This architecture decision is a project invariant!
`;

const CLAIM_CHANGED = `# ADR 0001

## Decision

We no longer use Redis; use SQLite for the local bank. This architecture decision is a project invariant.
`;

const WORKAROUND = `# ADR 0001

## Decision

Temporary hack: point the bank at /tmp for today. TODO undo this before merge.
`;

function actionAnswer(choice: string, confidence: number): ChoiceAnswer {
  const rest = ["re_retain", "skip", "review"].filter((id) => id !== choice);
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
  claim = 0.05;
  workaround = 0.04;
  action = "skip";
  actionConfidence = 0.93;

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    return {
      judgeId: "jev",
      answers: {
        claim_changed: { type: "noul", noul: this.claim },
        looks_like_workaround: { type: "noul", noul: this.workaround },
        action: actionAnswer(this.action, this.actionConfidence),
      },
    };
  }
}

describe("store edit durability", () => {
  it("asks claim_changed, looks_like_workaround, and action", () => {
    const questions = editDurabilityQuestions();
    expect(Object.keys(questions)).toEqual([
      "claim_changed",
      "looks_like_workaround",
      "action",
    ]);
    expect(questions.claim_changed?.type).toBe("noul");
    expect(questions.looks_like_workaround?.type).toBe("noul");
    expect(questions.action?.type).toBe("choice");
  });

  it("skips a typo-only fixture", async () => {
    const judge = new ScriptedJudge();
    judge.claim = 0.04;
    judge.workaround = 0.03;
    judge.action = "skip";
    const decision = await judgeEditDurability({
      path: "docs/adr/0001.md",
      previousText: PREVIOUS,
      currentText: TYPO_ONLY,
      judge,
      confidence: 0.8,
    });
    expect(decision.action).toBe("skip");
    expect(decision.reason).toMatch(/wording|formatting/i);
    expect(judge.calls).toHaveLength(1);
  });

  it("re-retains when Redis becomes SQLite", async () => {
    const judge = new ScriptedJudge();
    judge.claim = 0.96;
    judge.workaround = 0.05;
    judge.action = "re_retain";
    const decision = await judgeEditDurability({
      path: "docs/adr/0001.md",
      previousText: PREVIOUS,
      currentText: CLAIM_CHANGED,
      judge,
      confidence: 0.8,
    });
    expect(decision.action).toBe("re_retain");
  });

  it("reviews a temporary workaround instead of retaining", async () => {
    const judge = new ScriptedJudge();
    judge.claim = 0.9;
    judge.workaround = 0.95;
    judge.action = "re_retain";
    const decision = await judgeEditDurability({
      path: "docs/adr/0001.md",
      previousText: PREVIOUS,
      currentText: WORKAROUND,
      judge,
      confidence: 0.8,
    });
    expect(decision.action).toBe("review");
    expect(decision.reason).toMatch(/workaround/i);
  });

  it("interprets a mid-range answer as review", () => {
    const decision = interpretEditDurability({
      path: "docs/guide.md",
      confidence: 0.8,
      answers: {
        claim_changed: { type: "noul", noul: 0.55 },
        looks_like_workaround: { type: "noul", noul: 0.4 },
        action: actionAnswer("re_retain", 0.5),
      },
    });
    expect(decision.action).toBe("review");
  });
});
