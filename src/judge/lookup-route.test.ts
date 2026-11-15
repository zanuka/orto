import { describe, expect, it } from "vitest";
import {
  formatLookupRouteLines,
  heuristicLookupRoute,
  interpretLookupRoute,
  judgeLookupRoute,
  lookupRouteQuestions,
  parseLookupRouteEnabled,
  passThroughLookupRoute,
  resolveLookupRouteEnabled,
} from "./lookup-route.js";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";

const MODELS = [
  { id: "coding-standards", title: "Coding Standards" },
  { id: "local-first", title: "Local-first bank seeding" },
];

class ScriptedJudge implements Judge {
  readonly id = "jev" as const;
  readonly calls: JudgeEvaluateInput[] = [];
  choice = "reflect";
  confidence = 0.93;
  fellBackFromJev = false;

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    return {
      judgeId: "jev",
      fellBackFromJev: this.fellBackFromJev,
      answers: {
        lookup: {
          type: "choice",
          choice: this.choice,
          probabilities: { [this.choice]: this.confidence },
          confidence: this.confidence,
        },
      },
    };
  }
}

describe("lookup route", () => {
  it("asks a lookup choice with mental_model, reflect, and recall", () => {
    const questions = lookupRouteQuestions();
    expect(questions.lookup?.type).toBe("choice");
    if (questions.lookup?.type === "choice") {
      expect(Object.keys(questions.lookup.criteria).sort()).toEqual([
        "mental_model",
        "recall",
        "reflect",
      ]);
    }
  });

  it("is off by default via env parser", () => {
    expect(parseLookupRouteEnabled({})).toBe(false);
    expect(parseLookupRouteEnabled({ ORTO_JEV_LOOKUP_ROUTE: "0" })).toBe(false);
    expect(parseLookupRouteEnabled({ ORTO_JEV_LOOKUP_ROUTE: "1" })).toBe(true);
    expect(parseLookupRouteEnabled({ NOCCIOLO_JEV_LOOKUP_ROUTE: "true" })).toBe(
      true,
    );
    expect(resolveLookupRouteEnabled({})).toBe(false);
    expect(resolveLookupRouteEnabled({ route: true })).toBe(true);
    expect(
      resolveLookupRouteEnabled({
        route: false,
        env: { ORTO_JEV_LOOKUP_ROUTE: "1" },
      }),
    ).toBe(false);
  });

  it("pass-through leaves verdict unset", () => {
    const decision = passThroughLookupRoute();
    expect(decision.verdict).toBe("unset");
    expect(decision.source).toBe("pass_through");
    expect(decision.route).toBeUndefined();
  });

  it("default judgeLookupRoute stays pass-through and skips TypeSafe", async () => {
    const judge = new ScriptedJudge();
    const result = await judgeLookupRoute({
      question: "Why do we keep the bank local-first?",
      mentalModels: MODELS,
      judge,
      confidence: 0.8,
    });
    expect(result.routeEnabled).toBe(false);
    expect(result.decision.source).toBe("pass_through");
    expect(result.decision.verdict).toBe("unset");
    expect(judge.calls).toHaveLength(0);
  });

  it("standing question matching a pinned model title prefers mental_model", async () => {
    const result = await judgeLookupRoute({
      question: "What are our Coding Standards?",
      mentalModels: MODELS,
      confidence: 0.8,
      route: true,
    });
    expect(result.decision.verdict).toBe("mental_model");
    expect(result.decision.route).toBe("mental_model");
    expect(result.decision.mentalModelId).toBe("coding-standards");
    expect(result.decision.mentalModelTitle).toBe("Coding Standards");
    expect(result.decision.source).toBe("heuristic");
  });

  it("one-off factual lookup prefers recall", async () => {
    const result = await judgeLookupRoute({
      question: "What port does local Hindsight use?",
      mentalModels: MODELS,
      confidence: 0.8,
      route: true,
    });
    expect(result.decision.verdict).toBe("recall");
    expect(result.decision.route).toBe("recall");
    expect(result.decision.reason).toContain("factual");
  });

  it("why-do-we synthesis prefers reflect", async () => {
    const result = await judgeLookupRoute({
      question: "Why do we keep the bank local-first?",
      mentalModels: MODELS,
      confidence: 0.8,
      route: true,
    });
    expect(result.decision.verdict).toBe("reflect");
    expect(result.decision.route).toBe("reflect");
    expect(result.decision.reason).toContain("synthesis");
  });

  it("heuristic helpers match the acceptance routes directly", () => {
    expect(
      heuristicLookupRoute({
        question: "What are our Coding Standards?",
        mentalModels: MODELS,
      }).route,
    ).toBe("mental_model");
    expect(
      heuristicLookupRoute({
        question: "What port does local Hindsight use?",
        mentalModels: MODELS,
      }).route,
    ).toBe("recall");
    expect(
      heuristicLookupRoute({
        question: "Why do we keep the bank local-first?",
        mentalModels: MODELS,
      }).route,
    ).toBe("reflect");
  });

  it("uses Jev when route is opted in", async () => {
    const judge = new ScriptedJudge();
    judge.choice = "reflect";
    const result = await judgeLookupRoute({
      question: "How should agents inherit durable context?",
      mentalModels: MODELS,
      judge,
      confidence: 0.8,
      route: true,
    });
    expect(result.routeEnabled).toBe(true);
    expect(result.decision.source).toBe("jev");
    expect(result.decision.verdict).toBe("reflect");
    expect(judge.calls).toHaveLength(1);
    expect((judge.calls[0]?.state as { type?: string }).type).toBe("lookup_route");
  });

  it("falls back to heuristic on low-confidence Jev choice", () => {
    const decision = interpretLookupRoute({
      question: "What port does local Hindsight use?",
      mentalModels: MODELS,
      confidence: 0.8,
      answers: {
        lookup: {
          type: "choice",
          choice: "reflect",
          probabilities: { reflect: 0.4 },
          confidence: 0.4,
        },
      },
    });
    expect(decision.source).toBe("heuristic");
    expect(decision.route).toBe("recall");
    expect(decision.reason).toContain("heuristic fallback");
  });

  it("falls back to heuristic when Jev falls back", async () => {
    const judge = new ScriptedJudge();
    judge.fellBackFromJev = true;
    judge.choice = "mental_model";
    const result = await judgeLookupRoute({
      question: "What port does local Hindsight use?",
      mentalModels: MODELS,
      judge,
      confidence: 0.8,
      route: true,
    });
    expect(result.decision.source).toBe("heuristic");
    expect(result.decision.route).toBe("recall");
  });

  it("enables routing from ORTO_JEV_LOOKUP_ROUTE", async () => {
    const result = await judgeLookupRoute({
      question: "Why do we prefer durable ADRs?",
      mentalModels: MODELS,
      confidence: 0.8,
      env: { ORTO_JEV_LOOKUP_ROUTE: "1" },
    });
    expect(result.routeEnabled).toBe(true);
    expect(result.decision.route).toBe("reflect");
  });

  it("skips TypeSafe when the question contains a secret", async () => {
    const judge = new ScriptedJudge();
    const result = await judgeLookupRoute({
      question: "Why do we rotate sk-ant-api03-abcdefghijklmnopqrstuvwxyz?",
      mentalModels: MODELS,
      judge,
      confidence: 0.8,
      route: true,
    });
    expect(judge.calls).toHaveLength(0);
    expect(result.decision.source).toBe("heuristic");
  });

  it("formatLookupRouteLines includes route and latency", () => {
    const decision = heuristicLookupRoute({
      question: "What are our Coding Standards?",
      mentalModels: MODELS,
    });
    const lines = formatLookupRouteLines({
      decision,
      latencyMs: 15,
    });
    expect(lines.some((line) => line.includes("Lookup route: mental_model"))).toBe(
      true,
    );
    expect(lines.some((line) => line.includes("latency: 15ms vs unrouted lookup"))).toBe(
      true,
    );
    expect(lines.some((line) => line.includes("coding-standards"))).toBe(true);
  });
});
