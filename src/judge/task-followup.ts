/*
Task follow-up chooses whether durable knowledge should be queued into the
project bank after agent work: retain_to_bank, pr_only, or both. Any harness
(Claude Code, Codex, Cursor, Pi, Firstmate, custom) can call
judgeTaskFollowup after a PR, merge, or task summary.

Default path is pass-through: no TypeSafe call, verdict unset. Opt in with
followup:true or ORTO_JEV_TASK_FOLLOWUP=1 (Firstmate/Nocciolo aliases). One
Choice followup scores the description. Confident retain_to_bank or both
means queue orto store / seed (not MCP retain; see JEV-22). Pure bugfix
PRs prefer pr_only. Low confidence escalates to the operator. When the judge
is off, or Jev falls back, heuristicTaskFollowup still separates ADR merges
from bugfixes. This module does not host or proxy MCP and does not embed
TypeSafe keys.
*/

import {
  assertJevStateSendable,
  containsInlineSecret,
  JEV_SECTION_MAX_CHARS,
} from "./state.js";
import type {
  ChoiceQuestion,
  Judge,
  JudgeAnswer,
  JudgeQuestion,
} from "./types.js";

export const TASK_FOLLOWUP_BINS = [
  "retain_to_bank",
  "pr_only",
  "both",
] as const;
export type TaskFollowupBin = (typeof TASK_FOLLOWUP_BINS)[number];

export type TaskFollowupVerdict = TaskFollowupBin | "escalate" | "unset";
export type TaskFollowupSource = "jev" | "heuristic" | "pass_through";

export const TASK_FOLLOWUP_ENV = "ORTO_JEV_TASK_FOLLOWUP";
export const TASK_FOLLOWUP_ENV_ALIASES = [
  "ORTO_JEV_FIRSTMATE_FOLLOWUP",
  "NOCCIOLO_JEV_TASK_FOLLOWUP",
  "NOCCIOLO_JEV_FIRSTMATE_FOLLOWUP",
] as const;
export const TASK_FOLLOWUP_DEFAULT_CONFIDENCE = 0.8;
export const TASK_FOLLOWUP_DESCRIPTION_MAX_CHARS = JEV_SECTION_MAX_CHARS;

export interface TaskFollowupDecision {
  verdict: TaskFollowupVerdict;
  route?: TaskFollowupBin;
  reason: string;
  source: TaskFollowupSource;
  chosenFollowup?: string;
  followupConfidence?: number;
  agentMessage: string;
}

export interface TaskFollowupResult {
  decision: TaskFollowupDecision;
  latencyMs: number;
  enabled: boolean;
}

export const TASK_FOLLOWUP_RETAIN_MESSAGE =
  "Queue `orto store` or `orto seed` in the durable clone. Do not MCP-retain mid-session.";

export const TASK_FOLLOWUP_PR_ONLY_MESSAGE =
  "Ship the PR only. No bank retain queue unless durable docs also changed.";

export const TASK_FOLLOWUP_BOTH_MESSAGE =
  "Ship the PR and queue `orto store` or `orto seed` for durable doc/ADR changes. Do not MCP-retain.";

export const TASK_FOLLOWUP_ESCALATE_MESSAGE =
  "Escalate to the operator before queuing bank retain or treating this as PR-only.";

export const TASK_FOLLOWUP_UNSET_MESSAGE =
  "Task follow-up gate is off; no retain/PR routing policy applied.";

export function parseTaskFollowupEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw =
    env[TASK_FOLLOWUP_ENV] ??
    TASK_FOLLOWUP_ENV_ALIASES.map((key) => env[key]).find(
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

export function resolveTaskFollowupEnabled(input: {
  followup?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (input.followup === true) {
    return true;
  }
  if (input.followup === false) {
    return false;
  }
  return parseTaskFollowupEnabled(input.env);
}

export function taskFollowupQuestions(): Record<string, JudgeQuestion> {
  return {
    followup: followupQuestion(),
  };
}

export function passThroughTaskFollowup(): TaskFollowupDecision {
  return {
    verdict: "unset",
    reason: "task follow-up gate off",
    source: "pass_through",
    agentMessage: TASK_FOLLOWUP_UNSET_MESSAGE,
  };
}

export function heuristicTaskFollowup(description: string): TaskFollowupDecision {
  const trimmed = description.trim();
  if (trimmed.length === 0) {
    return {
      verdict: "escalate",
      reason: "empty task description",
      source: "heuristic",
      agentMessage: TASK_FOLLOWUP_ESCALATE_MESSAGE,
    };
  }

  if (containsInlineSecret(trimmed)) {
    return {
      verdict: "escalate",
      reason: "secret pattern in description; escalate",
      source: "heuristic",
      agentMessage: TASK_FOLLOWUP_ESCALATE_MESSAGE,
    };
  }

  const knowledgeSignals = [
    /\bADR[\s\-:]?\d*\b/i,
    /\barchitecture decision\b/i,
    /\bmerged?\b.*\bADR\b/i,
    /\bstandards?\b/i,
    /\bcoding standards?\b/i,
    /\bplaybook\b/i,
    /\bnon-negotiable\b/i,
    /\binvariant\b/i,
    /\bdocs\/adr\b/i,
    /\bAGENTS\.md\b/i,
    /\bcompany brain\b/i,
    /\bretain\b/i,
    /\bseed\b/i,
    /\bhindsight bank\b/i,
  ];
  const bugfixSignals = [
    /\bbug\s*fix\b/i,
    /\bfix(es|ed)?\b.*\b(bug|crash|regression|null|npe|typo)\b/i,
    /\bnull pointer\b/i,
    /\bcrash\b/i,
    /\bregression\b/i,
    /\bhotfix\b/i,
    /\bpatch\b/i,
  ];
  const codePrSignals = [
    /\bpull request\b/i,
    /\b\bPR\b/,
    /\bmerge(d)?\b/i,
    /\bimplement\b/i,
    /\brefactor\b/i,
  ];

  let knowledgeHits = 0;
  for (const pattern of knowledgeSignals) {
    if (pattern.test(trimmed)) {
      knowledgeHits += 1;
    }
  }
  let bugHits = 0;
  for (const pattern of bugfixSignals) {
    if (pattern.test(trimmed)) {
      bugHits += 1;
    }
  }
  let codeHits = 0;
  for (const pattern of codePrSignals) {
    if (pattern.test(trimmed)) {
      codeHits += 1;
    }
  }

  if (knowledgeHits >= 1 && (codeHits >= 1 || bugHits >= 1)) {
    return {
      verdict: "both",
      route: "both",
      reason: "heuristic ADR/standards change with code or PR signals",
      source: "heuristic",
      agentMessage: TASK_FOLLOWUP_BOTH_MESSAGE,
    };
  }
  if (knowledgeHits >= 1) {
    return {
      verdict: "retain_to_bank",
      route: "retain_to_bank",
      reason: "heuristic durable knowledge change",
      source: "heuristic",
      agentMessage: TASK_FOLLOWUP_RETAIN_MESSAGE,
    };
  }
  if (bugHits >= 1 && knowledgeHits === 0) {
    return {
      verdict: "pr_only",
      route: "pr_only",
      reason: "heuristic pure bugfix / PR-only work",
      source: "heuristic",
      agentMessage: TASK_FOLLOWUP_PR_ONLY_MESSAGE,
    };
  }
  if (trimmed.length < 24) {
    return {
      verdict: "escalate",
      reason: "short ambiguous description",
      source: "heuristic",
      agentMessage: TASK_FOLLOWUP_ESCALATE_MESSAGE,
    };
  }
  return {
    verdict: "escalate",
    reason: "heuristic uncertain; escalate to operator",
    source: "heuristic",
    agentMessage: TASK_FOLLOWUP_ESCALATE_MESSAGE,
  };
}

export function interpretTaskFollowup(input: {
  answers: Record<string, JudgeAnswer>;
  confidence: number;
  description: string;
}): TaskFollowupDecision {
  const chosen = readChoice(input.answers.followup);
  const actionConfident =
    chosen !== undefined &&
    TASK_FOLLOWUP_BINS.includes(chosen.choice as TaskFollowupBin) &&
    chosen.confidence + 1e-9 >= input.confidence;

  if (!actionConfident) {
    return {
      verdict: "escalate",
      reason: `followup below ${input.confidence.toFixed(2)}; escalate`,
      source: "jev",
      agentMessage: TASK_FOLLOWUP_ESCALATE_MESSAGE,
      ...(chosen !== undefined
        ? {
            chosenFollowup: chosen.choice,
            followupConfidence: chosen.confidence,
          }
        : {}),
    };
  }

  const route = chosen.choice as TaskFollowupBin;
  return {
    verdict: route,
    route,
    reason: `confident followup=${route}`,
    source: "jev",
    chosenFollowup: chosen.choice,
    followupConfidence: chosen.confidence,
    agentMessage: agentMessageFor(route),
  };
}

export async function judgeTaskFollowup(input: {
  description: string;
  judge?: Judge;
  confidence: number;
  followup?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<TaskFollowupResult> {
  const started = Date.now();
  const enabled = resolveTaskFollowupEnabled({
    ...(input.followup !== undefined ? { followup: input.followup } : {}),
    ...(input.env !== undefined ? { env: input.env } : {}),
  });

  if (!enabled) {
    return {
      decision: passThroughTaskFollowup(),
      latencyMs: Date.now() - started,
      enabled: false,
    };
  }

  if (containsInlineSecret(input.description)) {
    return {
      decision: heuristicTaskFollowup(input.description),
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
      decision: heuristicTaskFollowup(input.description),
      latencyMs: Date.now() - started,
      enabled: true,
    };
  }

  const state = {
    type: "task_followup",
    description: input.description.slice(0, TASK_FOLLOWUP_DESCRIPTION_MAX_CHARS),
  };

  try {
    assertJevStateSendable(state);
  } catch {
    return {
      decision: heuristicTaskFollowup(input.description),
      latencyMs: Date.now() - started,
      enabled: true,
    };
  }

  const result = await input.judge.evaluate({
    state,
    questions: taskFollowupQuestions(),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    return {
      decision: heuristicTaskFollowup(input.description),
      latencyMs: Date.now() - started,
      enabled: true,
    };
  }

  return {
    decision: interpretTaskFollowup({
      answers: result.answers,
      confidence: input.confidence,
      description: input.description,
    }),
    latencyMs: Date.now() - started,
    enabled: true,
  };
}

export function formatTaskFollowupLines(input: {
  decision: TaskFollowupDecision;
  latencyMs?: number;
  dryRun?: boolean;
}): string[] {
  const prefix = input.dryRun === true ? "[dry-run] " : "";
  const lines = [
    `${prefix}Task followup: ${input.decision.verdict} (${input.decision.source})`,
    `${prefix}reason: ${input.decision.reason}`,
    `${prefix}agent: ${input.decision.agentMessage}`,
  ];
  if (
    input.decision.chosenFollowup !== undefined &&
    input.decision.followupConfidence !== undefined
  ) {
    lines.push(
      `${prefix}followup: ${input.decision.chosenFollowup} confidence=${input.decision.followupConfidence.toFixed(2)}`,
    );
  }
  if (input.latencyMs !== undefined) {
    lines.push(`${prefix}latency: ${input.latencyMs}ms vs ungated followup`);
  }
  return lines;
}

function agentMessageFor(route: TaskFollowupBin): string {
  if (route === "retain_to_bank") {
    return TASK_FOLLOWUP_RETAIN_MESSAGE;
  }
  if (route === "both") {
    return TASK_FOLLOWUP_BOTH_MESSAGE;
  }
  return TASK_FOLLOWUP_PR_ONLY_MESSAGE;
}

function followupQuestion(): ChoiceQuestion {
  return {
    type: "choice",
    instructions:
      "After this agent task or PR, what follow-up should the harness queue? Prefer retain_to_bank or both when durable docs/ADRs/standards changed. Prefer pr_only for pure bugfixes with no bank-worthy knowledge change. Do not MCP-retain; queue orto store or orto seed instead.",
    criteria: {
      retain_to_bank: {
        what: "Durable project knowledge changed; queue orto store or orto seed so the bank catches up.",
        not_for: "Pure code bugfixes with no durable doc or ADR change.",
        examples: [
          "Merged ADR-12: keep the bank local-first.",
          "Updated coding standards in docs/standards.md.",
        ],
      },
      pr_only: {
        what: "Ship the pull request only; no bank retain queue.",
        not_for: "ADR merges, standards updates, or other durable knowledge changes.",
        examples: [
          "Fix null pointer in parser (bugfix).",
          "Hotfix crash on empty input.",
        ],
      },
      both: {
        what: "Ship the PR and queue orto store or orto seed for durable knowledge that also changed.",
        not_for: "Code-only fixes or knowledge-only doc updates with no PR.",
        examples: [
          "Implement feature X per ADR-12 and merge the ADR.",
          "Refactor module boundaries and update architecture docs.",
        ],
      },
    },
  };
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
