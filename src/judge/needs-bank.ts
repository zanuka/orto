/*
Needs-bank gate decides whether an agent task needs the project Hindsight
bank. Any harness (Cursor, Claude Code, Firstmate, custom orchestrators) can
call judgeNeedsBank before recall, reflect, or attaching bank context.

Default path is pass-through: no TypeSafe call, verdict unset, workflows
behave as today. Opt in with needsBank:true or ORTO_JEV_NEEDS_BANK=1
(ORTO_JEV_FIRSTMATE_NEEDS_BANK / NOCCIOLO_* aliases). One Noul
needs_project_bank scores the task request. Confident no skips
recall/reflect (pure code task). Confident yes may use the bank. Uncertain
escalates to the operator. When the judge is off, or Jev falls back,
heuristicNeedsBank still separates narrow code edits from
architecture/playbook asks. This module does not host or proxy MCP and does
not embed TypeSafe keys.
*/

import { noulBand, type NoulBand } from "./relevance.js";
import {
  assertJevStateSendable,
  containsInlineSecret,
  JEV_SECTION_MAX_CHARS,
} from "./state.js";
import type {
  Judge,
  JudgeAnswer,
  JudgeQuestion,
  NoulQuestion,
} from "./types.js";

export const NEEDS_BANK_ENV = "ORTO_JEV_NEEDS_BANK";
export const NEEDS_BANK_ENV_ALIASES = [
  "ORTO_JEV_FIRSTMATE_NEEDS_BANK",
  "NOCCIOLO_JEV_NEEDS_BANK",
  "NOCCIOLO_JEV_FIRSTMATE_NEEDS_BANK",
] as const;
export const NEEDS_BANK_REQUEST_MAX_CHARS = JEV_SECTION_MAX_CHARS;
export const NEEDS_BANK_DEFAULT_CONFIDENCE = 0.8;

export type NeedsBankVerdict = "use_bank" | "skip_bank" | "escalate" | "unset";

export type NeedsBankSource = "jev" | "heuristic" | "pass_through";

export interface NeedsBankDecision {
  verdict: NeedsBankVerdict;
  reason: string;
  source: NeedsBankSource;
  needsProjectBank?: number;
  needsProjectBankBand?: NoulBand;
}

export interface NeedsBankResult {
  decision: NeedsBankDecision;
  latencyMs: number;
  enabled: boolean;
}

export function parseNeedsBankEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw =
    env[NEEDS_BANK_ENV] ??
    NEEDS_BANK_ENV_ALIASES.map((key) => env[key]).find(
      (value) => value !== undefined,
    );
  if (raw === undefined) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

export function resolveNeedsBankEnabled(input: {
  needsBank?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (input.needsBank === true) {
    return true;
  }
  if (input.needsBank === false) {
    return false;
  }
  return parseNeedsBankEnabled(input.env);
}

export function needsBankQuestions(): Record<string, JudgeQuestion> {
  return {
    needs_project_bank: needsProjectBankQuestion(),
  };
}

export function passThroughNeedsBank(): NeedsBankDecision {
  return {
    verdict: "unset",
    reason: "needs-bank gate off",
    source: "pass_through",
  };
}

export function heuristicNeedsBank(request: string): NeedsBankDecision {
  const trimmed = request.trim();
  if (trimmed.length === 0) {
    return {
      verdict: "escalate",
      reason: "empty task request",
      source: "heuristic",
    };
  }

  if (containsInlineSecret(trimmed)) {
    return {
      verdict: "skip_bank",
      reason: "secret pattern in request; skip bank path",
      source: "heuristic",
    };
  }

  const bankSignals = [
    /\bwhy do we\b/i,
    /\bhow do we\b/i,
    /\barchitecture\b/i,
    /\bADR\b/,
    /\bdecision\b/i,
    /\bcoding standards?\b/i,
    /\bplaybook\b/i,
    /\binvariant\b/i,
    /\bnon-negotiable\b/i,
    /\bmental model\b/i,
    /\bproject bank\b/i,
    /\bhindsight\b/i,
    /\breflect\b/i,
    /\brecall\b/i,
    /\bcompany brain\b/i,
    /\btrade-?offs?\b/i,
  ];
  const codeSignals = [
    /\btypo\b/i,
    /\blint\b/i,
    /\bformat(ting)?\b/i,
    /\bunit tests?\b/i,
    /\badd tests?\b/i,
    /\bfix tests?\b/i,
    /\brename\b/i,
    /\bbump\b/i,
    /\bdependenc(y|ies)\b/i,
    /\brefactor\b/i,
    /\bcompile\b/i,
    /\btypecheck\b/i,
    /\bimplement\b/i,
    /\bbugfix\b/i,
    /\bpatch\b/i,
  ];

  let bankHits = 0;
  for (const pattern of bankSignals) {
    if (pattern.test(trimmed)) {
      bankHits += 1;
    }
  }
  let codeHits = 0;
  for (const pattern of codeSignals) {
    if (pattern.test(trimmed)) {
      codeHits += 1;
    }
  }

  if (bankHits >= 1) {
    return {
      verdict: "use_bank",
      reason: "heuristic bank-context request",
      source: "heuristic",
    };
  }
  if (codeHits >= 1) {
    return {
      verdict: "skip_bank",
      reason: "heuristic pure-code request",
      source: "heuristic",
    };
  }
  if (trimmed.length < 24) {
    return {
      verdict: "escalate",
      reason: "short ambiguous request",
      source: "heuristic",
    };
  }
  return {
    verdict: "escalate",
    reason: "heuristic uncertain; escalate to operator",
    source: "heuristic",
  };
}

export function interpretNeedsBank(input: {
  answers: Record<string, JudgeAnswer>;
  confidence: number;
}): NeedsBankDecision {
  const needs = readNoul(input.answers.needs_project_bank);
  if (needs === undefined) {
    return {
      verdict: "escalate",
      reason: "missing needs_project_bank answer",
      source: "jev",
    };
  }
  const band = noulBand(needs, input.confidence);
  if (band === "no") {
    return {
      verdict: "skip_bank",
      reason: "confident needs_project_bank=no; pure code task",
      source: "jev",
      needsProjectBank: needs,
      needsProjectBankBand: band,
    };
  }
  if (band === "yes") {
    return {
      verdict: "use_bank",
      reason: "confident needs_project_bank=yes",
      source: "jev",
      needsProjectBank: needs,
      needsProjectBankBand: band,
    };
  }
  return {
    verdict: "escalate",
    reason: `needs_project_bank uncertain at ${input.confidence.toFixed(2)}; escalate to operator`,
    source: "jev",
    needsProjectBank: needs,
    needsProjectBankBand: band,
  };
}

export async function judgeNeedsBank(input: {
  request: string;
  judge?: Judge;
  confidence: number;
  needsBank?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<NeedsBankResult> {
  const started = Date.now();
  const enabled = resolveNeedsBankEnabled({
    ...(input.needsBank !== undefined ? { needsBank: input.needsBank } : {}),
    ...(input.env !== undefined ? { env: input.env } : {}),
  });

  if (!enabled) {
    return {
      decision: passThroughNeedsBank(),
      latencyMs: Date.now() - started,
      enabled: false,
    };
  }

  if (containsInlineSecret(input.request)) {
    return {
      decision: heuristicNeedsBank(input.request),
      latencyMs: Date.now() - started,
      enabled: true,
    };
  }

  if (
    input.judge === undefined ||
    input.judge.id === "off" ||
    input.judge.id !== "jev"
  ) {
    return {
      decision: heuristicNeedsBank(input.request),
      latencyMs: Date.now() - started,
      enabled: true,
    };
  }

  const state = {
    type: "needs_bank",
    request: input.request.slice(0, NEEDS_BANK_REQUEST_MAX_CHARS),
  };

  try {
    assertJevStateSendable(state);
  } catch {
    return {
      decision: heuristicNeedsBank(input.request),
      latencyMs: Date.now() - started,
      enabled: true,
    };
  }

  const result = await input.judge.evaluate({
    state,
    questions: needsBankQuestions(),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    return {
      decision: heuristicNeedsBank(input.request),
      latencyMs: Date.now() - started,
      enabled: true,
    };
  }

  return {
    decision: interpretNeedsBank({
      answers: result.answers,
      confidence: input.confidence,
    }),
    latencyMs: Date.now() - started,
    enabled: true,
  };
}

export function formatNeedsBankLines(input: {
  decision: NeedsBankDecision;
  latencyMs?: number;
  dryRun?: boolean;
}): string[] {
  const prefix = input.dryRun === true ? "[dry-run] " : "";
  const lines = [
    `${prefix}Needs bank: ${input.decision.verdict} (${input.decision.source})`,
    `${prefix}reason: ${input.decision.reason}`,
  ];
  if (
    input.decision.needsProjectBank !== undefined &&
    input.decision.needsProjectBankBand !== undefined
  ) {
    lines.push(
      `${prefix}needs_project_bank: ${input.decision.needsProjectBank.toFixed(2)} ${input.decision.needsProjectBankBand}`,
    );
  }
  if (input.latencyMs !== undefined) {
    lines.push(`${prefix}latency: ${input.latencyMs}ms vs ungated request`);
  }
  return lines;
}

function needsProjectBankQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions:
      "Does this agent task need project bank context (architecture, decisions, standards, playbook) beyond what is already in the open files and repo tree?",
    criteria: {
      true: "The task depends on durable project knowledge: ADRs, architecture, coding standards, invariants, or how-we-work playbook answers.",
      false:
        "Pure code work: typo, lint, tests, rename, dependency bump, or a local refactor that does not need recall/reflect.",
    },
  };
}

function readNoul(answer: JudgeAnswer | undefined): number | undefined {
  if (answer === undefined || answer.type !== "noul" || !Number.isFinite(answer.noul)) {
    return undefined;
  }
  return answer.noul;
}
