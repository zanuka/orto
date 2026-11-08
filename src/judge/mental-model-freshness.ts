/*
Mental-model freshness decides leave vs refresh for pinned models.
Orto audit --judge jev calls this once per mental model with the model id,
source query, optional content, and recent observation summaries. One Jev call
asks whether the model still answers its source query
(model_still_answers_source_query), whether there is new evidence since the
last refresh (new_evidence_since_refresh), and which action to take
(leave, refresh, retarget_query, or archive).

refresh marks the audit plan without proposing delete. retarget_query is
review-only: the plan records it, and Orto does not rewrite the source query.
*/

import type { AuditAction, AuditDecision } from "./audit.js";
import { noulBand, type NoulBand } from "./relevance.js";
import {
  assertJevStateSendable,
  containsInlineSecret,
  JEV_DOCUMENT_ID_MAX_CHARS,
  JEV_MISSION_MAX_CHARS,
  JEV_OVERLAP_MAX,
  JEV_OVERLAP_SUMMARY_MAX_CHARS,
  JEV_PATH_MAX_CHARS,
  JEV_SECTION_MAX_CHARS,
  type JevOverlap,
} from "./state.js";
import type {
  ChoiceQuestion,
  Judge,
  JudgeAnswer,
  JudgeQuestion,
  NoulQuestion,
} from "./types.js";

export const MENTAL_MODEL_FRESHNESS_ACTIONS = [
  "leave",
  "refresh",
  "retarget_query",
  "archive",
] as const;

export type MentalModelFreshnessAction =
  (typeof MENTAL_MODEL_FRESHNESS_ACTIONS)[number];

export interface MentalModelFreshnessState {
  id: string;
  name?: string;
  sourceQuery: string;
  content?: string;
  bankMission?: string;
  lastRefreshedAt?: string;
  recentObservations?: readonly JevOverlap[];
}

export interface MentalModelFreshnessDecision {
  id: string;
  action: MentalModelFreshnessAction;
  confidence: number;
  reason: string;
  modelStillAnswersSourceQuery?: number;
  modelStillAnswersBand?: NoulBand;
  newEvidenceSinceRefresh?: number;
  newEvidenceBand?: NoulBand;
  chosenAction?: string;
  actionConfidence?: number;
  reviewOnly?: boolean;
}

export function mentalModelFreshnessQuestions(): Record<string, JudgeQuestion> {
  return {
    model_still_answers_source_query: stillAnswersQuestion(),
    new_evidence_since_refresh: newEvidenceQuestion(),
    action: actionQuestion(),
  };
}

export function interpretMentalModelFreshness(input: {
  id: string;
  answers: Record<string, JudgeAnswer>;
  confidence: number;
}): MentalModelFreshnessDecision {
  const stillAnswers = readNoul(input.answers.model_still_answers_source_query);
  const newEvidence = readNoul(input.answers.new_evidence_since_refresh);
  const chosen = readChoice(input.answers.action);
  const stillBand =
    stillAnswers === undefined
      ? undefined
      : noulBand(stillAnswers, input.confidence);
  const evidenceBand =
    newEvidence === undefined
      ? undefined
      : noulBand(newEvidence, input.confidence);
  const actionConfident =
    chosen !== undefined &&
    MENTAL_MODEL_FRESHNESS_ACTIONS.includes(
      chosen.choice as MentalModelFreshnessAction,
    ) &&
    chosen.confidence + 1e-9 >= input.confidence;

  const base = {
    id: input.id,
    ...(stillAnswers !== undefined
      ? { modelStillAnswersSourceQuery: stillAnswers }
      : {}),
    ...(stillBand !== undefined ? { modelStillAnswersBand: stillBand } : {}),
    ...(newEvidence !== undefined
      ? { newEvidenceSinceRefresh: newEvidence }
      : {}),
    ...(evidenceBand !== undefined ? { newEvidenceBand: evidenceBand } : {}),
    ...(chosen !== undefined
      ? { chosenAction: chosen.choice, actionConfidence: chosen.confidence }
      : {}),
  };

  if (actionConfident && chosen !== undefined) {
    return finalizeFreshness({
      ...base,
      action: chosen.choice as MentalModelFreshnessAction,
      confidence: chosen.confidence,
      stillAnswers,
      stillBand,
      newEvidence,
      evidenceBand,
    });
  }

  if (stillBand === "no") {
    return finalizeFreshness({
      ...base,
      action: "retarget_query",
      confidence: input.confidence,
      stillAnswers,
      stillBand,
      newEvidence,
      evidenceBand,
    });
  }

  if (evidenceBand === "yes") {
    return finalizeFreshness({
      ...base,
      action: "refresh",
      confidence: input.confidence,
      stillAnswers,
      stillBand,
      newEvidence,
      evidenceBand,
    });
  }

  if (stillBand === "yes" && evidenceBand === "no") {
    return finalizeFreshness({
      ...base,
      action: "leave",
      confidence: input.confidence,
      stillAnswers,
      stillBand,
      newEvidence,
      evidenceBand,
    });
  }

  return finalizeFreshness({
    ...base,
    action: "leave",
    confidence: chosen?.confidence ?? 0,
    stillAnswers,
    stillBand,
    newEvidence,
    evidenceBand,
    review: true,
    threshold: input.confidence,
  });
}

export async function judgeMentalModelFreshness(input: {
  model: MentalModelFreshnessState;
  judge: Judge;
  confidence: number;
}): Promise<MentalModelFreshnessDecision> {
  if (
    containsInlineSecret(input.model.id) ||
    containsInlineSecret(input.model.sourceQuery) ||
    (input.model.content !== undefined &&
      containsInlineSecret(input.model.content)) ||
    (input.model.name !== undefined && containsInlineSecret(input.model.name))
  ) {
    return {
      id: input.model.id,
      action: "leave",
      confidence: 0,
      reason: "item matched a secret pattern; not sent to Jev",
    };
  }

  const overlaps = (input.model.recentObservations ?? [])
    .slice(0, JEV_OVERLAP_MAX)
    .map((item) => ({
      ...(item.id !== undefined ? { id: item.id.slice(0, 128) } : {}),
      summary: item.summary.slice(0, JEV_OVERLAP_SUMMARY_MAX_CHARS),
      ...(item.documentId !== undefined
        ? { documentId: item.documentId.slice(0, JEV_DOCUMENT_ID_MAX_CHARS) }
        : {}),
    }));

  const state = {
    type: "mental_model",
    layer: "mental_model",
    id: input.model.id.slice(0, JEV_DOCUMENT_ID_MAX_CHARS),
    sourceQuery: input.model.sourceQuery.slice(0, JEV_SECTION_MAX_CHARS),
    ...(input.model.name !== undefined
      ? { name: input.model.name.slice(0, JEV_PATH_MAX_CHARS) }
      : {}),
    ...(input.model.content !== undefined
      ? { content: input.model.content.slice(0, JEV_SECTION_MAX_CHARS) }
      : {}),
    ...(input.model.bankMission !== undefined
      ? { bankMission: input.model.bankMission.slice(0, JEV_MISSION_MAX_CHARS) }
      : {}),
    ...(input.model.lastRefreshedAt !== undefined
      ? { lastRefreshedAt: input.model.lastRefreshedAt.slice(0, 64) }
      : {}),
    ...(overlaps.length > 0 ? { recentObservations: overlaps } : {}),
  };

  try {
    assertJevStateSendable(state);
  } catch {
    return {
      id: input.model.id,
      action: "leave",
      confidence: 0,
      reason: "item was not sent to Jev",
    };
  }

  const result = await input.judge.evaluate({
    state,
    questions: mentalModelFreshnessQuestions(),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    return {
      id: input.model.id,
      action: "leave",
      confidence: 0,
      reason: "freshness did not return a Jev score",
    };
  }
  return interpretMentalModelFreshness({
    id: input.model.id,
    answers: result.answers,
    confidence: input.confidence,
  });
}

function finalizeFreshness(input: {
  id: string;
  action: MentalModelFreshnessAction;
  confidence: number;
  stillAnswers?: number;
  stillBand?: NoulBand;
  newEvidence?: number;
  evidenceBand?: NoulBand;
  chosenAction?: string;
  actionConfidence?: number;
  modelStillAnswersSourceQuery?: number;
  modelStillAnswersBand?: NoulBand;
  newEvidenceSinceRefresh?: number;
  newEvidenceBand?: NoulBand;
  review?: boolean;
  threshold?: number;
}): MentalModelFreshnessDecision {
  const reviewOnly = input.action === "retarget_query";
  return {
    id: input.id,
    action: input.action,
    confidence: input.confidence,
    reason: reasonFromAnswers({
      action: input.action,
      stillAnswers: input.stillAnswers,
      stillBand: input.stillBand,
      newEvidence: input.newEvidence,
      evidenceBand: input.evidenceBand,
      review: input.review,
      threshold: input.threshold,
      reviewOnly,
    }),
    ...(input.modelStillAnswersSourceQuery !== undefined
      ? { modelStillAnswersSourceQuery: input.modelStillAnswersSourceQuery }
      : {}),
    ...(input.modelStillAnswersBand !== undefined
      ? { modelStillAnswersBand: input.modelStillAnswersBand }
      : {}),
    ...(input.newEvidenceSinceRefresh !== undefined
      ? { newEvidenceSinceRefresh: input.newEvidenceSinceRefresh }
      : {}),
    ...(input.newEvidenceBand !== undefined
      ? { newEvidenceBand: input.newEvidenceBand }
      : {}),
    ...(input.chosenAction !== undefined
      ? { chosenAction: input.chosenAction }
      : {}),
    ...(input.actionConfidence !== undefined
      ? { actionConfidence: input.actionConfidence }
      : {}),
    ...(reviewOnly ? { reviewOnly: true } : {}),
  };
}

function reasonFromAnswers(input: {
  action: string;
  stillAnswers?: number;
  stillBand?: NoulBand;
  newEvidence?: number;
  evidenceBand?: NoulBand;
  review?: boolean;
  threshold?: number;
  reviewOnly?: boolean;
}): string {
  const parts = [`action=${input.action}`];
  if (input.stillAnswers !== undefined && input.stillBand !== undefined) {
    parts.push(
      `model_still_answers_source_query=${input.stillAnswers.toFixed(2)}(${input.stillBand})`,
    );
  }
  if (input.newEvidence !== undefined && input.evidenceBand !== undefined) {
    parts.push(
      `new_evidence_since_refresh=${input.newEvidence.toFixed(2)}(${input.evidenceBand})`,
    );
  }
  if (input.reviewOnly === true) {
    parts.push("review_only");
  }
  if (input.review === true && input.threshold !== undefined) {
    parts.push(`below_${input.threshold.toFixed(2)}`);
  }
  return parts.join(" ");
}

function stillAnswersQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions:
      "Does this mental model still answer its source query given the current bank?",
    criteria: {
      true: "The model content still addresses what the source query asks.",
      false:
        "The query no longer matches the model, or the model drifts from the query intent.",
    },
  };
}

function newEvidenceQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions:
      "Is there durable new evidence in recent observations since the last refresh?",
    criteria: {
      true: "Recent observation summaries add decisions or facts the model should absorb.",
      false: "Nothing material is new relative to the last refresh.",
    },
  };
}

function actionQuestion(): ChoiceQuestion {
  return {
    type: "choice",
    instructions: "What should the audit plan propose for this mental model?",
    criteria: {
      leave: {
        what: "Leave the model as-is; it still answers the query and evidence is not new.",
        not_for: "Stale models or queries that no longer fit.",
        examples: ["Coding standards model still matches retained standards"],
      },
      refresh: {
        what: "Refresh the model from current memories; do not delete it.",
        not_for: "Models whose source query itself is wrong.",
        examples: ["New ADR retained since last refresh"],
      },
      retarget_query: {
        what: "Review-only: propose retargeting the source query. Do not rewrite it automatically.",
        not_for: "Models that only need a content refresh.",
        examples: ["Query asks for Redis while the bank standardized on SQLite"],
      },
      archive: {
        what: "Archive the model; it is no longer useful for Reflect.",
        not_for: "Models that should refresh or retarget.",
        examples: ["Deprecated knowledge page replaced by a newer model"],
      },
    },
  };
}

function readNoul(answer: JudgeAnswer | undefined): number | undefined {
  if (answer === undefined || answer.type !== "noul" || !Number.isFinite(answer.noul)) {
    return undefined;
  }
  return answer.noul;
}

function readChoice(
  answer: JudgeAnswer | undefined,
): { choice: string; confidence: number } | undefined {
  if (
    answer === undefined ||
    answer.type !== "choice" ||
    !Number.isFinite(answer.confidence)
  ) {
    return undefined;
  }
  return { choice: answer.choice, confidence: answer.confidence };
}

export function freshnessToAuditDecision(
  decision: MentalModelFreshnessDecision,
): AuditDecision {
  return {
    id: decision.id,
    action: mapFreshnessAction(decision.action),
    confidence: decision.confidence,
    reason: `${decision.reason} layer=mental_model`,
    layer: "mental_model",
    freshnessAction: decision.action,
    ...(decision.chosenAction !== undefined
      ? { chosenAction: decision.chosenAction }
      : {}),
    ...(decision.actionConfidence !== undefined
      ? { actionConfidence: decision.actionConfidence }
      : {}),
    ...(decision.reviewOnly === true ? { reviewOnly: true } : {}),
  };
}

function mapFreshnessAction(
  action: MentalModelFreshnessAction,
): AuditAction {
  switch (action) {
    case "leave":
      return "keep";
    case "refresh":
      return "refresh_mental_model";
    case "retarget_query":
      return "keep";
    case "archive":
      return "archive";
  }
}
