import { describe, expect, it } from "vitest";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";
import {
  interpretMissionFit,
  judgeMissionFit,
  missionFitQuestions,
} from "./mission-fit.js";

class ScriptedJudge implements Judge {
  readonly id = "jev" as const;
  readonly calls: JudgeEvaluateInput[] = [];
  score = 3;
  scoreConfidence = 0.92;
  conflict = 0.08;

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    return {
      judgeId: "jev",
      answers: {
        mission_fit: {
          type: "score",
          score: this.score,
          legend: {},
          probabilities: {},
          confidence: this.scoreConfidence,
        },
        directives_conflict_with_docs: { type: "noul", noul: this.conflict },
      },
    };
  }
}

describe("mission fit", () => {
  it("asks mission_fit and directives_conflict_with_docs", () => {
    expect(Object.keys(missionFitQuestions())).toEqual([
      "mission_fit",
      "directives_conflict_with_docs",
    ]);
  });

  it("flags review when mission_fit is low with high confidence", () => {
    const decision = interpretMissionFit({
      confidence: 0.8,
      answers: {
        mission_fit: {
          type: "score",
          score: 1,
          legend: {},
          probabilities: {},
          confidence: 0.91,
        },
        directives_conflict_with_docs: { type: "noul", noul: 0.1 },
      },
    });
    expect(decision.needsReview).toBe(true);
    expect(decision.reason).toContain("review mission before applying");
    expect(decision.missionFit?.score).toBe(1);
  });

  it("does not require review for a high mission_fit score", async () => {
    const judge = new ScriptedJudge();
    const decision = await judgeMissionFit({
      state: {
        projectName: "orto",
        mission: "Hold durable knowledge for the Orto CLI.",
        directives: ["Prefer ADRs over chat history."],
        repoExcerpt: "Orto turns durable project knowledge into Hindsight banks.",
      },
      judge,
      confidence: 0.8,
    });
    expect(decision.needsReview).toBe(false);
    expect(decision.missionFit?.score).toBe(3);
    expect(judge.calls[0]?.questions).toEqual(missionFitQuestions());
  });

  it("ignores a low score when confidence is below threshold", () => {
    const decision = interpretMissionFit({
      confidence: 0.8,
      answers: {
        mission_fit: {
          type: "score",
          score: 0,
          legend: {},
          probabilities: {},
          confidence: 0.4,
        },
        directives_conflict_with_docs: { type: "noul", noul: 0.2 },
      },
    });
    expect(decision.needsReview).toBe(false);
  });
});
