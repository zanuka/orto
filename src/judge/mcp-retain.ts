/*
MCP retain guardrail decides whether an agent may call Hindsight retain mid-session.
Harnesses and future MCP proxies call judgeMcpRetain before forwarding retain.
One Jev call asks whether the payload is durable project knowledge
(is_durable_project_knowledge), whether it is session fluff (is_session_fluff),
and which action to take (allow | deny | suggest_seed_instead).

Default deny on fluff or low confidence. Confident allow only when the action
is allow and durability is a confident yes. suggest_seed_instead denies the
MCP retain and tells the agent to use orto seed / store instead. When the
judge is off, or Jev falls back, heuristicDenyMcpRetain still blocks obvious
chat-shaped payloads and allows clear ADR-shaped markdown. Secrets are denied
before any TypeSafe call.
*/

import { noulBand, type NoulBand } from "./relevance.js";
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
  NoulQuestion,
} from "./types.js";

export const MCP_RETAIN_ACTIONS = [
  "allow",
  "deny",
  "suggest_seed_instead",
] as const;

export type McpRetainAction = (typeof MCP_RETAIN_ACTIONS)[number];

export type McpRetainVerdict = McpRetainAction;

export interface McpRetainDecision {
  verdict: McpRetainVerdict;
  reason: string;
  agentMessage: string;
  source: "jev" | "heuristic";
  isDurable?: number;
  isDurableBand?: NoulBand;
  isSessionFluff?: number;
  isSessionFluffBand?: NoulBand;
  chosenAction?: string;
  actionConfidence?: number;
}

export const MCP_RETAIN_DENY_MESSAGE =
  "Do not retain mid-session through MCP. Write durable knowledge into repo docs or ADRs, then run `orto seed` or `orto store`.";

export const MCP_RETAIN_SUGGEST_SEED_MESSAGE =
  "This looks durable, but MCP retain is the wrong path. Save it in the repo and run `orto seed` or `orto store` instead.";

export const MCP_RETAIN_ALLOW_MESSAGE =
  "Retain allowed: payload looks like durable project knowledge.";

export function mcpRetainQuestions(): Record<string, JudgeQuestion> {
  return {
    is_durable_project_knowledge: durableQuestion(),
    is_session_fluff: fluffQuestion(),
    action: actionQuestion(),
  };
}

export function heuristicDenyMcpRetain(text: string): McpRetainDecision {
  if (containsInlineSecret(text)) {
    return {
      verdict: "deny",
      reason: "payload matched a secret pattern",
      agentMessage: MCP_RETAIN_DENY_MESSAGE,
      source: "heuristic",
    };
  }

  if (looksLikeSessionFluff(text)) {
    return {
      verdict: "deny",
      reason: "heuristic session fluff",
      agentMessage: MCP_RETAIN_DENY_MESSAGE,
      source: "heuristic",
    };
  }

  if (looksLikeDurableProjectKnowledge(text)) {
    return {
      verdict: "allow",
      reason: "heuristic durable project knowledge",
      agentMessage: MCP_RETAIN_ALLOW_MESSAGE,
      source: "heuristic",
    };
  }

  return {
    verdict: "deny",
    reason: "heuristic default deny",
    agentMessage: MCP_RETAIN_DENY_MESSAGE,
    source: "heuristic",
  };
}

export function interpretMcpRetain(input: {
  answers: Record<string, JudgeAnswer>;
  confidence: number;
}): McpRetainDecision {
  const durable = readNoul(input.answers.is_durable_project_knowledge);
  const fluff = readNoul(input.answers.is_session_fluff);
  const chosen = readChoice(input.answers.action);
  const durableBand =
    durable === undefined ? undefined : noulBand(durable, input.confidence);
  const fluffBand =
    fluff === undefined ? undefined : noulBand(fluff, input.confidence);
  const actionConfident =
    chosen !== undefined &&
    MCP_RETAIN_ACTIONS.includes(chosen.choice as McpRetainAction) &&
    chosen.confidence + 1e-9 >= input.confidence;

  const base = {
    source: "jev" as const,
    ...(durable !== undefined ? { isDurable: durable } : {}),
    ...(durableBand !== undefined ? { isDurableBand: durableBand } : {}),
    ...(fluff !== undefined ? { isSessionFluff: fluff } : {}),
    ...(fluffBand !== undefined ? { isSessionFluffBand: fluffBand } : {}),
    ...(chosen !== undefined
      ? { chosenAction: chosen.choice, actionConfidence: chosen.confidence }
      : {}),
  };

  if (fluffBand === "yes") {
    return {
      ...base,
      verdict: "deny",
      reason: "session fluff",
      agentMessage: MCP_RETAIN_DENY_MESSAGE,
    };
  }

  if (actionConfident && chosen?.choice === "deny") {
    return {
      ...base,
      verdict: "deny",
      reason: "action deny",
      agentMessage: MCP_RETAIN_DENY_MESSAGE,
    };
  }

  if (actionConfident && chosen?.choice === "suggest_seed_instead") {
    return {
      ...base,
      verdict: "suggest_seed_instead",
      reason: "suggest seed or store instead",
      agentMessage: MCP_RETAIN_SUGGEST_SEED_MESSAGE,
    };
  }

  if (
    actionConfident &&
    chosen?.choice === "allow" &&
    durableBand === "yes" &&
    fluffBand !== "yes"
  ) {
    return {
      ...base,
      verdict: "allow",
      reason: "durable project knowledge",
      agentMessage: MCP_RETAIN_ALLOW_MESSAGE,
    };
  }

  return {
    ...base,
    verdict: "deny",
    reason:
      actionConfident && chosen?.choice === "allow"
        ? "allow without confident durability"
        : `MCP retain below ${input.confidence.toFixed(2)}; default deny`,
    agentMessage: MCP_RETAIN_DENY_MESSAGE,
  };
}

export async function judgeMcpRetain(input: {
  text: string;
  judge?: Judge;
  confidence: number;
}): Promise<McpRetainDecision> {
  if (input.judge === undefined || input.judge.id === "off") {
    return heuristicDenyMcpRetain(input.text);
  }

  if (containsInlineSecret(input.text)) {
    return {
      verdict: "deny",
      reason: "payload matched a secret pattern",
      agentMessage: MCP_RETAIN_DENY_MESSAGE,
      source: "heuristic",
    };
  }

  if (input.judge.id !== "jev") {
    return heuristicDenyMcpRetain(input.text);
  }

  const state = {
    type: "mcp_retain",
    text: input.text.slice(0, JEV_SECTION_MAX_CHARS),
  };

  try {
    assertJevStateSendable(state);
  } catch {
    return heuristicDenyMcpRetain(input.text);
  }

  const result = await input.judge.evaluate({
    state,
    questions: mcpRetainQuestions(),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    return heuristicDenyMcpRetain(input.text);
  }

  return interpretMcpRetain({
    answers: result.answers,
    confidence: input.confidence,
  });
}

export function formatMcpRetainLines(input: {
  decision: McpRetainDecision;
  dryRun?: boolean;
}): string[] {
  const prefix = input.dryRun === true ? "[dry-run] " : "";
  const lines = [
    `${prefix}MCP retain: ${input.decision.verdict} (${input.decision.source})`,
    `${prefix}reason: ${input.decision.reason}`,
    `${prefix}agent: ${input.decision.agentMessage}`,
  ];
  if (
    input.decision.isDurable !== undefined &&
    input.decision.isDurableBand !== undefined
  ) {
    lines.push(
      `${prefix}is_durable_project_knowledge: ${input.decision.isDurable.toFixed(2)} ${input.decision.isDurableBand}`,
    );
  }
  if (
    input.decision.isSessionFluff !== undefined &&
    input.decision.isSessionFluffBand !== undefined
  ) {
    lines.push(
      `${prefix}is_session_fluff: ${input.decision.isSessionFluff.toFixed(2)} ${input.decision.isSessionFluffBand}`,
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
  return lines;
}

export function looksLikeSessionFluff(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return true;
  }
  if (trimmed.length < 40 && !/^#+\s/m.test(trimmed)) {
    return true;
  }

  const fluffSignals = [
    /\bi just tried\b/i,
    /\bhere'?s (the|a) (diff|patch|output|stack trace)\b/i,
    /\bas an ai\b/i,
    /\blet me know if\b/i,
    /\bcan you (help|fix|check|debug)\b/i,
    /\bchat transcript\b/i,
    /\b^(user|human|assistant)\s*:/im,
    /\bokay,? (so|i'll|i will)\b/i,
    /\bworking on it\b/i,
    /\btry this instead\b/i,
  ];
  let hits = 0;
  for (const pattern of fluffSignals) {
    if (pattern.test(trimmed)) {
      hits += 1;
    }
  }
  if (hits >= 1 && !looksLikeDurableProjectKnowledge(trimmed)) {
    return true;
  }
  if (/(?:^|\n)(user|human|assistant)\s*:/i.test(trimmed)) {
    const turns = trimmed.match(/(?:^|\n)(?:user|human|assistant)\s*:/gi);
    if ((turns?.length ?? 0) >= 2) {
      return true;
    }
  }
  return false;
}

export function looksLikeDurableProjectKnowledge(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 80) {
    return false;
  }
  const durableSignals = [
    /^#+\s*ADR[\s\-:]/im,
    /^#+\s*.*\bdecision\b/im,
    /^##\s+decision\b/im,
    /^##\s+context\b/im,
    /^##\s+consequences\b/im,
    /\barchitecture decision\b/i,
    /\bwe (decided|chose|selected)\b/i,
    /\bnon-negotiable\b/i,
    /\binvariant\b/i,
    /\bcoding standards?\b/i,
    /\bmodule boundaries?\b/i,
  ];
  let hits = 0;
  for (const pattern of durableSignals) {
    if (pattern.test(trimmed)) {
      hits += 1;
    }
  }
  return hits >= 2 || (hits >= 1 && /^#+\s/m.test(trimmed) && trimmed.length > 200);
}

function durableQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions:
      "Is this durable project knowledge that belongs in the company bank (decision, invariant, architecture, standard)?",
    criteria: {
      true: "An ADR, architecture note, coding standard, domain invariant, or stable API/ops fact.",
      false: "Chat, a one-off debug dump, a transient diff, or session commentary.",
    },
  };
}

function fluffQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions:
      "Is this session fluff: chat, a diff dump, scratch notes, or 'I just tried X' commentary?",
    criteria: {
      true: "Conversational agent/user turns, temporary debugging, or mid-session scratch that should not enter the bank.",
      false: "Stable project documentation or a decision record.",
    },
  };
}

function actionQuestion(): ChoiceQuestion {
  return {
    type: "choice",
    instructions: "What should Orto do with this MCP retain attempt?",
    criteria: {
      allow: {
        what: "Allow MCP retain because the payload is durable project knowledge.",
        not_for: "Chat, diffs, secrets, or anything that should go through seed/store.",
        examples: [
          "A short ADR body the operator explicitly asked to retain.",
          "A coding standard paragraph already reviewed for the bank.",
        ],
      },
      deny: {
        what: "Deny MCP retain. The payload is fluff, unsafe, or not bank-worthy.",
        not_for: "Clear durable docs that should be seeded from disk instead.",
        examples: [
          "I just tried X and got this stack trace.",
          "User/assistant chat transcript.",
        ],
      },
      suggest_seed_instead: {
        what: "Deny MCP retain, but tell the agent to persist the claim via orto seed or store.",
        not_for: "Obvious fluff that should simply be denied.",
        examples: [
          "A solid architecture note pasted mid-session that belongs in docs/ first.",
          "A decision write-up that should become an ADR on disk.",
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
  if (
    answer === undefined ||
    answer.type !== "choice" ||
    typeof answer.choice !== "string" ||
    !Number.isFinite(answer.confidence)
  ) {
    return undefined;
  }
  return { choice: answer.choice, confidence: answer.confidence };
}
