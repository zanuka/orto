/*
Recall rank packs Hindsight recall passages for harness context stuffing.
Harnesses call judgeRecallRanked or packRecallContext after MCP recall.
Default path is pass-through: no TypeSafe call, input order preserved, no
low-score drops. Opt in with rank:true (and --judge jev when available).

One batched Jev call scores relevance_to_task per passage (0-4). Confident
low scores are omitted from the packed string. When the judge is off, or Jev
falls back, heuristicRankRecalledPassages uses task/passage token overlap.
Raw MCP recall stays unchanged; this module does not host or proxy MCP.
*/

import {
  assertJevStateSendable,
  containsInlineSecret,
  JEV_DOCUMENT_ID_MAX_CHARS,
  JEV_OVERLAP_SUMMARY_MAX_CHARS,
} from "./state.js";
import type {
  Judge,
  JudgeAnswer,
  JudgeQuestion,
  ScoreQuestion,
} from "./types.js";

export const RECALL_RANK_SCORE_MAX = 4;
export const RECALL_RANK_MAX_PASSAGES = 8;
export const RECALL_RANK_TASK_MAX_CHARS = 800;
export const DEFAULT_MIN_RELEVANCE = 2;

export interface RecallPassage {
  id: string;
  text: string;
  documentId?: string;
}

export type RecallRankSource = "jev" | "heuristic" | "pass_through";

export interface RankedRecallPassage extends RecallPassage {
  relevanceScore: number;
  relevanceConfidence?: number;
  kept: boolean;
  source: RecallRankSource;
  reason: string;
}

export interface RecallRankResult {
  ranked: RankedRecallPassage[];
  latencyMs: number;
  source: RecallRankSource;
}

export interface PackRecallContextResult {
  text: string;
  ranked: RankedRecallPassage[];
  keptCount: number;
  omittedCount: number;
  latencyMs: number;
  source: RecallRankSource;
}

export function recallRankQuestions(
  passages: readonly RecallPassage[],
): Record<string, JudgeQuestion> {
  const questions: Record<string, JudgeQuestion> = {};
  for (const passage of passages.slice(0, RECALL_RANK_MAX_PASSAGES)) {
    questions[relevanceKey(passage.id)] = relevanceQuestion(passage.id);
  }
  return questions;
}

export function heuristicRankRecalledPassages(input: {
  task: string;
  passages: readonly RecallPassage[];
  minRelevance?: number;
}): RankedRecallPassage[] {
  const minRelevance = input.minRelevance ?? DEFAULT_MIN_RELEVANCE;
  const taskTokens = tokenize(input.task);
  return input.passages.map((passage) => {
    if (containsInlineSecret(passage.text)) {
      return {
        ...passage,
        relevanceScore: 0,
        kept: false,
        source: "heuristic" as const,
        reason: "passage matched a secret pattern",
      };
    }
    const score = overlapScore(taskTokens, tokenize(passage.text));
    const kept = score + 1e-9 >= minRelevance;
    return {
      ...passage,
      relevanceScore: score,
      kept,
      source: "heuristic" as const,
      reason: kept
        ? `heuristic relevance ${score.toFixed(2)}`
        : `heuristic relevance ${score.toFixed(2)} below ${minRelevance}`,
    };
  });
}

export function interpretRecallRank(input: {
  passages: readonly RecallPassage[];
  answers: Record<string, JudgeAnswer>;
  confidence: number;
  minRelevance?: number;
}): RankedRecallPassage[] {
  const minRelevance = input.minRelevance ?? DEFAULT_MIN_RELEVANCE;
  return input.passages.map((passage) => {
    if (containsInlineSecret(passage.text)) {
      return {
        ...passage,
        relevanceScore: 0,
        kept: false,
        source: "jev" as const,
        reason: "passage matched a secret pattern",
      };
    }
    const scored = readScore(input.answers[relevanceKey(passage.id)]);
    if (scored === undefined) {
      return {
        ...passage,
        relevanceScore: minRelevance,
        kept: true,
        source: "jev" as const,
        reason: "missing relevance score; keep by default",
      };
    }
    const confident = scored.confidence + 1e-9 >= input.confidence;
    if (confident && scored.score + 1e-9 < minRelevance) {
      return {
        ...passage,
        relevanceScore: scored.score,
        relevanceConfidence: scored.confidence,
        kept: false,
        source: "jev" as const,
        reason: `confident relevance ${scored.score.toFixed(2)} below ${minRelevance}`,
      };
    }
    return {
      ...passage,
      relevanceScore: scored.score,
      relevanceConfidence: scored.confidence,
      kept: true,
      source: "jev" as const,
      reason: confident
        ? `confident relevance ${scored.score.toFixed(2)}`
        : `low-confidence relevance ${scored.score.toFixed(2)}; keep`,
    };
  });
}

export function passThroughRecallPassages(
  passages: readonly RecallPassage[],
): RankedRecallPassage[] {
  return passages.map((passage) => ({
    ...passage,
    relevanceScore: RECALL_RANK_SCORE_MAX,
    kept: true,
    source: "pass_through" as const,
    reason: "unranked pass-through",
  }));
}

export async function judgeRecallRanked(input: {
  task: string;
  passages: readonly RecallPassage[];
  judge?: Judge;
  confidence: number;
  minRelevance?: number;
  rank?: boolean;
}): Promise<RecallRankResult> {
  const started = Date.now();
  const rank = input.rank === true;
  if (!rank) {
    return {
      ranked: passThroughRecallPassages(input.passages),
      latencyMs: Date.now() - started,
      source: "pass_through",
    };
  }

  if (input.judge === undefined || input.judge.id === "off" || input.judge.id !== "jev") {
    const ranked = heuristicRankRecalledPassages({
      task: input.task,
      passages: input.passages,
      ...(input.minRelevance !== undefined
        ? { minRelevance: input.minRelevance }
        : {}),
    });
    return {
      ranked,
      latencyMs: Date.now() - started,
      source: "heuristic",
    };
  }

  const capped = input.passages.slice(0, RECALL_RANK_MAX_PASSAGES);
  const remainder = input.passages.slice(RECALL_RANK_MAX_PASSAGES);
  const state = buildRecallRankState(input.task, capped);

  try {
    assertJevStateSendable(state);
  } catch {
    const ranked = heuristicRankRecalledPassages({
      task: input.task,
      passages: input.passages,
      ...(input.minRelevance !== undefined
        ? { minRelevance: input.minRelevance }
        : {}),
    });
    return {
      ranked,
      latencyMs: Date.now() - started,
      source: "heuristic",
    };
  }

  const result = await input.judge.evaluate({
    state,
    questions: recallRankQuestions(capped),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    const ranked = heuristicRankRecalledPassages({
      task: input.task,
      passages: input.passages,
      ...(input.minRelevance !== undefined
        ? { minRelevance: input.minRelevance }
        : {}),
    });
    return {
      ranked,
      latencyMs: Date.now() - started,
      source: "heuristic",
    };
  }

  const ranked = [
    ...interpretRecallRank({
      passages: capped,
      answers: result.answers,
      confidence: input.confidence,
      ...(input.minRelevance !== undefined
        ? { minRelevance: input.minRelevance }
        : {}),
    }),
    ...passThroughRecallPassages(remainder).map((passage) => ({
      ...passage,
      relevanceScore: DEFAULT_MIN_RELEVANCE,
      reason: "beyond recall-rank batch cap; keep",
    })),
  ];

  return {
    ranked,
    latencyMs: Date.now() - started,
    source: "jev",
  };
}

export async function packRecallContext(input: {
  task: string;
  passages: readonly RecallPassage[];
  maxChars: number;
  rank?: boolean;
  judge?: Judge;
  confidence?: number;
  minRelevance?: number;
}): Promise<PackRecallContextResult> {
  const confidence = input.confidence ?? 0.8;
  const result = await judgeRecallRanked({
    task: input.task,
    passages: input.passages,
    confidence,
    ...(input.rank !== undefined ? { rank: input.rank } : {}),
    ...(input.judge !== undefined ? { judge: input.judge } : {}),
    ...(input.minRelevance !== undefined
      ? { minRelevance: input.minRelevance }
      : {}),
  });

  const ordered =
    result.source === "pass_through"
      ? result.ranked
      : [...result.ranked].sort((left, right) => {
          if (right.relevanceScore !== left.relevanceScore) {
            return right.relevanceScore - left.relevanceScore;
          }
          return left.id.localeCompare(right.id);
        });

  const kept = ordered.filter((passage) => passage.kept);
  const parts: string[] = [];
  let used = 0;
  for (const passage of kept) {
    const chunk = passage.text.trim();
    if (chunk.length === 0) {
      continue;
    }
    const separator = parts.length === 0 ? 0 : 2;
    if (used + separator + chunk.length > input.maxChars) {
      const remaining = input.maxChars - used - separator;
      if (remaining > 40) {
        parts.push(chunk.slice(0, remaining).trimEnd());
        used = input.maxChars;
      }
      break;
    }
    parts.push(chunk);
    used += separator + chunk.length;
  }

  const omittedCount = result.ranked.filter((passage) => !passage.kept).length;
  return {
    text: parts.join("\n\n"),
    ranked: result.ranked,
    keptCount: kept.length,
    omittedCount,
    latencyMs: result.latencyMs,
    source: result.source,
  };
}

export function formatRecallRankLines(input: {
  ranked: readonly RankedRecallPassage[];
  latencyMs?: number;
  baselineMs?: number;
  dryRun?: boolean;
}): string[] {
  const prefix = input.dryRun === true ? "[dry-run] " : "";
  const kept = input.ranked.filter((passage) => passage.kept).length;
  const omitted = input.ranked.length - kept;
  const lines = [
    `${prefix}Recall rank: kept ${kept}, omitted ${omitted}`,
  ];
  if (input.latencyMs !== undefined) {
    const baseline =
      input.baselineMs !== undefined
        ? ` (baseline pass-through ${input.baselineMs}ms)`
        : "";
    lines.push(
      `${prefix}latency: ${input.latencyMs}ms vs unranked recall${baseline}`,
    );
  }
  for (const passage of input.ranked) {
    const conf =
      passage.relevanceConfidence !== undefined
        ? ` conf=${passage.relevanceConfidence.toFixed(2)}`
        : "";
    lines.push(
      `${prefix}  ${passage.kept ? "keep" : "drop"} ${passage.id} score=${passage.relevanceScore.toFixed(2)}${conf} (${passage.source}) ${passage.reason}`,
    );
  }
  return lines;
}

export function relevanceKey(passageId: string): string {
  return `relevance_${sanitizeId(passageId)}`;
}

function buildRecallRankState(
  task: string,
  passages: readonly RecallPassage[],
): {
  type: "recall_pack";
  task: string;
  passages: Array<{ id: string; text: string; documentId?: string }>;
} {
  return {
    type: "recall_pack",
    task: task.slice(0, RECALL_RANK_TASK_MAX_CHARS),
    passages: passages.map((passage) => {
      const item: { id: string; text: string; documentId?: string } = {
        id: passage.id.slice(0, JEV_DOCUMENT_ID_MAX_CHARS),
        text: passage.text.slice(0, JEV_OVERLAP_SUMMARY_MAX_CHARS),
      };
      if (passage.documentId !== undefined && passage.documentId.trim() !== "") {
        item.documentId = passage.documentId.slice(0, JEV_DOCUMENT_ID_MAX_CHARS);
      }
      return item;
    }),
  };
}

function relevanceQuestion(passageId: string): ScoreQuestion {
  return {
    type: "score",
    instructions: `How relevant is passage "${passageId}" to the current task? 0 is unrelated noise and 4 is essential context for this task.`,
    criteria: [
      "Unrelated noise or wrong topic",
      "Weak tangential mention",
      "Useful supporting detail",
      "Strongly on-topic for the task",
      "Essential context for this task",
    ],
  };
}

function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((token) => token.length >= 3);
  return new Set(tokens);
}

function overlapScore(taskTokens: Set<string>, passageTokens: Set<string>): number {
  if (taskTokens.size === 0 || passageTokens.size === 0) {
    return 0;
  }
  let hits = 0;
  for (const token of taskTokens) {
    if (passageTokens.has(token)) {
      hits += 1;
    }
  }
  const ratio = hits / taskTokens.size;
  if (ratio >= 0.6) {
    return 4;
  }
  if (ratio >= 0.4) {
    return 3;
  }
  if (ratio >= 0.2) {
    return 2;
  }
  if (ratio > 0) {
    return 1;
  }
  return 0;
}

function sanitizeId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "passage";
}

function readScore(
  answer: JudgeAnswer | undefined,
): { score: number; confidence: number } | undefined {
  if (answer === undefined || answer.type !== "score") {
    return undefined;
  }
  if (!Number.isFinite(answer.score) || !Number.isFinite(answer.confidence)) {
    return undefined;
  }
  return { score: answer.score, confidence: answer.confidence };
}
