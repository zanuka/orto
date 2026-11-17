/*
Escalate vs dispatch chooses whether a multi-agent harness should escalate a
task to the captain/operator or dispatch it to a listed worker charter.
Any orchestrator (Firstmate, custom crews, Claude Code / Codex / Cursor / Pi
wrappers) can call judgeEscalateDispatch with the task request and the
distro's charter list.

Default path is pass-through: no TypeSafe call, verdict unset. Opt in with
dispatch:true or ORTO_JEV_ESCALATE_DISPATCH=1 (Firstmate/Nocciolo aliases).
One call asks Noul needs_captain and Choice crewmate. Crewmate criteria are
built only from the provided charter ids (plus ask_captain). Empty or missing
charters yield only ask_captain: never invent workers. Confident needs_captain
yes → escalate. Confident no + a listed crewmate → dispatch. Low confidence
escalates. When the judge is off, or Jev falls back, heuristicEscalateDispatch
still separates architecture-invariant work from typo/test-fix dispatch.
This module does not host or proxy MCP and does not embed TypeSafe keys.
*/

import { noulBand, type NoulBand } from "./relevance.js";
import {
  assertJevStateSendable,
  containsInlineSecret,
  JEV_DOCUMENT_ID_MAX_CHARS,
  JEV_HEADING_MAX_CHARS,
  JEV_SECTION_MAX_CHARS,
} from "./state.js";
import type {
  ChoiceCriterion,
  ChoiceQuestion,
  Judge,
  JudgeAnswer,
  JudgeQuestion,
  NoulQuestion,
  StructuredChoiceCriterion,
} from "./types.js";

export const ASK_CAPTAIN = "ask_captain" as const;

export const ESCALATE_DISPATCH_ENV = "ORTO_JEV_ESCALATE_DISPATCH";
export const ESCALATE_DISPATCH_ENV_ALIASES = [
  "ORTO_JEV_FIRSTMATE_DISPATCH",
  "NOCCIOLO_JEV_ESCALATE_DISPATCH",
  "NOCCIOLO_JEV_FIRSTMATE_DISPATCH",
] as const;
export const ESCALATE_DISPATCH_DEFAULT_CONFIDENCE = 0.8;
export const ESCALATE_DISPATCH_REQUEST_MAX_CHARS = JEV_SECTION_MAX_CHARS;
export const ESCALATE_DISPATCH_MAX_CHARTERS = 24;

export type EscalateDispatchVerdict =
  | "escalate"
  | "dispatch"
  | "unset";

export type EscalateDispatchSource = "jev" | "heuristic" | "pass_through";

export interface CrewmateCharter {
  id: string;
  name: string;
  description?: string;
}

export interface EscalateDispatchDecision {
  verdict: EscalateDispatchVerdict;
  crewmate: string;
  reason: string;
  source: EscalateDispatchSource;
  needsCaptain?: number;
  needsCaptainBand?: NoulBand;
  chosenCrewmate?: string;
  crewmateConfidence?: number;
  agentMessage: string;
}

export interface EscalateDispatchResult {
  decision: EscalateDispatchDecision;
  latencyMs: number;
  enabled: boolean;
}

export const ESCALATE_DISPATCH_ESCALATE_MESSAGE =
  "Escalate to the captain/operator. Do not dispatch a worker silently.";

export const ESCALATE_DISPATCH_DISPATCH_MESSAGE =
  "Dispatch to the chosen worker charter. Routine work does not need captain review.";

export const ESCALATE_DISPATCH_UNSET_MESSAGE =
  "Escalate/dispatch gate is off; no routing policy applied.";

export function parseEscalateDispatchEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw =
    env[ESCALATE_DISPATCH_ENV] ??
    ESCALATE_DISPATCH_ENV_ALIASES.map((key) => env[key]).find(
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

export function resolveEscalateDispatchEnabled(input: {
  dispatch?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (input.dispatch === true) {
    return true;
  }
  if (input.dispatch === false) {
    return false;
  }
  return parseEscalateDispatchEnabled(input.env);
}

export function normalizeCrewmateCharters(
  charters: readonly CrewmateCharter[] | undefined,
): CrewmateCharter[] {
  if (charters === undefined || charters.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const out: CrewmateCharter[] = [];
  for (const charter of charters) {
    const id = sanitizeCrewmateId(charter.id);
    if (id === undefined || id === ASK_CAPTAIN || seen.has(id)) {
      continue;
    }
    const name = charter.name.trim();
    if (name.length === 0) {
      continue;
    }
    seen.add(id);
    out.push({
      id,
      name: name.slice(0, JEV_HEADING_MAX_CHARS),
      ...(charter.description !== undefined && charter.description.trim() !== ""
        ? {
            description: charter.description
              .trim()
              .slice(0, JEV_SECTION_MAX_CHARS),
          }
        : {}),
    });
    if (out.length >= ESCALATE_DISPATCH_MAX_CHARTERS) {
      break;
    }
  }
  return out;
}

export function buildCrewmateCriteria(
  charters: readonly CrewmateCharter[],
): Record<string, ChoiceCriterion> {
  const criteria: Record<string, ChoiceCriterion> = {
    [ASK_CAPTAIN]: {
      what: "Escalate to the captain/operator. Real decisions, ambiguous scope, or missing worker fit.",
      not_for: "Routine implementable work when a matching worker charter is listed.",
      examples: [
        "Change a non-negotiable architecture invariant.",
        "Pick a trade-off that needs captain judgment.",
      ],
    },
  };
  for (const charter of normalizeCrewmateCharters(charters)) {
    criteria[charter.id] = charterCriterion(charter);
  }
  return criteria;
}

export function escalateDispatchQuestions(
  charters: readonly CrewmateCharter[] = [],
): Record<string, JudgeQuestion> {
  return {
    needs_captain: needsCaptainQuestion(),
    crewmate: crewmateQuestion(charters),
  };
}

export function passThroughEscalateDispatch(): EscalateDispatchDecision {
  return {
    verdict: "unset",
    crewmate: ASK_CAPTAIN,
    reason: "escalate/dispatch gate off",
    source: "pass_through",
    agentMessage: ESCALATE_DISPATCH_UNSET_MESSAGE,
  };
}

export function heuristicEscalateDispatch(input: {
  request: string;
  charters?: readonly CrewmateCharter[];
}): EscalateDispatchDecision {
  const trimmed = input.request.trim();
  const charters = normalizeCrewmateCharters(input.charters);

  if (trimmed.length === 0) {
    return escalateDecision(
      "empty task request",
      "heuristic",
    );
  }

  if (containsInlineSecret(trimmed)) {
    return escalateDecision(
      "secret pattern in request; escalate",
      "heuristic",
    );
  }

  if (charters.length === 0) {
    return escalateDecision(
      "no crewmate charters listed; ask_captain only",
      "heuristic",
    );
  }

  const captainSignals = [
    /\barchitecture\b/i,
    /\binvariant\b/i,
    /\bnon-negotiable\b/i,
    /\bADR\b/,
    /\btrade-?off\b/i,
    /\bdecision\b/i,
    /\bpolicy\b/i,
    /\bmission\b/i,
    /\bcaptain\b/i,
    /\bescalat/i,
    /\bcompany brain\b/i,
    /\bplaybook\b/i,
  ];
  const routineSignals = [
    /\btypo\b/i,
    /\blint\b/i,
    /\bformat(ting)?\b/i,
    /\bunit tests?\b/i,
    /\btest[\s\-]?fix\b/i,
    /\bfix tests?\b/i,
    /\badd tests?\b/i,
    /\brename\b/i,
    /\bbump\b/i,
    /\bdependenc(y|ies)\b/i,
    /\bcompile\b/i,
    /\btypecheck\b/i,
    /\bspelling\b/i,
  ];

  let captainHits = 0;
  for (const pattern of captainSignals) {
    if (pattern.test(trimmed)) {
      captainHits += 1;
    }
  }
  let routineHits = 0;
  for (const pattern of routineSignals) {
    if (pattern.test(trimmed)) {
      routineHits += 1;
    }
  }

  if (captainHits >= 1) {
    return escalateDecision(
      "heuristic architecture/decision work; needs captain",
      "heuristic",
      0.92,
      "yes",
    );
  }

  if (routineHits >= 1) {
    const implementer = pickImplementerCharter(charters);
    if (implementer !== undefined) {
      return {
        verdict: "dispatch",
        crewmate: implementer.id,
        reason: `heuristic routine work; dispatch ${implementer.id}`,
        source: "heuristic",
        needsCaptain: 0.08,
        needsCaptainBand: "no",
        agentMessage: ESCALATE_DISPATCH_DISPATCH_MESSAGE,
      };
    }
    return escalateDecision(
      "heuristic routine work but no implementer charter listed",
      "heuristic",
    );
  }

  if (trimmed.length < 24) {
    return escalateDecision("short ambiguous request", "heuristic");
  }
  return escalateDecision(
    "heuristic uncertain; escalate to captain",
    "heuristic",
  );
}

export function interpretEscalateDispatch(input: {
  answers: Record<string, JudgeAnswer>;
  confidence: number;
  charters?: readonly CrewmateCharter[];
}): EscalateDispatchDecision {
  const charters = normalizeCrewmateCharters(input.charters);
  const allowed = new Set<string>([ASK_CAPTAIN, ...charters.map((c) => c.id)]);
  const needs = readNoul(input.answers.needs_captain);
  const chosen = readChoice(input.answers.crewmate);

  if (needs === undefined) {
    return escalateDecision(
      "missing needs_captain answer",
      "jev",
      undefined,
      undefined,
      chosen,
    );
  }

  const band = noulBand(needs, input.confidence);
  const crewmateConfident =
    chosen !== undefined &&
    allowed.has(chosen.choice) &&
    chosen.confidence + 1e-9 >= input.confidence;

  if (band === "yes") {
    return {
      verdict: "escalate",
      crewmate: ASK_CAPTAIN,
      reason: "confident needs_captain=yes",
      source: "jev",
      needsCaptain: needs,
      needsCaptainBand: band,
      ...(chosen !== undefined
        ? {
            chosenCrewmate: chosen.choice,
            crewmateConfidence: chosen.confidence,
          }
        : {}),
      agentMessage: ESCALATE_DISPATCH_ESCALATE_MESSAGE,
    };
  }

  if (band === "uncertain") {
    return {
      verdict: "escalate",
      crewmate: ASK_CAPTAIN,
      reason: `needs_captain uncertain at ${input.confidence.toFixed(2)}; escalate`,
      source: "jev",
      needsCaptain: needs,
      needsCaptainBand: band,
      ...(chosen !== undefined
        ? {
            chosenCrewmate: chosen.choice,
            crewmateConfidence: chosen.confidence,
          }
        : {}),
      agentMessage: ESCALATE_DISPATCH_ESCALATE_MESSAGE,
    };
  }

  if (charters.length === 0) {
    return {
      verdict: "escalate",
      crewmate: ASK_CAPTAIN,
      reason: "no crewmate charters listed; ask_captain only",
      source: "jev",
      needsCaptain: needs,
      needsCaptainBand: band,
      ...(chosen !== undefined
        ? {
            chosenCrewmate: chosen.choice,
            crewmateConfidence: chosen.confidence,
          }
        : {}),
      agentMessage: ESCALATE_DISPATCH_ESCALATE_MESSAGE,
    };
  }

  if (
    crewmateConfident &&
    chosen !== undefined &&
    chosen.choice !== ASK_CAPTAIN &&
    allowed.has(chosen.choice)
  ) {
    return {
      verdict: "dispatch",
      crewmate: chosen.choice,
      reason: `confident needs_captain=no; dispatch ${chosen.choice}`,
      source: "jev",
      needsCaptain: needs,
      needsCaptainBand: band,
      chosenCrewmate: chosen.choice,
      crewmateConfidence: chosen.confidence,
      agentMessage: ESCALATE_DISPATCH_DISPATCH_MESSAGE,
    };
  }

  if (
    crewmateConfident &&
    chosen !== undefined &&
    chosen.choice === ASK_CAPTAIN
  ) {
    return {
      verdict: "escalate",
      crewmate: ASK_CAPTAIN,
      reason: "confident needs_captain=no but crewmate=ask_captain",
      source: "jev",
      needsCaptain: needs,
      needsCaptainBand: band,
      chosenCrewmate: chosen.choice,
      crewmateConfidence: chosen.confidence,
      agentMessage: ESCALATE_DISPATCH_ESCALATE_MESSAGE,
    };
  }

  return {
    verdict: "escalate",
    crewmate: ASK_CAPTAIN,
    reason:
      chosen === undefined
        ? "missing or invalid crewmate choice; escalate"
        : `crewmate below ${input.confidence.toFixed(2)}; escalate`,
    source: "jev",
    needsCaptain: needs,
    needsCaptainBand: band,
    ...(chosen !== undefined
      ? {
          chosenCrewmate: chosen.choice,
          crewmateConfidence: chosen.confidence,
        }
      : {}),
    agentMessage: ESCALATE_DISPATCH_ESCALATE_MESSAGE,
  };
}

export async function judgeEscalateDispatch(input: {
  request: string;
  charters?: readonly CrewmateCharter[];
  judge?: Judge;
  confidence: number;
  dispatch?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<EscalateDispatchResult> {
  const started = Date.now();
  const enabled = resolveEscalateDispatchEnabled({
    ...(input.dispatch !== undefined ? { dispatch: input.dispatch } : {}),
    ...(input.env !== undefined ? { env: input.env } : {}),
  });
  const charters = normalizeCrewmateCharters(input.charters);

  if (!enabled) {
    return {
      decision: passThroughEscalateDispatch(),
      latencyMs: Date.now() - started,
      enabled: false,
    };
  }

  if (containsInlineSecret(input.request)) {
    return {
      decision: heuristicEscalateDispatch({
        request: input.request,
        charters,
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
      decision: heuristicEscalateDispatch({
        request: input.request,
        charters,
      }),
      latencyMs: Date.now() - started,
      enabled: true,
    };
  }

  const state = {
    type: "escalate_dispatch",
    request: input.request.slice(0, ESCALATE_DISPATCH_REQUEST_MAX_CHARS),
    charters: charters.map((charter) => ({
      id: charter.id.slice(0, JEV_DOCUMENT_ID_MAX_CHARS),
      name: charter.name.slice(0, JEV_HEADING_MAX_CHARS),
      ...(charter.description !== undefined
        ? {
            description: charter.description.slice(0, JEV_SECTION_MAX_CHARS),
          }
        : {}),
    })),
  };

  try {
    assertJevStateSendable(state);
  } catch {
    return {
      decision: heuristicEscalateDispatch({
        request: input.request,
        charters,
      }),
      latencyMs: Date.now() - started,
      enabled: true,
    };
  }

  const result = await input.judge.evaluate({
    state,
    questions: escalateDispatchQuestions(charters),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    return {
      decision: heuristicEscalateDispatch({
        request: input.request,
        charters,
      }),
      latencyMs: Date.now() - started,
      enabled: true,
    };
  }

  return {
    decision: interpretEscalateDispatch({
      answers: result.answers,
      confidence: input.confidence,
      charters,
    }),
    latencyMs: Date.now() - started,
    enabled: true,
  };
}

export function formatEscalateDispatchLines(input: {
  decision: EscalateDispatchDecision;
  latencyMs?: number;
  dryRun?: boolean;
}): string[] {
  const prefix = input.dryRun === true ? "[dry-run] " : "";
  const lines = [
    `${prefix}Escalate/dispatch: ${input.decision.verdict} → ${input.decision.crewmate} (${input.decision.source})`,
    `${prefix}reason: ${input.decision.reason}`,
    `${prefix}agent: ${input.decision.agentMessage}`,
  ];
  if (
    input.decision.needsCaptain !== undefined &&
    input.decision.needsCaptainBand !== undefined
  ) {
    lines.push(
      `${prefix}needs_captain: ${input.decision.needsCaptain.toFixed(2)} ${input.decision.needsCaptainBand}`,
    );
  }
  if (
    input.decision.chosenCrewmate !== undefined &&
    input.decision.crewmateConfidence !== undefined
  ) {
    lines.push(
      `${prefix}crewmate: ${input.decision.chosenCrewmate} confidence=${input.decision.crewmateConfidence.toFixed(2)}`,
    );
  }
  if (input.latencyMs !== undefined) {
    lines.push(
      `${prefix}latency: ${input.latencyMs}ms vs ungated escalate/dispatch`,
    );
  }
  return lines;
}

function escalateDecision(
  reason: string,
  source: EscalateDispatchSource,
  needsCaptain?: number,
  needsCaptainBand?: NoulBand,
  chosen?: { choice: string; confidence: number },
): EscalateDispatchDecision {
  return {
    verdict: "escalate",
    crewmate: ASK_CAPTAIN,
    reason,
    source,
    ...(needsCaptain !== undefined ? { needsCaptain } : {}),
    ...(needsCaptainBand !== undefined ? { needsCaptainBand } : {}),
    ...(chosen !== undefined
      ? {
          chosenCrewmate: chosen.choice,
          crewmateConfidence: chosen.confidence,
        }
      : {}),
    agentMessage: ESCALATE_DISPATCH_ESCALATE_MESSAGE,
  };
}

function pickImplementerCharter(
  charters: readonly CrewmateCharter[],
): CrewmateCharter | undefined {
  const implementerHints = [
    /\bimplement/i,
    /\bcoder\b/i,
    /\bengineer\b/i,
    /\bdeveloper\b/i,
    /\btest\b/i,
    /\bfix\b/i,
    /\bbug\b/i,
  ];
  for (const charter of charters) {
    const haystack = `${charter.id} ${charter.name} ${charter.description ?? ""}`;
    if (implementerHints.some((pattern) => pattern.test(haystack))) {
      return charter;
    }
  }
  return charters[0];
}

function charterCriterion(charter: CrewmateCharter): StructuredChoiceCriterion {
  const description =
    charter.description !== undefined && charter.description.trim() !== ""
      ? charter.description.trim()
      : `Worker charter ${charter.name}.`;
  return {
    what: `Dispatch to ${charter.name}: ${description}`,
    not_for:
      "Architecture-invariant changes, policy trade-offs, or work that needs captain judgment.",
    examples: [
      `Routine work that fits ${charter.name}.`,
      `Typo or test-fix suited to ${charter.name}.`,
    ],
  };
}

function needsCaptainQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions:
      "Does this task need captain/operator judgment (a real decision) rather than routine dispatch to a worker?",
    criteria: {
      true: "Real decision: architecture invariants, non-negotiable policy, ambiguous trade-offs, or missing worker fit.",
      false:
        "Routine dispatch: typo, lint, test-fix, rename, or other implementable work when a matching worker charter is listed.",
    },
  };
}

function crewmateQuestion(
  charters: readonly CrewmateCharter[],
): ChoiceQuestion {
  return {
    type: "choice",
    instructions:
      "Which worker charter should handle this task? Only choose a listed charter id. Prefer ask_captain when the work is a real decision, the charter list is empty, or no listed worker fits. Never invent crewmates.",
    criteria: buildCrewmateCriteria(charters),
  };
}

function sanitizeCrewmateId(raw: string): string | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) {
    return undefined;
  }
  const cleaned = trimmed
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, JEV_DOCUMENT_ID_MAX_CHARS);
  return cleaned.length > 0 ? cleaned : undefined;
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
