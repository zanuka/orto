/*
Recall still-true check annotates recalled passages when the source excerpt
no longer supports the claim. Harnesses call judgeRecallVerified after MCP
recall. Default path is pass-through: no TypeSafe call, stale stays false.
Opt in with verify:true or ORTO_JEV_RECALL_VERIFY=1 (NOCCIOLO_JEV_RECALL_VERIFY
alias). One batched Jev call asks still_true_given_current_excerpt per
passage. Confident no marks stale in the result. Missing source files mark
stale / skip verify and never crash recall. This module does not host or
proxy MCP.
*/

import { loadCurrentExcerptForDocumentId } from "../seeder/source-excerpt.js";
import { noulBand, type NoulBand } from "./relevance.js";
import {
  assertJevStateSendable,
  containsInlineSecret,
  JEV_DOCUMENT_ID_MAX_CHARS,
  JEV_OVERLAP_SUMMARY_MAX_CHARS,
  JEV_SECTION_MAX_CHARS,
} from "./state.js";
import type {
  Judge,
  JudgeAnswer,
  JudgeQuestion,
  NoulQuestion,
} from "./types.js";

export const RECALL_VERIFY_MAX_PASSAGES = 8;
export const RECALL_VERIFY_ENV = "ORTO_JEV_RECALL_VERIFY";
export const RECALL_VERIFY_ENV_ALIAS = "NOCCIOLO_JEV_RECALL_VERIFY";

export interface RecallVerifyPassage {
  id: string;
  text: string;
  documentId?: string;
  currentExcerpt?: string;
  sourceStillExists?: boolean;
}

export type RecallVerifyStatus =
  | "pass_through"
  | "current"
  | "stale"
  | "skipped";

export type RecallVerifySource = "jev" | "pass_through" | "skipped";

export interface VerifiedRecallPassage extends RecallVerifyPassage {
  stale: boolean;
  status: RecallVerifyStatus;
  stillTrue?: number;
  stillTrueBand?: NoulBand;
  source: RecallVerifySource;
  reason: string;
}

export interface RecallVerifyResult {
  verified: VerifiedRecallPassage[];
  latencyMs: number;
  source: RecallVerifySource;
  verifyEnabled: boolean;
}

export function parseRecallVerifyEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[RECALL_VERIFY_ENV] ?? env[RECALL_VERIFY_ENV_ALIAS];
  if (raw === undefined) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function resolveRecallVerifyEnabled(input: {
  verify?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (input.verify === true) {
    return true;
  }
  if (input.verify === false) {
    return false;
  }
  return parseRecallVerifyEnabled(input.env);
}

export function stillTrueKey(passageId: string): string {
  return `still_true_${sanitizeId(passageId)}`;
}

export function recallVerifyQuestions(
  passages: readonly RecallVerifyPassage[],
): Record<string, JudgeQuestion> {
  const questions: Record<string, JudgeQuestion> = {};
  for (const passage of passages.slice(0, RECALL_VERIFY_MAX_PASSAGES)) {
    questions[stillTrueKey(passage.id)] = stillTrueQuestion(passage.id);
  }
  return questions;
}

export function passThroughRecallVerify(
  passages: readonly RecallVerifyPassage[],
): VerifiedRecallPassage[] {
  return passages.map((passage) => ({
    ...passage,
    stale: false,
    status: "pass_through",
    source: "pass_through",
    reason: "still-true verify off",
  }));
}

export function interpretRecallVerify(input: {
  passages: readonly RecallVerifyPassage[];
  answers: Record<string, JudgeAnswer>;
  confidence: number;
}): VerifiedRecallPassage[] {
  return input.passages.map((passage) => {
    const base = annotateWithoutJudge(passage);
    if (base !== undefined) {
      return base;
    }

    const stillTrue = readNoul(input.answers[stillTrueKey(passage.id)]);
    if (stillTrue === undefined) {
      return {
        ...passage,
        stale: false,
        status: "skipped",
        source: "skipped",
        reason: "missing still_true answer; skip verify",
      };
    }
    const band = noulBand(stillTrue, input.confidence);
    if (band === "no") {
      return {
        ...passage,
        stale: true,
        status: "stale",
        stillTrue,
        stillTrueBand: band,
        source: "jev",
        reason: "source excerpt contradicts recalled claim",
      };
    }
    if (band === "yes") {
      return {
        ...passage,
        stale: false,
        status: "current",
        stillTrue,
        stillTrueBand: band,
        source: "jev",
        reason: "source excerpt still supports recalled claim",
      };
    }
    return {
      ...passage,
      stale: false,
      status: "current",
      stillTrue,
      stillTrueBand: band,
      source: "jev",
      reason: `still_true uncertain at ${input.confidence.toFixed(2)}; keep`,
    };
  });
}

export async function enrichRecallVerifyPassages(input: {
  passages: readonly RecallVerifyPassage[];
  projectRoot?: string;
}): Promise<RecallVerifyPassage[]> {
  if (input.projectRoot === undefined) {
    return [...input.passages];
  }
  const enriched: RecallVerifyPassage[] = [];
  for (const passage of input.passages) {
    if (
      passage.currentExcerpt !== undefined ||
      passage.sourceStillExists !== undefined ||
      passage.documentId === undefined
    ) {
      enriched.push(passage);
      continue;
    }
    try {
      const loaded = await loadCurrentExcerptForDocumentId({
        projectRoot: input.projectRoot,
        documentId: passage.documentId,
      });
      enriched.push({
        ...passage,
        sourceStillExists: loaded.sourceStillExists,
        ...(loaded.excerpt !== undefined ? { currentExcerpt: loaded.excerpt } : {}),
      });
    } catch {
      enriched.push({
        ...passage,
        sourceStillExists: false,
      });
    }
  }
  return enriched;
}

export async function judgeRecallVerified(input: {
  passages: readonly RecallVerifyPassage[];
  judge?: Judge;
  confidence: number;
  verify?: boolean;
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<RecallVerifyResult> {
  const started = Date.now();
  const verifyEnabled = resolveRecallVerifyEnabled({
    ...(input.verify !== undefined ? { verify: input.verify } : {}),
    ...(input.env !== undefined ? { env: input.env } : {}),
  });

  if (!verifyEnabled) {
    return {
      verified: passThroughRecallVerify(input.passages),
      latencyMs: Date.now() - started,
      source: "pass_through",
      verifyEnabled: false,
    };
  }

  const passages = await enrichRecallVerifyPassages({
    passages: input.passages,
    ...(input.projectRoot !== undefined
      ? { projectRoot: input.projectRoot }
      : {}),
  });

  const preAnnotated: VerifiedRecallPassage[] = [];
  const needsJudge: RecallVerifyPassage[] = [];
  for (const passage of passages) {
    const annotated = annotateWithoutJudge(passage);
    if (annotated !== undefined) {
      preAnnotated.push(annotated);
      continue;
    }
    needsJudge.push(passage);
  }

  if (needsJudge.length === 0) {
    return {
      verified: orderVerified(passages, preAnnotated),
      latencyMs: Date.now() - started,
      source: "skipped",
      verifyEnabled: true,
    };
  }

  if (
    input.judge === undefined ||
    input.judge.id === "off" ||
    input.judge.id !== "jev"
  ) {
    const skipped = needsJudge.map((passage) => ({
      ...passage,
      stale: false,
      status: "skipped" as const,
      source: "skipped" as const,
      reason: "verify requested but judge unavailable",
    }));
    return {
      verified: orderVerified(passages, [...preAnnotated, ...skipped]),
      latencyMs: Date.now() - started,
      source: "skipped",
      verifyEnabled: true,
    };
  }

  const capped = needsJudge.slice(0, RECALL_VERIFY_MAX_PASSAGES);
  const remainder = needsJudge.slice(RECALL_VERIFY_MAX_PASSAGES);
  const state = buildRecallVerifyState(capped);

  try {
    assertJevStateSendable(state);
  } catch {
    const skipped = needsJudge.map((passage) => ({
      ...passage,
      stale: false,
      status: "skipped" as const,
      source: "skipped" as const,
      reason: "verify state not sendable; skip",
    }));
    return {
      verified: orderVerified(passages, [...preAnnotated, ...skipped]),
      latencyMs: Date.now() - started,
      source: "skipped",
      verifyEnabled: true,
    };
  }

  const result = await input.judge.evaluate({
    state,
    questions: recallVerifyQuestions(capped),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    const skipped = needsJudge.map((passage) => ({
      ...passage,
      stale: false,
      status: "skipped" as const,
      source: "skipped" as const,
      reason: "jev fallback; skip verify",
    }));
    return {
      verified: orderVerified(passages, [...preAnnotated, ...skipped]),
      latencyMs: Date.now() - started,
      source: "skipped",
      verifyEnabled: true,
    };
  }

  const judged = interpretRecallVerify({
    passages: capped,
    answers: result.answers,
    confidence: input.confidence,
  });
  const cappedRemainder = remainder.map((passage) => ({
    ...passage,
    stale: false,
    status: "skipped" as const,
    source: "skipped" as const,
    reason: "beyond recall-verify batch cap; skip",
  }));

  return {
    verified: orderVerified(passages, [
      ...preAnnotated,
      ...judged,
      ...cappedRemainder,
    ]),
    latencyMs: Date.now() - started,
    source: "jev",
    verifyEnabled: true,
  };
}

export function formatRecallVerifyLines(input: {
  verified: readonly VerifiedRecallPassage[];
  latencyMs?: number;
  dryRun?: boolean;
}): string[] {
  const prefix = input.dryRun === true ? "[dry-run] " : "";
  const staleCount = input.verified.filter((passage) => passage.stale).length;
  const lines = [
    `${prefix}Recall verify: ${input.verified.length} passages, ${staleCount} stale`,
  ];
  if (input.latencyMs !== undefined) {
    lines.push(`${prefix}latency: ${input.latencyMs}ms vs unverified recall`);
  }
  for (const passage of input.verified) {
    const noul =
      passage.stillTrue !== undefined && passage.stillTrueBand !== undefined
        ? ` still_true=${passage.stillTrue.toFixed(2)}(${passage.stillTrueBand})`
        : "";
    lines.push(
      `${prefix}  ${passage.stale ? "stale" : "ok"} ${passage.id} status=${passage.status} (${passage.source})${noul} ${passage.reason}`,
    );
  }
  return lines;
}

function annotateWithoutJudge(
  passage: RecallVerifyPassage,
): VerifiedRecallPassage | undefined {
  if (containsInlineSecret(passage.text) || containsInlineSecret(passage.currentExcerpt ?? "")) {
    return {
      ...passage,
      stale: true,
      status: "skipped",
      source: "skipped",
      reason: "secret pattern; skip verify",
    };
  }

  if (passage.sourceStillExists === false) {
    return {
      ...passage,
      stale: true,
      status: "stale",
      source: "skipped",
      reason: "source missing",
    };
  }

  const hasExcerpt =
    passage.currentExcerpt !== undefined && passage.currentExcerpt.trim() !== "";
  if (!hasExcerpt) {
    if (passage.documentId === undefined || passage.documentId.trim() === "") {
      return {
        ...passage,
        stale: true,
        status: "skipped",
        source: "skipped",
        reason: "no source to verify",
      };
    }
    if (passage.sourceStillExists === true) {
      return {
        ...passage,
        stale: true,
        status: "skipped",
        source: "skipped",
        reason: "source exists but excerpt missing; skip verify",
      };
    }
    return {
      ...passage,
      stale: true,
      status: "stale",
      source: "skipped",
      reason: "source missing",
    };
  }

  return undefined;
}

function orderVerified(
  passages: readonly RecallVerifyPassage[],
  verified: readonly VerifiedRecallPassage[],
): VerifiedRecallPassage[] {
  const byId = new Map(verified.map((passage) => [passage.id, passage]));
  return passages.map((passage) => {
    const found = byId.get(passage.id);
    if (found !== undefined) {
      return found;
    }
    return {
      ...passage,
      stale: true,
      status: "skipped",
      source: "skipped",
      reason: "verify incomplete",
    };
  });
}

function buildRecallVerifyState(passages: readonly RecallVerifyPassage[]): {
  type: "recall_verify";
  passages: Array<{
    id: string;
    text: string;
    currentExcerpt: string;
    documentId?: string;
    sourceStillExists: boolean;
  }>;
} {
  return {
    type: "recall_verify",
    passages: passages.map((passage) => {
      const item: {
        id: string;
        text: string;
        currentExcerpt: string;
        documentId?: string;
        sourceStillExists: boolean;
      } = {
        id: passage.id.slice(0, JEV_DOCUMENT_ID_MAX_CHARS),
        text: passage.text.slice(0, JEV_SECTION_MAX_CHARS),
        currentExcerpt: (passage.currentExcerpt ?? "").slice(
          0,
          JEV_OVERLAP_SUMMARY_MAX_CHARS,
        ),
        sourceStillExists: passage.sourceStillExists !== false,
      };
      if (passage.documentId !== undefined && passage.documentId.trim() !== "") {
        item.documentId = passage.documentId.slice(0, JEV_DOCUMENT_ID_MAX_CHARS);
      }
      return item;
    }),
  };
}

function stillTrueQuestion(passageId: string): NoulQuestion {
  return {
    type: "noul",
    instructions: `Is recalled passage "${passageId}" still true given the current source excerpt?`,
    criteria: {
      true: "The current excerpt still supports the recalled claim.",
      false:
        "The excerpt contradicts the claim, no longer says it, or the claim is superseded on disk.",
    },
  };
}

function sanitizeId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "passage";
}

function readNoul(answer: JudgeAnswer | undefined): number | undefined {
  if (answer === undefined || answer.type !== "noul" || !Number.isFinite(answer.noul)) {
    return undefined;
  }
  return answer.noul;
}
