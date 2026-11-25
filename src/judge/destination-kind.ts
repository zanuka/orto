/*
Destination-kind routing chooses the kind of memory a section belongs in,
then the provider that kind uses. The choice is the kind, not a vendor:

- institutional → Hindsight (always available, the default)
- personal_preference → Mem0, only when that provider is configured
- temporal_episode → Graphiti, only when that provider is configured

An unconfigured destination falls back to Hindsight and sets a warning.
It does not throw. Mem0 and Graphiti adapters are not wired into seed yet.
This helper only decides the route.

judgeBankRoute (JEV-32) already chooses which Hindsight bank. Call it only
when the resolved provider is hindsight. A Mem0 or Graphiti route must not
also be seeded into a Hindsight bank.

Default path is pass-through: institutional / Hindsight, no TypeSafe call.
Opt in with destinationKind:true or ORTO_JEV_DESTINATION_KIND=1.
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

export const DESTINATION_KINDS = [
  "institutional",
  "personal_preference",
  "temporal_episode",
] as const;

export type DestinationKind = (typeof DESTINATION_KINDS)[number];

export const DESTINATION_PROVIDERS = ["hindsight", "mem0", "graphiti"] as const;
export type DestinationProviderId = (typeof DESTINATION_PROVIDERS)[number];

export const DESTINATION_KIND_ENV = "ORTO_JEV_DESTINATION_KIND";
export const DESTINATION_KIND_ENV_ALIASES = [
  "NOCCIOLO_JEV_DESTINATION_KIND",
] as const;
export const DESTINATION_KIND_DEFAULT_CONFIDENCE = 0.8;
export const DESTINATION_KIND_TEXT_MAX_CHARS = JEV_SECTION_MAX_CHARS;

export type DestinationKindSource = "jev" | "heuristic" | "pass_through";

export interface DestinationKindDecision {
  kind: DestinationKind;
  provider: DestinationProviderId;
  requestedProvider: DestinationProviderId;
  fellBackToHindsight: boolean;
  warning?: string;
  reason: string;
  source: DestinationKindSource;
  chosenKind?: string;
  kindConfidence?: number;
  /** When false, do not also run judgeBankRoute for this section. */
  routeHindsightBank: boolean;
  agentMessage: string;
}

export interface DestinationKindResult {
  decision: DestinationKindDecision;
  latencyMs: number;
  enabled: boolean;
}

export const DESTINATION_KIND_HINDSIGHT_MESSAGE =
  "Institutional knowledge stays on Hindsight. If two or more banks are configured, judgeBankRoute may still choose which bank.";

export const DESTINATION_KIND_MEM0_MESSAGE =
  "Personal preference routes to Mem0. Do not also seed this section into a Hindsight bank.";

export const DESTINATION_KIND_GRAPHITI_MESSAGE =
  "Temporal episode routes to Graphiti seed. Do not also seed this section into a Hindsight bank.";

export const DESTINATION_KIND_UNSET_MESSAGE =
  "Destination-kind routing is off. Seed stays on Hindsight.";

export function parseDestinationKindEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw =
    env[DESTINATION_KIND_ENV] ??
    DESTINATION_KIND_ENV_ALIASES.map((key) => env[key]).find(
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

export function resolveDestinationKindEnabled(input: {
  destinationKind?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (input.destinationKind === true) {
    return true;
  }
  if (input.destinationKind === false) {
    return false;
  }
  return parseDestinationKindEnabled(input.env);
}

export function providerForDestinationKind(
  kind: DestinationKind,
): DestinationProviderId {
  if (kind === "personal_preference") {
    return "mem0";
  }
  if (kind === "temporal_episode") {
    return "graphiti";
  }
  return "hindsight";
}

export function normalizeConfiguredProviders(
  providers: readonly string[] | undefined,
): DestinationProviderId[] {
  const seen = new Set<DestinationProviderId>(["hindsight"]);
  for (const raw of providers ?? []) {
    const id = raw.trim().toLowerCase();
    if (id === "mem0" || id === "graphiti" || id === "hindsight") {
      seen.add(id);
    }
  }
  return DESTINATION_PROVIDERS.filter((id) => seen.has(id));
}

export function resolveDestinationProvider(input: {
  kind: DestinationKind;
  configuredProviders?: readonly string[];
}): {
  provider: DestinationProviderId;
  requestedProvider: DestinationProviderId;
  fellBackToHindsight: boolean;
  warning?: string;
  routeHindsightBank: boolean;
} {
  const requested = providerForDestinationKind(input.kind);
  const configured = new Set(normalizeConfiguredProviders(input.configuredProviders));
  if (configured.has(requested)) {
    return {
      provider: requested,
      requestedProvider: requested,
      fellBackToHindsight: false,
      routeHindsightBank: requested === "hindsight",
    };
  }
  return {
    provider: "hindsight",
    requestedProvider: requested,
    fellBackToHindsight: true,
    warning: `${input.kind} maps to ${requested}, which is not configured; defaulting to Hindsight`,
    routeHindsightBank: true,
  };
}

export function destinationKindQuestions(): Record<string, JudgeQuestion> {
  return {
    destination_kind: destinationKindQuestion(),
  };
}

export function passThroughDestinationKind(): DestinationKindDecision {
  return {
    kind: "institutional",
    provider: "hindsight",
    requestedProvider: "hindsight",
    fellBackToHindsight: false,
    reason: "destination-kind routing off",
    source: "pass_through",
    routeHindsightBank: true,
    agentMessage: DESTINATION_KIND_UNSET_MESSAGE,
  };
}

export function heuristicDestinationKind(input: {
  text: string;
  configuredProviders?: readonly string[];
}): DestinationKindDecision {
  const trimmed = input.text.trim();
  if (trimmed.length === 0 || containsInlineSecret(trimmed)) {
    return finishKind({
      kind: "institutional",
      reason:
        trimmed.length === 0
          ? "empty section; default Hindsight"
          : "secret pattern; default Hindsight",
      source: "heuristic",
      configuredProviders: input.configuredProviders,
    });
  }

  const institutionalHits = countSignals(trimmed, [
    /\bADR\b/,
    /\barchitecture decision\b/i,
    /\binvariant\b/i,
    /\bstandard\b/i,
    /\bwe decided\b/i,
    /\bdecision\b/i,
  ]);
  const preferenceHits = countSignals(trimmed, [
    /\bstyle preference\b/i,
    /\bpersonal taste\b/i,
    /\bpersonal formatting\b/i,
    /\bi prefer\b/i,
    /\bi like\b/i,
    /\beditor theme\b/i,
    /\btwo-space indent\b/i,
  ]);
  const temporalHits = countSignals(trimmed, [
    /\btemporal episode\b/i,
    /\bepisode\b/i,
    /\btimeline\b/i,
    /\bincident on\b/i,
    /\bas of \d{4}/i,
    /\bwhat changed on\b/i,
  ]);

  if (institutionalHits >= 1 && preferenceHits === 0) {
    return finishKind({
      kind: "institutional",
      reason: "heuristic ADR / institutional knowledge",
      source: "heuristic",
      configuredProviders: input.configuredProviders,
    });
  }
  if (preferenceHits >= 1 && institutionalHits === 0) {
    return finishKind({
      kind: "personal_preference",
      reason: "heuristic personal style preference",
      source: "heuristic",
      configuredProviders: input.configuredProviders,
    });
  }
  if (temporalHits >= 1 && institutionalHits === 0 && preferenceHits === 0) {
    return finishKind({
      kind: "temporal_episode",
      reason: "heuristic temporal episode",
      source: "heuristic",
      configuredProviders: input.configuredProviders,
    });
  }
  return finishKind({
    kind: "institutional",
    reason: "heuristic default institutional",
    source: "heuristic",
    configuredProviders: input.configuredProviders,
  });
}

export function interpretDestinationKind(input: {
  answers: Record<string, JudgeAnswer>;
  confidence: number;
  configuredProviders?: readonly string[];
}): DestinationKindDecision {
  const chosen = readChoice(input.answers.destination_kind);
  const confident =
    chosen !== undefined &&
    DESTINATION_KINDS.includes(chosen.choice as DestinationKind) &&
    chosen.confidence + 1e-9 >= input.confidence;

  if (!confident || chosen === undefined) {
    const decided = finishKind({
      kind: "institutional",
      reason:
        chosen === undefined
          ? "missing destination_kind; defaulting to Hindsight"
          : `destination_kind below ${input.confidence.toFixed(2)}; defaulting to Hindsight`,
      source: "jev",
      configuredProviders: input.configuredProviders,
    });
    return {
      ...decided,
      ...(chosen !== undefined
        ? { chosenKind: chosen.choice, kindConfidence: chosen.confidence }
        : {}),
      warning: decided.warning ?? "uncertain destination_kind; defaulting to Hindsight",
      fellBackToHindsight: true,
    };
  }

  return finishKind({
    kind: chosen.choice as DestinationKind,
    reason: `confident destination_kind=${chosen.choice}`,
    source: "jev",
    configuredProviders: input.configuredProviders,
    chosenKind: chosen.choice,
    kindConfidence: chosen.confidence,
  });
}

export async function judgeDestinationKind(input: {
  text: string;
  configuredProviders?: readonly string[];
  judge?: Judge;
  confidence: number;
  destinationKind?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<DestinationKindResult> {
  const started = Date.now();
  const enabled = resolveDestinationKindEnabled({
    ...(input.destinationKind !== undefined
      ? { destinationKind: input.destinationKind }
      : {}),
    ...(input.env !== undefined ? { env: input.env } : {}),
  });

  if (!enabled) {
    return {
      decision: passThroughDestinationKind(),
      latencyMs: Date.now() - started,
      enabled: false,
    };
  }

  const heuristicInput = {
    text: input.text,
    ...(input.configuredProviders !== undefined
      ? { configuredProviders: input.configuredProviders }
      : {}),
  };

  if (
    containsInlineSecret(input.text) ||
    input.judge === undefined ||
    input.judge.id === "off" ||
    input.judge.id !== "jev"
  ) {
    return {
      decision: heuristicDestinationKind(heuristicInput),
      latencyMs: Date.now() - started,
      enabled: true,
    };
  }

  const state = {
    type: "destination_kind",
    text: input.text.slice(0, DESTINATION_KIND_TEXT_MAX_CHARS),
    configured_providers: normalizeConfiguredProviders(input.configuredProviders),
  };

  try {
    assertJevStateSendable(state);
  } catch {
    return {
      decision: heuristicDestinationKind(heuristicInput),
      latencyMs: Date.now() - started,
      enabled: true,
    };
  }

  const result = await input.judge.evaluate({
    state,
    questions: destinationKindQuestions(),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    return {
      decision: heuristicDestinationKind(heuristicInput),
      latencyMs: Date.now() - started,
      enabled: true,
    };
  }

  return {
    decision: interpretDestinationKind({
      answers: result.answers,
      confidence: input.confidence,
      ...(input.configuredProviders !== undefined
        ? { configuredProviders: input.configuredProviders }
        : {}),
    }),
    latencyMs: Date.now() - started,
    enabled: true,
  };
}

export function formatDestinationKindLines(input: {
  decision: DestinationKindDecision;
  latencyMs?: number;
  dryRun?: boolean;
}): string[] {
  const prefix = input.dryRun === true ? "[dry-run] " : "";
  const lines = [
    `${prefix}Destination kind: ${input.decision.kind} → ${input.decision.provider} (${input.decision.source})`,
    `${prefix}reason: ${input.decision.reason}`,
    `${prefix}agent: ${input.decision.agentMessage}`,
  ];
  if (input.decision.warning !== undefined) {
    lines.push(`${prefix}warning: ${input.decision.warning}`);
  }
  if (
    input.decision.chosenKind !== undefined &&
    input.decision.kindConfidence !== undefined
  ) {
    lines.push(
      `${prefix}destination_kind: ${input.decision.chosenKind} confidence=${input.decision.kindConfidence.toFixed(2)}`,
    );
  }
  if (input.latencyMs !== undefined) {
    lines.push(
      `${prefix}latency: ${input.latencyMs}ms vs ungated destination kind`,
    );
  }
  return lines;
}

function finishKind(input: {
  kind: DestinationKind;
  reason: string;
  source: DestinationKindSource;
  configuredProviders?: readonly string[] | undefined;
  chosenKind?: string | undefined;
  kindConfidence?: number | undefined;
}): DestinationKindDecision {
  const resolved = resolveDestinationProvider({
    kind: input.kind,
    ...(input.configuredProviders !== undefined
      ? { configuredProviders: input.configuredProviders }
      : {}),
  });
  return {
    kind: input.kind,
    provider: resolved.provider,
    requestedProvider: resolved.requestedProvider,
    fellBackToHindsight: resolved.fellBackToHindsight,
    ...(resolved.warning !== undefined ? { warning: resolved.warning } : {}),
    reason: input.reason,
    source: input.source,
    routeHindsightBank: resolved.routeHindsightBank,
    ...(input.chosenKind !== undefined ? { chosenKind: input.chosenKind } : {}),
    ...(input.kindConfidence !== undefined
      ? { kindConfidence: input.kindConfidence }
      : {}),
    agentMessage: agentMessageFor(resolved.provider, resolved.fellBackToHindsight),
  };
}

function agentMessageFor(
  provider: DestinationProviderId,
  fellBack: boolean,
): string {
  if (fellBack || provider === "hindsight") {
    return DESTINATION_KIND_HINDSIGHT_MESSAGE;
  }
  if (provider === "mem0") {
    return DESTINATION_KIND_MEM0_MESSAGE;
  }
  return DESTINATION_KIND_GRAPHITI_MESSAGE;
}

function destinationKindQuestion(): ChoiceQuestion {
  return {
    type: "choice",
    instructions:
      "What kind of knowledge is this section? Choose the kind, not a vendor. institutional is company-brain material for Hindsight. personal_preference is a personal taste that can go to Mem0 only when that provider is configured. temporal_episode is a time-scoped event for Graphiti seed only when that provider is configured. An ADR stays institutional.",
    criteria: {
      institutional: {
        what: "Durable company knowledge: ADR, invariant, architecture, or required standard. Stays on Hindsight.",
        not_for: "A personal formatting taste, or a one-off incident timeline.",
        examples: [
          "ADR 0001: keep the bank local-first.",
          "This architecture decision is a project invariant.",
        ],
      },
      personal_preference: {
        what: "A personal style or tool preference the repository does not require.",
        not_for: "A required coding standard or an ADR.",
        examples: [
          "I prefer a two-space indent in scratch notes.",
          "I like this editor theme for markdown.",
        ],
      },
      temporal_episode: {
        what: "A time-scoped episode: an incident, a timeline, or what changed on a date.",
        not_for: "A standing ADR or a personal style preference.",
        examples: [
          "Incident on 2024-03-01: deploy failed, then recovered.",
          "Timeline of what changed on 2024-11-02.",
        ],
      },
    },
  };
}

function countSignals(text: string, patterns: readonly RegExp[]): number {
  let hits = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      hits += 1;
    }
  }
  return hits;
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
