/*
Scout-report seedability decides whether an investigation report (typically
data/<id>/report.md from a Firstmate scout) is durable enough to queue into
orto seed / store, or is scratch-pad noise that must not enter the bank.

Any harness that lands scout-shaped reports can call judgeScoutSeedability.
Default path is pass-through: no TypeSafe call, verdict unset. Opt in with
scoutSeed:true or ORTO_JEV_SCOUT_SEEDABILITY=1 (Firstmate/Nocciolo aliases).
One call asks Noul is_durable_scout_report, Noul is_scratch_pad, and Choice
action (seed | skip | review). Confident durable + not scratch → seed (queue
orto store/seed; never MCP-retain). Confident scratch → skip. Low confidence
→ review. When the judge is off, or Jev falls back, heuristicScoutSeedability
still separates ADR-shaped findings from TODO dumps. This module does not
host or proxy MCP, does not wrap TypeSafe's installer, and does not embed
TypeSafe keys.
*/

import { noulBand, type NoulBand } from "./relevance.js";
import {
  assertJevStateSendable,
  containsInlineSecret,
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

export const SCOUT_SEED_ACTIONS = ["seed", "skip", "review"] as const;
export type ScoutSeedAction = (typeof SCOUT_SEED_ACTIONS)[number];

export type ScoutSeedVerdict = ScoutSeedAction | "unset";
export type ScoutSeedSource = "jev" | "heuristic" | "pass_through";

export const SCOUT_SEEDABILITY_ENV = "ORTO_JEV_SCOUT_SEEDABILITY";
export const SCOUT_SEEDABILITY_ENV_ALIASES = [
  "ORTO_JEV_FIRSTMATE_SCOUT_SEED",
  "NOCCIOLO_JEV_SCOUT_SEEDABILITY",
  "NOCCIOLO_JEV_FIRSTMATE_SCOUT_SEED",
] as const;
export const SCOUT_SEEDABILITY_DEFAULT_CONFIDENCE = 0.8;
export const SCOUT_SEEDABILITY_TEXT_MAX_CHARS = JEV_SECTION_MAX_CHARS;

export const SCOUT_REPORT_PATH_RE =
  /(?:^|\/)data\/[^/]+\/report\.md$/i;

export interface ScoutSeedDecision {
  verdict: ScoutSeedVerdict;
  reason: string;
  source: ScoutSeedSource;
  path?: string;
  isDurableScoutReport?: number;
  isDurableScoutReportBand?: NoulBand;
  isScratchPad?: number;
  isScratchPadBand?: NoulBand;
  chosenAction?: string;
  actionConfidence?: number;
  agentMessage: string;
}

export interface ScoutSeedResult {
  decision: ScoutSeedDecision;
  latencyMs: number;
  enabled: boolean;
}

export const SCOUT_SEED_SEED_MESSAGE =
  "Scout report looks durable. Queue `orto store` or `orto seed` in the durable clone. Do not MCP-retain.";

export const SCOUT_SEED_SKIP_MESSAGE =
  "Scout report looks like a scratch pad. Do not seed or MCP-retain.";

export const SCOUT_SEED_REVIEW_MESSAGE =
  "Scout report seedability is uncertain. Ask the captain/operator before seeding.";

export const SCOUT_SEED_UNSET_MESSAGE =
  "Scout seedability gate is off; no seed/skip policy applied.";

export function parseScoutSeedabilityEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw =
    env[SCOUT_SEEDABILITY_ENV] ??
    SCOUT_SEEDABILITY_ENV_ALIASES.map((key) => env[key]).find(
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

export function resolveScoutSeedabilityEnabled(input: {
  scoutSeed?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (input.scoutSeed === true) {
    return true;
  }
  if (input.scoutSeed === false) {
    return false;
  }
  return parseScoutSeedabilityEnabled(input.env);
}

export function looksLikeScoutReportPath(path: string | undefined): boolean {
  if (path === undefined || path.trim() === "") {
    return false;
  }
  return SCOUT_REPORT_PATH_RE.test(path.replace(/\\/g, "/"));
}

export function scoutSeedabilityQuestions(): Record<string, JudgeQuestion> {
  return {
    is_durable_scout_report: durableScoutQuestion(),
    is_scratch_pad: scratchPadQuestion(),
    action: actionQuestion(),
  };
}

export function passThroughScoutSeedability(): ScoutSeedDecision {
  return {
    verdict: "unset",
    reason: "scout seedability gate off",
    source: "pass_through",
    agentMessage: SCOUT_SEED_UNSET_MESSAGE,
  };
}

export function heuristicScoutSeedability(input: {
  text: string;
  path?: string;
}): ScoutSeedDecision {
  const trimmed = input.text.trim();
  const path = input.path?.trim();

  if (trimmed.length === 0) {
    return {
      verdict: "skip",
      reason: "empty scout report",
      source: "heuristic",
      ...(path !== undefined && path !== "" ? { path } : {}),
      agentMessage: SCOUT_SEED_SKIP_MESSAGE,
    };
  }

  if (containsInlineSecret(trimmed)) {
    return {
      verdict: "skip",
      reason: "secret pattern in scout report; skip seed",
      source: "heuristic",
      ...(path !== undefined && path !== "" ? { path } : {}),
      agentMessage: SCOUT_SEED_SKIP_MESSAGE,
    };
  }

  if (path !== undefined && path !== "" && !looksLikeScoutReportPath(path)) {
    return {
      verdict: "review",
      reason: "path is not data/<id>/report.md; review before seed",
      source: "heuristic",
      path,
      agentMessage: SCOUT_SEED_REVIEW_MESSAGE,
    };
  }

  const scratchSignals = [
    /\bTODO\b/,
    /\bWIP\b/,
    /\bscratch\b/i,
    /\brough notes?\b/i,
    /\bbrainstorm\b/i,
    /\bmeeting notes?\b/i,
    /\bjust tried\b/i,
    /\bdebug log\b/i,
    /\btranscript\b/i,
    /\braw dump\b/i,
    /\bignore this\b/i,
    /\btemp(orary)?\b/i,
  ];
  const durableSignals = [
    /\bADR\b/,
    /\barchitecture\b/i,
    /\bdecision\b/i,
    /\binvariant\b/i,
    /\bnon-negotiable\b/i,
    /\bstandard\b/i,
    /\bplaybook\b/i,
    /\btrade-?off\b/i,
    /\bwe (should|must|will)\b/i,
    /\brecommend(ation|ed)?\b/i,
    /\bfinding(s)?\b/i,
    /\bconclusion\b/i,
    /\bdurable\b/i,
  ];

  let scratchHits = 0;
  for (const pattern of scratchSignals) {
    if (pattern.test(trimmed)) {
      scratchHits += 1;
    }
  }
  let durableHits = 0;
  for (const pattern of durableSignals) {
    if (pattern.test(trimmed)) {
      durableHits += 1;
    }
  }

  if (scratchHits >= 2 && durableHits === 0) {
    return {
      verdict: "skip",
      reason: "heuristic scratch-pad scout report",
      source: "heuristic",
      ...(path !== undefined && path !== "" ? { path } : {}),
      agentMessage: SCOUT_SEED_SKIP_MESSAGE,
    };
  }

  if (durableHits >= 2 && scratchHits === 0) {
    return {
      verdict: "seed",
      reason: "heuristic durable scout findings",
      source: "heuristic",
      ...(path !== undefined && path !== "" ? { path } : {}),
      agentMessage: SCOUT_SEED_SEED_MESSAGE,
    };
  }

  if (durableHits >= 1 && scratchHits >= 1) {
    return {
      verdict: "review",
      reason: "heuristic mixed durable and scratch signals",
      source: "heuristic",
      ...(path !== undefined && path !== "" ? { path } : {}),
      agentMessage: SCOUT_SEED_REVIEW_MESSAGE,
    };
  }

  if (trimmed.length < 80) {
    return {
      verdict: "review",
      reason: "short ambiguous scout report",
      source: "heuristic",
      ...(path !== undefined && path !== "" ? { path } : {}),
      agentMessage: SCOUT_SEED_REVIEW_MESSAGE,
    };
  }

  return {
    verdict: "review",
    reason: "heuristic uncertain; review before seed",
    source: "heuristic",
    ...(path !== undefined && path !== "" ? { path } : {}),
    agentMessage: SCOUT_SEED_REVIEW_MESSAGE,
  };
}

export function interpretScoutSeedability(input: {
  answers: Record<string, JudgeAnswer>;
  confidence: number;
  path?: string;
}): ScoutSeedDecision {
  const durable = readNoul(input.answers.is_durable_scout_report);
  const scratch = readNoul(input.answers.is_scratch_pad);
  const chosen = readChoice(input.answers.action);
  const durableBand =
    durable === undefined ? undefined : noulBand(durable, input.confidence);
  const scratchBand =
    scratch === undefined ? undefined : noulBand(scratch, input.confidence);
  const actionConfident =
    chosen !== undefined &&
    SCOUT_SEED_ACTIONS.includes(chosen.choice as ScoutSeedAction) &&
    chosen.confidence + 1e-9 >= input.confidence;

  const base = {
    source: "jev" as const,
    ...(input.path !== undefined && input.path.trim() !== ""
      ? { path: input.path.trim() }
      : {}),
    ...(durable !== undefined ? { isDurableScoutReport: durable } : {}),
    ...(durableBand !== undefined
      ? { isDurableScoutReportBand: durableBand }
      : {}),
    ...(scratch !== undefined ? { isScratchPad: scratch } : {}),
    ...(scratchBand !== undefined ? { isScratchPadBand: scratchBand } : {}),
    ...(chosen !== undefined
      ? {
          chosenAction: chosen.choice,
          actionConfidence: chosen.confidence,
        }
      : {}),
  };

  if (scratchBand === "yes") {
    return {
      ...base,
      verdict: "skip",
      reason: "confident is_scratch_pad=yes",
      agentMessage: SCOUT_SEED_SKIP_MESSAGE,
    };
  }

  if (actionConfident && chosen?.choice === "skip") {
    return {
      ...base,
      verdict: "skip",
      reason: "action skip",
      agentMessage: SCOUT_SEED_SKIP_MESSAGE,
    };
  }

  if (actionConfident && chosen?.choice === "review") {
    return {
      ...base,
      verdict: "review",
      reason: "action review",
      agentMessage: SCOUT_SEED_REVIEW_MESSAGE,
    };
  }

  if (
    actionConfident &&
    chosen?.choice === "seed" &&
    durableBand === "yes" &&
    scratchBand !== "yes"
  ) {
    return {
      ...base,
      verdict: "seed",
      reason: "durable scout report",
      agentMessage: SCOUT_SEED_SEED_MESSAGE,
    };
  }

  if (durableBand === "yes" && scratchBand === "no" && actionConfident !== true) {
    return {
      ...base,
      verdict: "review",
      reason: `action below ${input.confidence.toFixed(2)}; review`,
      agentMessage: SCOUT_SEED_REVIEW_MESSAGE,
    };
  }

  return {
    ...base,
    verdict: "review",
    reason:
      actionConfident && chosen?.choice === "seed"
        ? "seed without confident durability"
        : `scout seedability below ${input.confidence.toFixed(2)}; review`,
    agentMessage: SCOUT_SEED_REVIEW_MESSAGE,
  };
}

export async function judgeScoutSeedability(input: {
  text: string;
  path?: string;
  judge?: Judge;
  confidence: number;
  scoutSeed?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<ScoutSeedResult> {
  const started = Date.now();
  const enabled = resolveScoutSeedabilityEnabled({
    ...(input.scoutSeed !== undefined ? { scoutSeed: input.scoutSeed } : {}),
    ...(input.env !== undefined ? { env: input.env } : {}),
  });

  if (!enabled) {
    return {
      decision: passThroughScoutSeedability(),
      latencyMs: Date.now() - started,
      enabled: false,
    };
  }

  if (containsInlineSecret(input.text)) {
    return {
      decision: heuristicScoutSeedability({
        text: input.text,
        ...(input.path !== undefined ? { path: input.path } : {}),
      }),
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
      decision: heuristicScoutSeedability({
        text: input.text,
        ...(input.path !== undefined ? { path: input.path } : {}),
      }),
      latencyMs: Date.now() - started,
      enabled: true,
    };
  }

  const state = {
    type: "scout_seedability",
    ...(input.path !== undefined
      ? { path: input.path.slice(0, JEV_PATH_MAX_CHARS) }
      : {}),
    text: input.text.slice(0, SCOUT_SEEDABILITY_TEXT_MAX_CHARS),
  };

  try {
    assertJevStateSendable(state);
  } catch {
    return {
      decision: heuristicScoutSeedability({
        text: input.text,
        ...(input.path !== undefined ? { path: input.path } : {}),
      }),
      latencyMs: Date.now() - started,
      enabled: true,
    };
  }

  const result = await input.judge.evaluate({
    state,
    questions: scoutSeedabilityQuestions(),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    return {
      decision: heuristicScoutSeedability({
        text: input.text,
        ...(input.path !== undefined ? { path: input.path } : {}),
      }),
      latencyMs: Date.now() - started,
      enabled: true,
    };
  }

  return {
    decision: interpretScoutSeedability({
      answers: result.answers,
      confidence: input.confidence,
      ...(input.path !== undefined ? { path: input.path } : {}),
    }),
    latencyMs: Date.now() - started,
    enabled: true,
  };
}

export function formatScoutSeedabilityLines(input: {
  decision: ScoutSeedDecision;
  latencyMs?: number;
  dryRun?: boolean;
}): string[] {
  const prefix = input.dryRun === true ? "[dry-run] " : "";
  const lines = [
    `${prefix}Scout seedability: ${input.decision.verdict} (${input.decision.source})`,
    `${prefix}reason: ${input.decision.reason}`,
    `${prefix}agent: ${input.decision.agentMessage}`,
  ];
  if (input.decision.path !== undefined) {
    lines.push(`${prefix}path: ${input.decision.path}`);
  }
  if (
    input.decision.isDurableScoutReport !== undefined &&
    input.decision.isDurableScoutReportBand !== undefined
  ) {
    lines.push(
      `${prefix}is_durable_scout_report: ${input.decision.isDurableScoutReport.toFixed(2)} ${input.decision.isDurableScoutReportBand}`,
    );
  }
  if (
    input.decision.isScratchPad !== undefined &&
    input.decision.isScratchPadBand !== undefined
  ) {
    lines.push(
      `${prefix}is_scratch_pad: ${input.decision.isScratchPad.toFixed(2)} ${input.decision.isScratchPadBand}`,
    );
  }
  if (
    input.decision.chosenAction !== undefined &&
    input.decision.actionConfidence !== undefined
  ) {
    lines.push(
      `${prefix}action: ${input.decision.chosenAction} confidence=${input.decision.actionConfidence.toFixed(2)}`,
    );
  }
  if (input.latencyMs !== undefined) {
    lines.push(
      `${prefix}latency: ${input.latencyMs}ms vs ungated scout seedability`,
    );
  }
  return lines;
}

function durableScoutQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions:
      "Is this scout/investigation report durable project knowledge worth seeding into the company bank (decisions, findings, architecture, standards)?",
    criteria: {
      true: "Durable findings: architecture decisions, invariants, recommended standards, clear conclusions that should outlive the scout run.",
      false:
        "Scratch or ephemeral: TODO piles, brainstorms, transcripts, debug logs, or temporary notes not ready for the bank.",
    },
  };
}

function scratchPadQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions:
      "Is this scout report mostly a scratch pad (WIP notes, TODOs, transcripts) rather than durable findings?",
    criteria: {
      true: "Scratch pad: WIP, TODO dumps, meeting transcripts, raw debug logs, or 'just tried X' notes.",
      false:
        "Structured durable findings with decisions, recommendations, or architecture conclusions.",
    },
  };
}

function actionQuestion(): ChoiceQuestion {
  return {
    type: "choice",
    instructions:
      "Should the harness queue this scout report into orto store/seed, skip it, or ask the captain to review? Prefer seed only for durable findings. Prefer skip for scratch pads. Prefer review when unsure. Never MCP-retain mid-session.",
    criteria: {
      seed: {
        what: "Queue orto store or orto seed for durable scout findings.",
        not_for: "Scratch pads, WIP notes, or secret-bearing text.",
        examples: [
          "data/abc/report.md concluding we must keep the bank local-first.",
          "Investigation that records an architecture decision and trade-off.",
        ],
      },
      skip: {
        what: "Do not seed. Report is scratch or ephemeral.",
        not_for: "Clear durable decisions or standards worth retaining.",
        examples: [
          "WIP brainstorm with TODO piles and debug logs.",
          "Raw transcript of a scout session with no durable conclusion.",
        ],
      },
      review: {
        what: "Ask the captain/operator before seeding.",
        not_for: "Obvious durable findings or obvious scratch pads.",
        examples: [
          "Mixed durable claims and scratch notes.",
          "Short ambiguous report without a clear recommendation.",
        ],
      },
    },
  };
}

function readNoul(answer: JudgeAnswer | undefined): number | undefined {
  if (
    answer === undefined ||
    answer.type !== "noul" ||
    !Number.isFinite(answer.noul)
  ) {
    return undefined;
  }
  return answer.noul;
}

function readChoice(
  answer: JudgeAnswer | undefined,
): { choice: string; confidence: number } | undefined {
  if (answer === undefined || answer.type !== "choice") {
    return undefined;
  }
  if (!Number.isFinite(answer.confidence) || answer.choice.trim() === "") {
    return undefined;
  }
  return { choice: answer.choice, confidence: answer.confidence };
}
