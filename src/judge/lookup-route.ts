/*
Lookup routing chooses which Hindsight tool a harness should call for an
agent question: mental_model, reflect, or recall. Harnesses call
judgeLookupRoute, then invoke the matching Hindsight API. Jev does not
synthesize the answer.

Default path is pass-through: no TypeSafe call, verdict unset, MCP tools
stay separate. Opt in with route:true or ORTO_JEV_LOOKUP_ROUTE=1
(NOCCIOLO_JEV_LOOKUP_ROUTE alias). One Choice lookup asks which route to
take given the question and known mental-model titles. When the judge is
off, or Jev falls back, heuristicLookupRoute still prefers a pinned model
title match, factual recall, or why/how reflect. This module does not host
or proxy MCP.
*/

import {
  assertJevStateSendable,
  containsInlineSecret,
  JEV_DOCUMENT_ID_MAX_CHARS,
  JEV_HEADING_MAX_CHARS,
  JEV_SECTION_MAX_CHARS,
} from "./state.js";
import type {
  ChoiceQuestion,
  Judge,
  JudgeAnswer,
  JudgeQuestion,
} from "./types.js";

export const LOOKUP_ROUTES = ["mental_model", "reflect", "recall"] as const;
export type LookupRoute = (typeof LOOKUP_ROUTES)[number];

export const LOOKUP_ROUTE_ENV = "ORTO_JEV_LOOKUP_ROUTE";
export const LOOKUP_ROUTE_ENV_ALIAS = "NOCCIOLO_JEV_LOOKUP_ROUTE";
export const LOOKUP_ROUTE_MAX_MODELS = 24;
export const LOOKUP_ROUTE_QUESTION_MAX_CHARS = JEV_SECTION_MAX_CHARS;

export interface MentalModelRef {
  id: string;
  title: string;
}

export type LookupRouteSource = "jev" | "heuristic" | "pass_through";

export interface LookupRouteDecision {
  route?: LookupRoute;
  mentalModelId?: string;
  mentalModelTitle?: string;
  verdict: LookupRoute | "unset";
  reason: string;
  source: LookupRouteSource;
  chosenRoute?: string;
  routeConfidence?: number;
}

export interface LookupRouteResult {
  decision: LookupRouteDecision;
  latencyMs: number;
  routeEnabled: boolean;
}

export function parseLookupRouteEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[LOOKUP_ROUTE_ENV] ?? env[LOOKUP_ROUTE_ENV_ALIAS];
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

export function resolveLookupRouteEnabled(input: {
  route?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (input.route === true) {
    return true;
  }
  if (input.route === false) {
    return false;
  }
  return parseLookupRouteEnabled(input.env);
}

export function lookupRouteQuestions(): Record<string, JudgeQuestion> {
  return {
    lookup: lookupQuestion(),
  };
}

export function passThroughLookupRoute(): LookupRouteDecision {
  return {
    verdict: "unset",
    reason: "lookup route off",
    source: "pass_through",
  };
}

export function heuristicLookupRoute(input: {
  question: string;
  mentalModels?: readonly MentalModelRef[];
}): LookupRouteDecision {
  const question = input.question.trim();
  if (question.length === 0) {
    return {
      verdict: "recall",
      route: "recall",
      reason: "empty question; default recall",
      source: "heuristic",
    };
  }

  if (containsInlineSecret(question)) {
    return {
      verdict: "recall",
      route: "recall",
      reason: "secret pattern in question; avoid synthesize path",
      source: "heuristic",
    };
  }

  const matched = matchMentalModel(question, input.mentalModels ?? []);
  if (matched !== undefined) {
    return {
      verdict: "mental_model",
      route: "mental_model",
      mentalModelId: matched.id,
      mentalModelTitle: matched.title,
      reason: `standing question matches pinned model "${matched.title}"`,
      source: "heuristic",
    };
  }

  if (looksLikeSynthesis(question)) {
    return {
      verdict: "reflect",
      route: "reflect",
      reason: "synthesis / why-how playbook question",
      source: "heuristic",
    };
  }

  if (looksLikeFactualLookup(question)) {
    return {
      verdict: "recall",
      route: "recall",
      reason: "one-off factual lookup",
      source: "heuristic",
    };
  }

  return {
    verdict: "recall",
    route: "recall",
    reason: "heuristic default recall",
    source: "heuristic",
  };
}

export function interpretLookupRoute(input: {
  answers: Record<string, JudgeAnswer>;
  confidence: number;
  question: string;
  mentalModels?: readonly MentalModelRef[];
}): LookupRouteDecision {
  const chosen = readChoice(input.answers.lookup);
  const actionConfident =
    chosen !== undefined &&
    LOOKUP_ROUTES.includes(chosen.choice as LookupRoute) &&
    chosen.confidence + 1e-9 >= input.confidence;

  if (!actionConfident) {
    return {
      ...heuristicLookupRoute({
        question: input.question,
        ...(input.mentalModels !== undefined
          ? { mentalModels: input.mentalModels }
          : {}),
      }),
      reason: `lookup below ${input.confidence.toFixed(2)}; heuristic fallback`,
      ...(chosen !== undefined
        ? { chosenRoute: chosen.choice, routeConfidence: chosen.confidence }
        : {}),
    };
  }

  const route = chosen.choice as LookupRoute;
  const matched =
    route === "mental_model"
      ? matchMentalModel(input.question, input.mentalModels ?? [])
      : undefined;

  return {
    verdict: route,
    route,
    reason: `confident lookup=${route}`,
    source: "jev",
    chosenRoute: chosen.choice,
    routeConfidence: chosen.confidence,
    ...(matched !== undefined
      ? { mentalModelId: matched.id, mentalModelTitle: matched.title }
      : {}),
  };
}

export async function judgeLookupRoute(input: {
  question: string;
  mentalModels?: readonly MentalModelRef[];
  judge?: Judge;
  confidence: number;
  route?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<LookupRouteResult> {
  const started = Date.now();
  const routeEnabled = resolveLookupRouteEnabled({
    ...(input.route !== undefined ? { route: input.route } : {}),
    ...(input.env !== undefined ? { env: input.env } : {}),
  });

  if (!routeEnabled) {
    return {
      decision: passThroughLookupRoute(),
      latencyMs: Date.now() - started,
      routeEnabled: false,
    };
  }

  if (containsInlineSecret(input.question)) {
    return {
      decision: heuristicLookupRoute({
        question: input.question,
        ...(input.mentalModels !== undefined
          ? { mentalModels: input.mentalModels }
          : {}),
      }),
      latencyMs: Date.now() - started,
      routeEnabled: true,
    };
  }

  if (
    input.judge === undefined ||
    input.judge.id === "off" ||
    input.judge.id !== "jev"
  ) {
    return {
      decision: heuristicLookupRoute({
        question: input.question,
        ...(input.mentalModels !== undefined
          ? { mentalModels: input.mentalModels }
          : {}),
      }),
      latencyMs: Date.now() - started,
      routeEnabled: true,
    };
  }

  const models = (input.mentalModels ?? []).slice(0, LOOKUP_ROUTE_MAX_MODELS);
  const state = {
    type: "lookup_route",
    question: input.question.slice(0, LOOKUP_ROUTE_QUESTION_MAX_CHARS),
    mental_models: models.map((model) => ({
      id: model.id.slice(0, JEV_DOCUMENT_ID_MAX_CHARS),
      title: model.title.slice(0, JEV_HEADING_MAX_CHARS),
    })),
  };

  try {
    assertJevStateSendable(state);
  } catch {
    return {
      decision: heuristicLookupRoute({
        question: input.question,
        mentalModels: models,
      }),
      latencyMs: Date.now() - started,
      routeEnabled: true,
    };
  }

  const result = await input.judge.evaluate({
    state,
    questions: lookupRouteQuestions(),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    return {
      decision: heuristicLookupRoute({
        question: input.question,
        mentalModels: models,
      }),
      latencyMs: Date.now() - started,
      routeEnabled: true,
    };
  }

  return {
    decision: interpretLookupRoute({
      answers: result.answers,
      confidence: input.confidence,
      question: input.question,
      mentalModels: models,
    }),
    latencyMs: Date.now() - started,
    routeEnabled: true,
  };
}

export function formatLookupRouteLines(input: {
  decision: LookupRouteDecision;
  latencyMs?: number;
  dryRun?: boolean;
}): string[] {
  const prefix = input.dryRun === true ? "[dry-run] " : "";
  const lines = [
    `${prefix}Lookup route: ${input.decision.verdict} (${input.decision.source})`,
    `${prefix}reason: ${input.decision.reason}`,
  ];
  if (input.decision.mentalModelId !== undefined) {
    lines.push(
      `${prefix}mental_model: ${input.decision.mentalModelId}${
        input.decision.mentalModelTitle !== undefined
          ? ` (${input.decision.mentalModelTitle})`
          : ""
      }`,
    );
  }
  if (
    input.decision.chosenRoute !== undefined &&
    input.decision.routeConfidence !== undefined
  ) {
    lines.push(
      `${prefix}lookup: ${input.decision.chosenRoute} confidence=${input.decision.routeConfidence.toFixed(2)}`,
    );
  }
  if (input.latencyMs !== undefined) {
    lines.push(`${prefix}latency: ${input.latencyMs}ms vs unrouted lookup`);
  }
  return lines;
}

export function matchMentalModel(
  question: string,
  mentalModels: readonly MentalModelRef[],
): MentalModelRef | undefined {
  const normalizedQuestion = normalizeText(question);
  if (normalizedQuestion.length === 0 || mentalModels.length === 0) {
    return undefined;
  }

  let best: { model: MentalModelRef; score: number } | undefined;
  for (const model of mentalModels) {
    const title = normalizeText(model.title);
    if (title.length < 3) {
      continue;
    }
    let score = 0;
    if (normalizedQuestion === title || normalizedQuestion.includes(title)) {
      score = 200 + title.length;
    } else if (title.includes(normalizedQuestion) && normalizedQuestion.length >= 12) {
      score = 150 + normalizedQuestion.length;
    } else {
      const titleTokens = title.split(" ").filter((token) => token.length >= 3);
      const questionTokens = new Set(
        normalizedQuestion.split(" ").filter((token) => token.length >= 3),
      );
      if (titleTokens.length >= 2) {
        const hits = titleTokens.filter((token) => questionTokens.has(token)).length;
        const coverage = hits / titleTokens.length;
        if (coverage + 1e-9 >= 0.85 && hits === titleTokens.length) {
          score = 100 + hits;
        }
      }
    }
    if (score === 0) {
      continue;
    }
    if (best === undefined || score > best.score) {
      best = { model, score };
    }
  }
  return best?.model;
}

function looksLikeSynthesis(question: string): boolean {
  return (
    /\bwhy do we\b/i.test(question) ||
    /\bhow do we\b/i.test(question) ||
    /\bhow should (we|orto|agents)\b/i.test(question) ||
    /\bwhat('s| is) our (approach|policy|playbook|standard)\b/i.test(question) ||
    /\btrade-?offs?\b/i.test(question) ||
    /\barchitecture\b/i.test(question) ||
    /\bcoding standards?\b/i.test(question) ||
    /\bhow we work\b/i.test(question) ||
    /\bplaybook\b/i.test(question)
  );
}

function looksLikeFactualLookup(question: string): boolean {
  return (
    /\bwhat port\b/i.test(question) ||
    /\bwhich (file|path|port|url|endpoint|bank|id)\b/i.test(question) ||
    /\bwhere (is|does|do)\b/i.test(question) ||
    /\bwhen (did|was|do)\b/i.test(question) ||
    /\bwho (owns|wrote|decided)\b/i.test(question) ||
    /\bdocument[_ ]?id\b/i.test(question) ||
    /\bprovenance\b/i.test(question) ||
    /\bwhat is the (default|value|name|url|port)\b/i.test(question) ||
    /\blookup\b/i.test(question) ||
    /\bfind the\b/i.test(question)
  );
}

function lookupQuestion(): ChoiceQuestion {
  return {
    type: "choice",
    instructions:
      "Which Hindsight lookup should the harness call for this agent question? Prefer a pinned mental model when the question matches a known model title. Prefer recall for one-off factual lookups. Prefer reflect for synthesis such as why/how we work. Do not invent the answer.",
    criteria: {
      mental_model: {
        what: "Read a pinned mental model whose title matches a standing project question.",
        not_for: "One-off facts or open-ended synthesis that is not a standing model.",
        examples: [
          "What are our Coding Standards?",
          "Standing playbook question that matches a known model title.",
        ],
      },
      recall: {
        what: "Narrow factual recall: a port, path, provenance, id, or one-off fact.",
        not_for: "Why/how synthesis or a standing question that matches a model title.",
        examples: [
          "What port does local Hindsight use?",
          "Where is the bank template path?",
        ],
      },
      reflect: {
        what: "Synthesize why/how we work, architecture, standards, or trade-offs.",
        not_for: "Exact fact lookup or an exact pinned-model standing question.",
        examples: [
          "Why do we keep the bank local-first?",
          "How should agents use durable project knowledge?",
        ],
      },
    },
  };
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
