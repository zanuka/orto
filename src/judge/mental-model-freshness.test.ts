import { describe, expect, it } from "vitest";
import type { ChoiceAnswer, Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";
import {
  MENTAL_MODEL_FRESHNESS_ACTIONS,
  freshnessToAuditDecision,
  interpretMentalModelFreshness,
  judgeMentalModelFreshness,
  mentalModelFreshnessQuestions,
} from "./mental-model-freshness.js";

function actionAnswer(choice: string, confidence: number): ChoiceAnswer {
  const rest = MENTAL_MODEL_FRESHNESS_ACTIONS.filter((id) => id !== choice);
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
  stillAnswers = 0.95;
  newEvidence = 0.1;
  action = "leave";
  actionConfidence = 0.93;

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    return {
      judgeId: "jev",
      answers: {
        model_still_answers_source_query: {
          type: "noul",
          noul: this.stillAnswers,
        },
        new_evidence_since_refresh: { type: "noul", noul: this.newEvidence },
        action: actionAnswer(this.action, this.actionConfidence),
      },
    };
  }
}

describe("mental-model freshness", () => {
  it("asks model_still_answers_source_query, new_evidence_since_refresh, and action", () => {
    expect(Object.keys(mentalModelFreshnessQuestions())).toEqual([
      "model_still_answers_source_query",
      "new_evidence_since_refresh",
      "action",
    ]);
  });

  it("marks refresh without proposing delete", () => {
    const decision = interpretMentalModelFreshness({
      id: "architecture-decisions",
      confidence: 0.8,
      answers: {
        model_still_answers_source_query: { type: "noul", noul: 0.9 },
        new_evidence_since_refresh: { type: "noul", noul: 0.94 },
        action: actionAnswer("refresh", 0.92),
      },
    });
    expect(decision.action).toBe("refresh");
    expect(decision.action).not.toBe("archive");
    const plan = freshnessToAuditDecision(decision);
    expect(plan.action).toBe("refresh_mental_model");
    expect(plan.action).not.toBe("delete_candidate");
    expect(plan.freshnessAction).toBe("refresh");
    expect(plan.layer).toBe("mental_model");
    expect(plan.reason).toContain("action=refresh");
  });

  it("keeps retarget_query as review-only without rewriting the query", async () => {
    const judge = new ScriptedJudge();
    judge.stillAnswers = 0.05;
    judge.newEvidence = 0.2;
    judge.action = "retarget_query";
    judge.actionConfidence = 0.91;
    const sourceQuery =
      "What architectural decisions use Redis for the primary store?";
    const decision = await judgeMentalModelFreshness({
      model: {
        id: "architecture-decisions",
        name: "Architecture Decisions",
        sourceQuery,
        recentObservations: [
          {
            id: "obs-1",
            summary: "SQLite is the local-first store for Orto banks.",
          },
        ],
      },
      judge,
      confidence: 0.8,
    });
    expect(decision.action).toBe("retarget_query");
    expect(decision.reviewOnly).toBe(true);
    expect(decision.reason).toContain("review_only");
    const state = judge.calls[0]?.state as { sourceQuery?: string };
    expect(state.sourceQuery).toBe(sourceQuery);
    const plan = freshnessToAuditDecision(decision);
    expect(plan.action).toBe("keep");
    expect(plan.reviewOnly).toBe(true);
    expect(plan.freshnessAction).toBe("retarget_query");
    expect(plan.action).not.toBe("delete_candidate");
  });

  it("refreshes when new evidence is confident and the action is weak", () => {
    const decision = interpretMentalModelFreshness({
      id: "project-context",
      confidence: 0.8,
      answers: {
        model_still_answers_source_query: { type: "noul", noul: 0.9 },
        new_evidence_since_refresh: { type: "noul", noul: 0.93 },
        action: actionAnswer("leave", 0.4),
      },
    });
    expect(decision.action).toBe("refresh");
    expect(freshnessToAuditDecision(decision).action).toBe(
      "refresh_mental_model",
    );
  });

  it("proposes retarget_query when the model no longer answers the source query", () => {
    const decision = interpretMentalModelFreshness({
      id: "coding-standards",
      confidence: 0.8,
      answers: {
        model_still_answers_source_query: { type: "noul", noul: 0.08 },
        new_evidence_since_refresh: { type: "noul", noul: 0.2 },
        action: actionAnswer("leave", 0.4),
      },
    });
    expect(decision.action).toBe("retarget_query");
    expect(decision.reviewOnly).toBe(true);
  });

  it("leaves a still-current model", async () => {
    const judge = new ScriptedJudge();
    const decision = await judgeMentalModelFreshness({
      model: {
        id: "coding-standards",
        name: "Coding Standards",
        sourceQuery: "What coding standards should agents follow?",
        content: "Prefer small focused changes and strong TypeScript typing.",
      },
      judge,
      confidence: 0.8,
    });
    expect(decision.action).toBe("leave");
    expect(freshnessToAuditDecision(decision).action).toBe("keep");
    expect(judge.calls[0]?.questions).toEqual(mentalModelFreshnessQuestions());
  });

  it("never maps freshness archive to delete_candidate", () => {
    const decision = interpretMentalModelFreshness({
      id: "legacy-page",
      confidence: 0.8,
      answers: {
        model_still_answers_source_query: { type: "noul", noul: 0.1 },
        new_evidence_since_refresh: { type: "noul", noul: 0.1 },
        action: actionAnswer("archive", 0.94),
      },
    });
    expect(decision.action).toBe("archive");
    const plan = freshnessToAuditDecision(decision);
    expect(plan.action).toBe("archive");
    expect(plan.action).not.toBe("delete_candidate");
  });
});
