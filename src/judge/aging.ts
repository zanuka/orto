import type { AuditAction, AuditDecision } from "./audit.js";
import type { NoulBand } from "./relevance.js";

export const AUDIT_LAYERS = [
  "world",
  "experience",
  "observation",
  "mental_model",
  "document",
] as const;

export type AuditLayer = (typeof AUDIT_LAYERS)[number];

export interface AuditAgingContext {
  layer: AuditLayer;
  sourceGone?: boolean;
  hashMismatch?: boolean;
  proofCountLow?: boolean;
  hasContradictingCandidate?: boolean;
  sectionRewritten?: boolean;
}

export function parseAuditLayer(value: string | undefined): AuditLayer {
  if (value !== undefined && (AUDIT_LAYERS as readonly string[]).includes(value)) {
    return value as AuditLayer;
  }
  return "document";
}

export function biasAuditByLayer(input: {
  decision: AuditDecision;
  aging: AuditAgingContext;
  confidence: number;
  stillSupportedBand?: NoulBand;
}): AuditDecision {
  const { aging } = input;
  const biased =
    biasMentalModel(input) ??
    biasDocument(input) ??
    biasWorldOrExperience(input) ??
    biasObservation(input);

  if (biased === undefined) {
    return withLayerReason(input.decision, aging.layer);
  }
  return withLayerReason(biased, aging.layer, biased.agingBias);
}

function biasMentalModel(input: {
  decision: AuditDecision;
  aging: AuditAgingContext;
  confidence: number;
}): (AuditDecision & { agingBias?: string }) | undefined {
  if (input.aging.layer !== "mental_model") {
    return undefined;
  }
  if (input.decision.action !== "delete_candidate") {
    return undefined;
  }
  return {
    ...input.decision,
    action: "refresh_mental_model",
    confidence: Math.max(input.decision.confidence, input.confidence),
    agingBias: "prefer_refresh_over_delete",
  };
}

function biasDocument(input: {
  decision: AuditDecision;
  aging: AuditAgingContext;
  confidence: number;
}): (AuditDecision & { agingBias?: string }) | undefined {
  if (input.aging.layer !== "document") {
    return undefined;
  }
  if (input.aging.sourceGone === true) {
    return {
      ...input.decision,
      action: "archive",
      confidence: Math.max(input.decision.confidence, input.confidence),
      agingBias: "source_deleted",
    };
  }
  if (input.aging.sectionRewritten === true) {
    return {
      ...input.decision,
      action: "keep",
      confidence: Math.max(input.decision.confidence, input.confidence),
      agingBias: "re_retain",
    };
  }
  return undefined;
}

function biasWorldOrExperience(input: {
  decision: AuditDecision;
  aging: AuditAgingContext;
  confidence: number;
  stillSupportedBand?: NoulBand;
}): (AuditDecision & { agingBias?: string }) | undefined {
  if (input.aging.layer !== "world" && input.aging.layer !== "experience") {
    return undefined;
  }
  if (input.aging.sourceGone === true) {
    return {
      ...input.decision,
      action: "archive",
      confidence: Math.max(input.decision.confidence, input.confidence),
      agingBias: "source_gone",
    };
  }
  if (
    input.aging.hashMismatch === true &&
    input.stillSupportedBand === "no"
  ) {
    return {
      ...input.decision,
      action: "archive",
      confidence: Math.max(input.decision.confidence, input.confidence),
      agingBias: "hash_mismatch_unsupported",
    };
  }
  return undefined;
}

function biasObservation(input: {
  decision: AuditDecision;
  aging: AuditAgingContext;
  confidence: number;
}): (AuditDecision & { agingBias?: string }) | undefined {
  if (input.aging.layer !== "observation") {
    return undefined;
  }
  if (
    input.aging.proofCountLow !== true ||
    input.aging.hasContradictingCandidate !== true
  ) {
    return undefined;
  }
  return {
    ...input.decision,
    action: "supersede",
    confidence: Math.max(input.decision.confidence, input.confidence),
    agingBias: "low_proof_contradiction",
  };
}

function withLayerReason(
  decision: AuditDecision,
  layer: AuditLayer,
  agingBias?: string,
): AuditDecision {
  const action: AuditAction = decision.action;
  const syncedReason = decision.reason.replace(/^action=\S+/, `action=${action}`);
  const parts = [syncedReason, `layer=${layer}`];
  if (agingBias !== undefined) {
    parts.push(`aging=${agingBias}`);
  }
  return {
    ...decision,
    action,
    reason: parts.join(" "),
    layer,
    ...(agingBias !== undefined ? { agingBias } : {}),
  };
}
