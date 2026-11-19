/*
Multi-bank fact routing chooses which configured company-brain bank a
section belongs in. Choice bank is built only from the provided bank ids,
plus current and ask. A single configured bank never prompts: seed keeps
using in_scope (JEV-4). Two or more banks can opt in with routeBanks:true
or ORTO_JEV_BANK_ROUTE=1.

A confident other-bank choice sets seedCurrent false so the caller does not
retain that section into the current bank (a design-token doc does not seed
the billing bank). Ask means do not guess. This module does not open a
second retain client. Multi-bank seed/store stays a later Phase 8 CLI.
When the judge is off, or Jev falls back, heuristicBankRoute still matches
section text to bank id, name, and description. Never invent bank ids.
*/

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
  StructuredChoiceCriterion,
} from "./types.js";

export const BANK_ROUTE_CURRENT = "current" as const;
export const BANK_ROUTE_ASK = "ask" as const;

export const BANK_ROUTE_ENV = "ORTO_JEV_BANK_ROUTE";
export const BANK_ROUTE_ENV_ALIASES = [
  "NOCCIOLO_JEV_BANK_ROUTE",
] as const;
export const BANK_ROUTE_DEFAULT_CONFIDENCE = 0.8;
export const BANK_ROUTE_TEXT_MAX_CHARS = JEV_SECTION_MAX_CHARS;
export const BANK_ROUTE_MAX_BANKS = 24;

export type BankRouteChoice = typeof BANK_ROUTE_CURRENT | typeof BANK_ROUTE_ASK | string;

export type BankRouteVerdict = "route" | "ask" | "unset";
export type BankRouteSource = "jev" | "heuristic" | "pass_through";

export interface CompanyBankRef {
  id: string;
  name: string;
  description?: string;
}

export interface BankRouteDecision {
  verdict: BankRouteVerdict;
  bank: string;
  seedCurrent: boolean;
  reason: string;
  source: BankRouteSource;
  currentBankId?: string;
  chosenBank?: string;
  bankConfidence?: number;
  agentMessage: string;
}

export interface BankRouteResult {
  decision: BankRouteDecision;
  latencyMs: number;
  enabled: boolean;
  prompted: boolean;
}

export const BANK_ROUTE_CURRENT_MESSAGE =
  "Route to the current bank. Single-bank in_scope still applies when this gate is off.";

export const BANK_ROUTE_OTHER_MESSAGE =
  "Do not seed the current bank. Queue this section for the named bank. Multi-bank retain stays on the later seed CLI.";

export const BANK_ROUTE_ASK_MESSAGE =
  "Ask the operator which bank should receive this section. Do not guess.";

export const BANK_ROUTE_UNSET_MESSAGE =
  "Bank routing is off. Single-bank projects keep using in_scope and never see this prompt.";

export function parseBankRouteEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw =
    env[BANK_ROUTE_ENV] ??
    BANK_ROUTE_ENV_ALIASES.map((key) => env[key]).find(
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

export function resolveBankRouteEnabled(input: {
  routeBanks?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (input.routeBanks === true) {
    return true;
  }
  if (input.routeBanks === false) {
    return false;
  }
  return parseBankRouteEnabled(input.env);
}

export function normalizeCompanyBanks(
  banks: readonly CompanyBankRef[] | undefined,
): CompanyBankRef[] {
  if (banks === undefined || banks.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const out: CompanyBankRef[] = [];
  for (const bank of banks) {
    const id = sanitizeBankId(bank.id);
    if (
      id === undefined ||
      id === BANK_ROUTE_CURRENT ||
      id === BANK_ROUTE_ASK ||
      seen.has(id)
    ) {
      continue;
    }
    const name = bank.name.trim();
    if (name.length === 0) {
      continue;
    }
    seen.add(id);
    out.push({
      id,
      name: name.slice(0, JEV_HEADING_MAX_CHARS),
      ...(bank.description !== undefined && bank.description.trim() !== ""
        ? {
            description: bank.description.trim().slice(0, JEV_SECTION_MAX_CHARS),
          }
        : {}),
    });
    if (out.length >= BANK_ROUTE_MAX_BANKS) {
      break;
    }
  }
  return out;
}

export function bankRouteApplies(
  banks: readonly CompanyBankRef[] | undefined,
): boolean {
  return normalizeCompanyBanks(banks).length >= 2;
}

export function buildBankRouteCriteria(
  banks: readonly CompanyBankRef[],
): Record<string, ChoiceCriterion> {
  const criteria: Record<string, ChoiceCriterion> = {
    [BANK_ROUTE_CURRENT]: {
      what: "Keep this section on the bank seed would use today.",
      not_for: "A section that clearly belongs to a different configured bank.",
      examples: [
        "An ADR for the current service.",
        "Coding standards for this repo's own bank.",
      ],
    },
    [BANK_ROUTE_ASK]: {
      what: "Ask the operator. Do not guess a bank.",
      not_for: "A clear match to one configured bank.",
      examples: [
        "A section that mentions two banks equally.",
        "Ambiguous notes with no bank-specific terms.",
      ],
    },
  };
  for (const bank of normalizeCompanyBanks(banks)) {
    criteria[bank.id] = bankCriterion(bank);
  }
  return criteria;
}

export function bankRouteQuestions(
  banks: readonly CompanyBankRef[] = [],
): Record<string, JudgeQuestion> {
  if (!bankRouteApplies(banks)) {
    return {};
  }
  return {
    bank: bankQuestion(banks),
  };
}

export function passThroughBankRoute(input?: {
  currentBankId?: string;
  reason?: string;
}): BankRouteDecision {
  return {
    verdict: "unset",
    bank: BANK_ROUTE_CURRENT,
    seedCurrent: true,
    reason: input?.reason ?? "bank routing off; single-bank in_scope",
    source: "pass_through",
    ...(input?.currentBankId !== undefined
      ? { currentBankId: input.currentBankId }
      : {}),
    agentMessage: BANK_ROUTE_UNSET_MESSAGE,
  };
}

export function heuristicBankRoute(input: {
  text: string;
  path?: string;
  banks?: readonly CompanyBankRef[];
  currentBankId?: string;
}): BankRouteDecision {
  const banks = normalizeCompanyBanks(input.banks);
  const currentBankId = sanitizeBankId(input.currentBankId ?? "");
  if (banks.length < 2) {
    return passThroughBankRoute({
      ...(currentBankId !== undefined ? { currentBankId } : {}),
      reason: "single-bank project; keep in_scope, do not prompt",
    });
  }

  const trimmed = `${input.path ?? ""}\n${input.text}`.trim();
  if (containsInlineSecret(input.text)) {
    return askDecision(
      "secret pattern in section; ask",
      "heuristic",
      currentBankId,
    );
  }
  if (input.text.trim().length === 0) {
    return askDecision("empty section", "heuristic", currentBankId);
  }

  const scored = banks
    .map((bank) => ({ bank, score: scoreBank(trimmed, bank) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1];
  if (top === undefined || top.score === 0 || (second !== undefined && second.score === top.score)) {
    return askDecision(
      "heuristic no unique bank match",
      "heuristic",
      currentBankId,
    );
  }

  if (currentBankId !== undefined && top.bank.id === currentBankId) {
    return {
      verdict: "route",
      bank: BANK_ROUTE_CURRENT,
      seedCurrent: true,
      reason: `heuristic match ${top.bank.id}; current bank`,
      source: "heuristic",
      currentBankId,
      agentMessage: BANK_ROUTE_CURRENT_MESSAGE,
    };
  }

  return {
    verdict: "route",
    bank: top.bank.id,
    seedCurrent: false,
    reason: `heuristic match ${top.bank.id}; do not seed the current bank`,
    source: "heuristic",
    ...(currentBankId !== undefined ? { currentBankId } : {}),
    agentMessage: BANK_ROUTE_OTHER_MESSAGE,
  };
}

export function interpretBankRoute(input: {
  answers: Record<string, JudgeAnswer>;
  confidence: number;
  banks?: readonly CompanyBankRef[];
  currentBankId?: string;
}): BankRouteDecision {
  const banks = normalizeCompanyBanks(input.banks);
  const currentBankId = sanitizeBankId(input.currentBankId ?? "");
  const allowed = new Set<string>([
    BANK_ROUTE_CURRENT,
    BANK_ROUTE_ASK,
    ...banks.map((bank) => bank.id),
  ]);
  const chosen = readChoice(input.answers.bank);
  const confident =
    chosen !== undefined &&
    allowed.has(chosen.choice) &&
    chosen.confidence + 1e-9 >= input.confidence;

  if (!confident || chosen === undefined) {
    return askDecision(
      chosen === undefined
        ? "missing or invalid bank choice"
        : `bank below ${input.confidence.toFixed(2)}; ask`,
      "jev",
      currentBankId,
      chosen,
    );
  }

  if (chosen.choice === BANK_ROUTE_ASK) {
    return askDecision(
      "confident bank=ask",
      "jev",
      currentBankId,
      chosen,
    );
  }

  if (
    chosen.choice === BANK_ROUTE_CURRENT ||
    (currentBankId !== undefined && chosen.choice === currentBankId)
  ) {
    return {
      verdict: "route",
      bank: chosen.choice === currentBankId ? currentBankId : BANK_ROUTE_CURRENT,
      seedCurrent: true,
      reason: `confident bank=${chosen.choice}`,
      source: "jev",
      ...(currentBankId !== undefined ? { currentBankId } : {}),
      chosenBank: chosen.choice,
      bankConfidence: chosen.confidence,
      agentMessage: BANK_ROUTE_CURRENT_MESSAGE,
    };
  }

  return {
    verdict: "route",
    bank: chosen.choice,
    seedCurrent: false,
    reason: `confident bank=${chosen.choice}; do not seed the current bank`,
    source: "jev",
    ...(currentBankId !== undefined ? { currentBankId } : {}),
    chosenBank: chosen.choice,
    bankConfidence: chosen.confidence,
    agentMessage: BANK_ROUTE_OTHER_MESSAGE,
  };
}

export async function judgeBankRoute(input: {
  text: string;
  path?: string;
  banks?: readonly CompanyBankRef[];
  currentBankId?: string;
  judge?: Judge;
  confidence: number;
  routeBanks?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<BankRouteResult> {
  const started = Date.now();
  const banks = normalizeCompanyBanks(input.banks);
  const currentBankId = sanitizeBankId(input.currentBankId ?? "");
  const enabled = resolveBankRouteEnabled({
    ...(input.routeBanks !== undefined ? { routeBanks: input.routeBanks } : {}),
    ...(input.env !== undefined ? { env: input.env } : {}),
  });

  if (!bankRouteApplies(banks)) {
    return {
      decision: passThroughBankRoute({
        ...(currentBankId !== undefined ? { currentBankId } : {}),
        reason: "single-bank project; keep in_scope, do not prompt",
      }),
      latencyMs: Date.now() - started,
      enabled,
      prompted: false,
    };
  }

  if (!enabled) {
    return {
      decision: passThroughBankRoute({
        ...(currentBankId !== undefined ? { currentBankId } : {}),
      }),
      latencyMs: Date.now() - started,
      enabled: false,
      prompted: false,
    };
  }

  const heuristicInput = {
    text: input.text,
    banks,
    ...(input.path !== undefined ? { path: input.path } : {}),
    ...(currentBankId !== undefined ? { currentBankId } : {}),
  };

  if (containsInlineSecret(input.text)) {
    return {
      decision: heuristicBankRoute(heuristicInput),
      latencyMs: Date.now() - started,
      enabled: true,
      prompted: true,
    };
  }

  if (
    input.judge === undefined ||
    input.judge.id === "off" ||
    input.judge.id !== "jev"
  ) {
    return {
      decision: heuristicBankRoute(heuristicInput),
      latencyMs: Date.now() - started,
      enabled: true,
      prompted: true,
    };
  }

  const state = {
    type: "bank_route",
    ...(input.path !== undefined
      ? { path: input.path.slice(0, JEV_DOCUMENT_ID_MAX_CHARS) }
      : {}),
    ...(currentBankId !== undefined ? { current_bank_id: currentBankId } : {}),
    text: input.text.slice(0, BANK_ROUTE_TEXT_MAX_CHARS),
    banks: banks.map((bank) => ({
      id: bank.id,
      name: bank.name.slice(0, JEV_HEADING_MAX_CHARS),
      ...(bank.description !== undefined
        ? { description: bank.description.slice(0, JEV_SECTION_MAX_CHARS) }
        : {}),
    })),
  };

  try {
    assertJevStateSendable(state);
  } catch {
    return {
      decision: heuristicBankRoute(heuristicInput),
      latencyMs: Date.now() - started,
      enabled: true,
      prompted: true,
    };
  }

  const result = await input.judge.evaluate({
    state,
    questions: bankRouteQuestions(banks),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    return {
      decision: heuristicBankRoute(heuristicInput),
      latencyMs: Date.now() - started,
      enabled: true,
      prompted: true,
    };
  }

  return {
    decision: interpretBankRoute({
      answers: result.answers,
      confidence: input.confidence,
      banks,
      ...(currentBankId !== undefined ? { currentBankId } : {}),
    }),
    latencyMs: Date.now() - started,
    enabled: true,
    prompted: true,
  };
}

export function formatBankRouteLines(input: {
  decision: BankRouteDecision;
  latencyMs?: number;
  dryRun?: boolean;
}): string[] {
  const prefix = input.dryRun === true ? "[dry-run] " : "";
  const lines = [
    `${prefix}Bank route: ${input.decision.verdict} → ${input.decision.bank} (${input.decision.source})`,
    `${prefix}seed current: ${input.decision.seedCurrent ? "yes" : "no"}`,
    `${prefix}reason: ${input.decision.reason}`,
    `${prefix}agent: ${input.decision.agentMessage}`,
  ];
  if (
    input.decision.chosenBank !== undefined &&
    input.decision.bankConfidence !== undefined
  ) {
    lines.push(
      `${prefix}bank: ${input.decision.chosenBank} confidence=${input.decision.bankConfidence.toFixed(2)}`,
    );
  }
  if (input.latencyMs !== undefined) {
    lines.push(`${prefix}latency: ${input.latencyMs}ms vs ungated bank route`);
  }
  return lines;
}

function askDecision(
  reason: string,
  source: BankRouteSource,
  currentBankId: string | undefined,
  chosen?: { choice: string; confidence: number },
): BankRouteDecision {
  return {
    verdict: "ask",
    bank: BANK_ROUTE_ASK,
    seedCurrent: false,
    reason,
    source,
    ...(currentBankId !== undefined ? { currentBankId } : {}),
    ...(chosen !== undefined
      ? { chosenBank: chosen.choice, bankConfidence: chosen.confidence }
      : {}),
    agentMessage: BANK_ROUTE_ASK_MESSAGE,
  };
}

function scoreBank(text: string, bank: CompanyBankRef): number {
  const body = text.toLowerCase();
  const phrases = [bank.id, bank.name, bank.description ?? ""]
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 5);
  const unique = [...new Set(phrases)];
  let score = 0;
  for (const token of unique) {
    if (body.includes(token)) {
      score += token.length >= 8 ? 2 : 1;
    }
  }
  const compactId = bank.id.replace(/-/g, "");
  if (compactId.length >= 5 && body.replace(/[^a-z0-9]+/g, "").includes(compactId)) {
    score += 2;
  }
  return score;
}

function bankCriterion(bank: CompanyBankRef): StructuredChoiceCriterion {
  const description =
    bank.description !== undefined && bank.description.trim() !== ""
      ? bank.description.trim()
      : `Company-brain bank ${bank.name}.`;
  return {
    what: `Route this section to ${bank.name} (${bank.id}): ${description}`,
    not_for: "Sections that belong to a different configured bank, or the current bank.",
    examples: [
      `A durable doc whose terms match ${bank.name}.`,
      `Do not place another bank's domain into ${bank.id}.`,
    ],
  };
}

function bankQuestion(banks: readonly CompanyBankRef[]): ChoiceQuestion {
  return {
    type: "choice",
    instructions:
      "Which configured company-brain bank should receive this section? Choose only a listed bank id, current, or ask. Do not invent banks. Prefer ask when two banks match. A design-system section must not be routed to a billing bank.",
    criteria: buildBankRouteCriteria(banks),
  };
}

function sanitizeBankId(raw: string): string | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) {
    return undefined;
  }
  const cleaned = trimmed
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, JEV_DOCUMENT_ID_MAX_CHARS);
  return cleaned.length > 0 ? cleaned : undefined;
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
