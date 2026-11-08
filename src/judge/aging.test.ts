import { describe, expect, it } from "vitest";
import type { ChoiceAnswer } from "./types.js";
import { AUDIT_ACTIONS, interpretAudit } from "./audit.js";
import type { AuditLayer } from "./aging.js";

function actionAnswer(choice: string, confidence: number): ChoiceAnswer {
  const rest = AUDIT_ACTIONS.filter((id) => id !== choice);
  const share = (1 - confidence) / rest.length;
  const probabilities: Record<string, number> = { [choice]: confidence };
  for (const id of rest) {
    probabilities[id] = share;
  }
  return { type: "choice", choice, probabilities, confidence };
}

function mockedAnswers(input: {
  supported: number;
  superseded: number;
  action: string;
  actionConfidence: number;
}) {
  return {
    still_supported_by_repo: { type: "noul" as const, noul: input.supported },
    superseded: { type: "noul" as const, noul: input.superseded },
    action: actionAnswer(input.action, input.actionConfidence),
  };
}

describe("layer-specific aging policy", () => {
  it("archives world facts when the source is gone", () => {
    const decision = interpretAudit({
      id: "world:local-bank",
      confidence: 0.8,
      answers: mockedAnswers({
        supported: 0.9,
        superseded: 0.1,
        action: "keep",
        actionConfidence: 0.95,
      }),
      aging: { layer: "world", sourceGone: true },
    });
    expect(decision.action).toBe("archive");
    expect(decision.agingBias).toBe("source_gone");
    expect(decision.reason).toContain("layer=world");
    expect(decision.reason).toContain("aging=source_gone");
  });

  it("archives experience facts on hash mismatch when still_supported is low", () => {
    const decision = interpretAudit({
      id: "experience:setup-notes",
      confidence: 0.8,
      answers: mockedAnswers({
        supported: 0.05,
        superseded: 0.1,
        action: "keep",
        actionConfidence: 0.4,
      }),
      aging: { layer: "experience", hashMismatch: true },
    });
    expect(decision.action).toBe("archive");
    expect(decision.agingBias).toBe("hash_mismatch_unsupported");
    expect(decision.reason).toContain("layer=experience");
  });

  it("marks observations when proof-count is low and a contradicting candidate exists", () => {
    const decision = interpretAudit({
      id: "obs:redis-choice",
      confidence: 0.8,
      answers: mockedAnswers({
        supported: 0.5,
        superseded: 0.5,
        action: "keep",
        actionConfidence: 0.4,
      }),
      aging: {
        layer: "observation",
        proofCountLow: true,
        hasContradictingCandidate: true,
      },
    });
    expect(decision.action).toBe("supersede");
    expect(decision.agingBias).toBe("low_proof_contradiction");
    expect(decision.reason).toContain("layer=observation");
  });

  it("prefers refresh_mental_model over delete for mental models", () => {
    const decision = interpretAudit({
      id: "mm:architecture",
      confidence: 0.8,
      answers: mockedAnswers({
        supported: 0.1,
        superseded: 0.9,
        action: "delete_candidate",
        actionConfidence: 0.95,
      }),
      aging: { layer: "mental_model" },
    });
    expect(decision.action).toBe("refresh_mental_model");
    expect(decision.agingBias).toBe("prefer_refresh_over_delete");
    expect(decision.reason).toContain("layer=mental_model");
  });

  it("prefers refresh_mental_model over archive for mental models", () => {
    const decision = interpretAudit({
      id: "mm:standards",
      confidence: 0.8,
      answers: mockedAnswers({
        supported: 0.05,
        superseded: 0.1,
        action: "archive",
        actionConfidence: 0.91,
      }),
      aging: { layer: "mental_model" },
    });
    expect(decision.action).toBe("refresh_mental_model");
    expect(decision.agingBias).toBe("prefer_refresh_over_delete");
  });

  it("keeps documents for re-retain when the section was rewritten", () => {
    const decision = interpretAudit({
      id: "orto:docs/adr/0001.md#decision",
      confidence: 0.8,
      answers: mockedAnswers({
        supported: 0.2,
        superseded: 0.1,
        action: "archive",
        actionConfidence: 0.4,
      }),
      aging: { layer: "document", sectionRewritten: true },
    });
    expect(decision.action).toBe("keep");
    expect(decision.agingBias).toBe("re_retain");
    expect(decision.reason).toContain("layer=document");
  });

  it("archives documents when the source was deleted", () => {
    const decision = interpretAudit({
      id: "orto:docs/adr/0001.md#decision",
      confidence: 0.8,
      answers: mockedAnswers({
        supported: 0.9,
        superseded: 0.1,
        action: "keep",
        actionConfidence: 0.95,
      }),
      aging: { layer: "document", sourceGone: true },
    });
    expect(decision.action).toBe("archive");
    expect(decision.agingBias).toBe("source_deleted");
    expect(decision.reason).toContain("aging=source_deleted");
  });

  it("tags every audited layer in the reason without forcing a bias", () => {
    const layers: AuditLayer[] = [
      "world",
      "experience",
      "observation",
      "mental_model",
      "document",
    ];
    for (const layer of layers) {
      const decision = interpretAudit({
        id: `${layer}:stable`,
        confidence: 0.8,
        answers: mockedAnswers({
          supported: 0.95,
          superseded: 0.05,
          action: "keep",
          actionConfidence: 0.93,
        }),
        aging: { layer },
      });
      expect(decision.action).toBe("keep");
      expect(decision.layer).toBe(layer);
      expect(decision.reason).toContain(`layer=${layer}`);
      expect(decision.agingBias).toBeUndefined();
    }
  });
});
