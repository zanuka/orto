/*
Audit judges whether a retained bank document still belongs.
Orto audit --judge jev calls this once per document with a small state object
(id, text, source flags, optional file excerpt, bank mission). One Jev call
asks whether the repo still supports the claim (still_supported_by_repo),
whether it is superseded (superseded), and which plan action to take
(keep, refresh_mental_model, supersede, archive, or delete_candidate).

The action choice is used when its confidence meets --confidence. Otherwise
the nouls decide: unsupported and superseded lean toward delete_candidate or
supersede; still supported and not superseded keeps. Mid-range answers stay
as keep with a review reason so the plan is never empty. Layer-specific aging
then biases the plan (archive world facts when the source is gone, prefer
refresh over delete for mental models, and so on). Audit never mutates the
bank. The caller writes .orto/local/audit-plan.json and prints a table.
*/

import {
  biasAuditByLayer,
  parseAuditLayer,
  type AuditAgingContext,
  type AuditLayer,
} from "./aging.js";
import { noulBand, type NoulBand } from "./relevance.js";
import {
  assertJevStateSendable,
  containsInlineSecret,
  JEV_DOCUMENT_ID_MAX_CHARS,
  JEV_MISSION_MAX_CHARS,
  JEV_PATH_MAX_CHARS,
  JEV_SECTION_MAX_CHARS,
} from "./state.js";
import type {
  ChoiceQuestion,
  Judge,
  JudgeAnswer,
  JudgeQuestion,
  NoulQuestion,
} from "./types.js";

export type { AuditAgingContext, AuditLayer } from "./aging.js";
export { AUDIT_LAYERS, biasAuditByLayer, parseAuditLayer } from "./aging.js";

export const AUDIT_ACTIONS = [
  "keep",
  "refresh_mental_model",
  "supersede",
  "archive",
  "delete_candidate",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditItemState {
  type: string;
  id: string;
  text: string;
  lastSourceHash?: string;
  sourceStillExists: boolean;
  currentFileExcerpt?: string;
  bankMission?: string;
  lastAccessed?: string;
  layer?: AuditLayer;
  sourceGone?: boolean;
  hashMismatch?: boolean;
  proofCountLow?: boolean;
  hasContradictingCandidate?: boolean;
  sectionRewritten?: boolean;
}

export interface AuditDecision {
  id: string;
  action: AuditAction;
  confidence: number;
  reason: string;
  stillSupportedByRepo?: number;
  stillSupportedBand?: NoulBand;
  superseded?: number;
  supersededBand?: NoulBand;
  chosenAction?: string;
  actionConfidence?: number;
  layer?: AuditLayer;
  agingBias?: string;
  freshnessAction?: string;
  reviewOnly?: boolean;
}

export function auditQuestions(): Record<string, JudgeQuestion> {
  return {
    still_supported_by_repo: stillSupportedQuestion(),
    superseded: supersededQuestion(),
    action: actionQuestion(),
  };
}

export function interpretAudit(input: {
  id: string;
  answers: Record<string, JudgeAnswer>;
  confidence: number;
  aging?: AuditAgingContext;
}): AuditDecision {
  const supported = readNoul(input.answers.still_supported_by_repo);
  const superseded = readNoul(input.answers.superseded);
  const chosen = readChoice(input.answers.action);
  const supportedBand =
    supported === undefined ? undefined : noulBand(supported, input.confidence);
  const supersededBand =
    superseded === undefined ? undefined : noulBand(superseded, input.confidence);
  const actionConfident =
    chosen !== undefined &&
    AUDIT_ACTIONS.includes(chosen.choice as AuditAction) &&
    chosen.confidence + 1e-9 >= input.confidence;

  const base = {
    id: input.id,
    ...(supported !== undefined ? { stillSupportedByRepo: supported } : {}),
    ...(supportedBand !== undefined ? { stillSupportedBand: supportedBand } : {}),
    ...(superseded !== undefined ? { superseded } : {}),
    ...(supersededBand !== undefined ? { supersededBand } : {}),
    ...(chosen !== undefined
      ? { chosenAction: chosen.choice, actionConfidence: chosen.confidence }
      : {}),
  };

  let decision: AuditDecision;
  if (actionConfident && chosen !== undefined) {
    decision = {
      ...base,
      action: chosen.choice as AuditAction,
      confidence: chosen.confidence,
      reason: reasonFromAnswers({
        action: chosen.choice,
        supported,
        supportedBand,
        superseded,
        supersededBand,
      }),
    };
  } else if (supportedBand === "no" && supersededBand === "yes") {
    decision = {
      ...base,
      action: "delete_candidate",
      confidence: input.confidence,
      reason: reasonFromAnswers({
        action: "delete_candidate",
        supported,
        supportedBand,
        superseded,
        supersededBand,
      }),
    };
  } else if (supersededBand === "yes") {
    decision = {
      ...base,
      action: "supersede",
      confidence: input.confidence,
      reason: reasonFromAnswers({
        action: "supersede",
        supported,
        supportedBand,
        superseded,
        supersededBand,
      }),
    };
  } else if (supportedBand === "yes" && supersededBand === "no") {
    decision = {
      ...base,
      action: "keep",
      confidence: input.confidence,
      reason: reasonFromAnswers({
        action: "keep",
        supported,
        supportedBand,
        superseded,
        supersededBand,
      }),
    };
  } else if (supportedBand === "no") {
    decision = {
      ...base,
      action: "archive",
      confidence: input.confidence,
      reason: reasonFromAnswers({
        action: "archive",
        supported,
        supportedBand,
        superseded,
        supersededBand,
      }),
    };
  } else {
    decision = {
      ...base,
      action: "keep",
      confidence: chosen?.confidence ?? 0,
      reason: reasonFromAnswers({
        action: "keep",
        supported,
        supportedBand,
        superseded,
        supersededBand,
        review: true,
        threshold: input.confidence,
      }),
    };
  }

  if (input.aging === undefined) {
    return decision;
  }
  return biasAuditByLayer({
    decision,
    aging: input.aging,
    confidence: input.confidence,
    ...(supportedBand !== undefined ? { stillSupportedBand: supportedBand } : {}),
  });
}

export async function judgeAuditItem(input: {
  item: AuditItemState;
  judge: Judge;
  confidence: number;
}): Promise<AuditDecision> {
  if (
    containsInlineSecret(input.item.id) ||
    containsInlineSecret(input.item.text) ||
    (input.item.currentFileExcerpt !== undefined &&
      containsInlineSecret(input.item.currentFileExcerpt))
  ) {
    return {
      id: input.item.id,
      action: "keep",
      confidence: 0,
      reason: "item matched a secret pattern; not sent to Jev",
    };
  }

  const aging = agingContextFromItem(input.item);
  const state = {
    type: input.item.type,
    layer: aging.layer,
    id: input.item.id.slice(0, JEV_DOCUMENT_ID_MAX_CHARS),
    text: input.item.text.slice(0, JEV_SECTION_MAX_CHARS),
    sourceStillExists: input.item.sourceStillExists,
    ...(input.item.lastSourceHash !== undefined
      ? { lastSourceHash: input.item.lastSourceHash.slice(0, 128) }
      : {}),
    ...(input.item.currentFileExcerpt !== undefined
      ? {
          currentFileExcerpt: input.item.currentFileExcerpt.slice(
            0,
            Math.floor(JEV_SECTION_MAX_CHARS / 2),
          ),
        }
      : {}),
    ...(input.item.bankMission !== undefined
      ? { bankMission: input.item.bankMission.slice(0, JEV_MISSION_MAX_CHARS) }
      : {}),
    ...(input.item.lastAccessed !== undefined
      ? { lastAccessed: input.item.lastAccessed.slice(0, 64) }
      : {}),
    ...(input.item.id.length > 0
      ? { path: input.item.id.slice(0, JEV_PATH_MAX_CHARS) }
      : {}),
  };

  try {
    assertJevStateSendable(state);
  } catch {
    return {
      id: input.item.id,
      action: "keep",
      confidence: 0,
      reason: "item was not sent to Jev",
    };
  }

  const result = await input.judge.evaluate({
    state,
    questions: auditQuestions(),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    return {
      id: input.item.id,
      action: "keep",
      confidence: 0,
      reason: "audit did not return a Jev score",
    };
  }
  return interpretAudit({
    id: input.item.id,
    answers: result.answers,
    confidence: input.confidence,
    aging,
  });
}

export function agingContextFromItem(item: AuditItemState): AuditAgingContext {
  const layer = parseAuditLayer(item.layer ?? item.type);
  const context: AuditAgingContext = { layer };
  const sourceGone = item.sourceGone ?? !item.sourceStillExists;
  if (sourceGone) {
    context.sourceGone = true;
  }
  if (item.hashMismatch === true) {
    context.hashMismatch = true;
  }
  if (item.proofCountLow === true) {
    context.proofCountLow = true;
  }
  if (item.hasContradictingCandidate === true) {
    context.hasContradictingCandidate = true;
  }
  if (item.sectionRewritten === true) {
    context.sectionRewritten = true;
  }
  return context;
}

export function formatAuditTable(input: {
  decisions: readonly AuditDecision[];
  dryRun: boolean;
}): string[] {
  const prefix = input.dryRun ? "[dry-run] " : "";
  if (input.decisions.length === 0) {
    return [`${prefix}No audit decisions.`];
  }
  const lines = [
    `${prefix}Audit plan:`,
    `${prefix}id\taction\tconfidence\treason`,
  ];
  for (const decision of input.decisions) {
    lines.push(
      `${prefix}${decision.id}\t${decision.action}\t${decision.confidence.toFixed(2)}\t${decision.reason}`,
    );
  }
  return lines;
}

function reasonFromAnswers(input: {
  action: string;
  supported?: number;
  supportedBand?: NoulBand;
  superseded?: number;
  supersededBand?: NoulBand;
  review?: boolean;
  threshold?: number;
}): string {
  const parts = [`action=${input.action}`];
  if (input.supported !== undefined && input.supportedBand !== undefined) {
    parts.push(
      `still_supported_by_repo=${input.supported.toFixed(2)}(${input.supportedBand})`,
    );
  }
  if (input.superseded !== undefined && input.supersededBand !== undefined) {
    parts.push(`superseded=${input.superseded.toFixed(2)}(${input.supersededBand})`);
  }
  if (input.review === true && input.threshold !== undefined) {
    parts.push(`below_${input.threshold.toFixed(2)}`);
  }
  return parts.join(" ");
}

function stillSupportedQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions:
      "Is this retained claim still supported by the current repository docs?",
    criteria: {
      true: "The current file excerpt or repo still backs this claim.",
      false:
        "The source is gone, the section no longer says this, or the claim conflicts with the repo.",
    },
  };
}

function supersededQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions: "Has a newer durable claim superseded this retained item?",
    criteria: {
      true: "A newer decision, standard, or architecture note replaces this claim.",
      false: "Nothing newer replaces this claim.",
    },
  };
}

function actionQuestion(): ChoiceQuestion {
  return {
    type: "choice",
    instructions: "What should the audit plan propose for this bank item?",
    criteria: {
      keep: {
        what: "Keep the item; it is still true and useful.",
        not_for: "Stale, superseded, or unsupported claims.",
        examples: ["Current ADR decision still on disk", "Active coding standard"],
      },
      refresh_mental_model: {
        what: "Refresh related mental models; the claim is still true but derived views may be stale.",
        not_for: "Claims that should leave the bank.",
        examples: ["Section still true after nearby doc edits"],
      },
      supersede: {
        what: "Mark as superseded by a newer claim; keep history until prune confirms.",
        not_for: "Claims that are still current.",
        examples: ["Old Redis decision after SQLite ADR"],
      },
      archive: {
        what: "Archive; no longer useful for agents but not an immediate delete.",
        not_for: "Active claims or clear delete candidates.",
        examples: ["Historical context agents rarely need"],
      },
      delete_candidate: {
        what: "Propose delete; the claim is unsupported or harmful to keep.",
        not_for: "Claims that still match the repo.",
        examples: ["Source path gone and claim false", "Contradicted by current docs"],
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
