import { describe, expect, it } from "vitest";
import {
  BANK_ROUTE_ASK,
  BANK_ROUTE_CURRENT,
  bankRouteApplies,
  bankRouteQuestions,
  buildBankRouteCriteria,
  formatBankRouteLines,
  heuristicBankRoute,
  interpretBankRoute,
  judgeBankRoute,
  parseBankRouteEnabled,
  passThroughBankRoute,
  resolveBankRouteEnabled,
} from "./bank-route.js";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";

const BILLING = {
  id: "billing-service",
  name: "Billing",
  description: "Invoices, payments, and subscriptions.",
};

const DESIGN = {
  id: "design-system",
  name: "Design system",
  description: "Design tokens, color, and typography.",
};

const DESIGN_DOC = `# Design tokens

color.primary is the brand color.
Typography scale uses rem.
These tokens belong to the design system.
`;

class ScriptedJudge implements Judge {
  readonly id = "jev" as const;
  readonly calls: JudgeEvaluateInput[] = [];
  choice = "design-system";
  confidence = 0.94;
  fellBackFromJev = false;

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    return {
      judgeId: "jev",
      fellBackFromJev: this.fellBackFromJev,
      answers: {
        bank: {
          type: "choice",
          choice: this.choice,
          probabilities: { [this.choice]: this.confidence },
          confidence: this.confidence,
        },
      },
    };
  }
}

describe("bank route", () => {
  it("builds criteria from configured banks plus current and ask", () => {
    const criteria = buildBankRouteCriteria([BILLING, DESIGN]);
    expect(Object.keys(criteria).sort()).toEqual([
      BANK_ROUTE_ASK,
      "billing-service",
      BANK_ROUTE_CURRENT,
      "design-system",
    ]);
    expect(bankRouteApplies([BILLING, DESIGN])).toBe(true);
    expect(bankRouteApplies([BILLING])).toBe(false);
  });

  it("single-bank projects never see this prompt", () => {
    expect(bankRouteQuestions([BILLING])).toEqual({});
    const questions = bankRouteQuestions([BILLING, DESIGN]);
    expect(questions.bank?.type).toBe("choice");
  });

  it("is off by default via env parser", () => {
    expect(parseBankRouteEnabled({})).toBe(false);
    expect(parseBankRouteEnabled({ ORTO_JEV_BANK_ROUTE: "1" })).toBe(true);
    expect(parseBankRouteEnabled({ NOCCIOLO_JEV_BANK_ROUTE: "yes" })).toBe(true);
    expect(resolveBankRouteEnabled({})).toBe(false);
    expect(resolveBankRouteEnabled({ routeBanks: true })).toBe(true);
    expect(
      resolveBankRouteEnabled({
        routeBanks: false,
        env: { ORTO_JEV_BANK_ROUTE: "1" },
      }),
    ).toBe(false);
  });

  it("pass-through keeps seeding the current bank via in_scope", () => {
    const decision = passThroughBankRoute({ currentBankId: "billing-service" });
    expect(decision.verdict).toBe("unset");
    expect(decision.seedCurrent).toBe(true);
    expect(decision.reason).toMatch(/in_scope/);
  });

  it("does not call TypeSafe for a single configured bank", async () => {
    const judge = new ScriptedJudge();
    const result = await judgeBankRoute({
      text: DESIGN_DOC,
      path: "docs/design-tokens.md",
      banks: [BILLING],
      currentBankId: "billing-service",
      judge,
      confidence: 0.8,
      routeBanks: true,
    });
    expect(result.prompted).toBe(false);
    expect(result.decision.verdict).toBe("unset");
    expect(result.decision.seedCurrent).toBe(true);
    expect(result.decision.reason).toMatch(/single-bank/);
    expect(judge.calls).toHaveLength(0);
  });

  it("default two-bank call stays pass-through until opted in", async () => {
    const judge = new ScriptedJudge();
    const result = await judgeBankRoute({
      text: DESIGN_DOC,
      banks: [BILLING, DESIGN],
      currentBankId: "billing-service",
      judge,
      confidence: 0.8,
    });
    expect(result.enabled).toBe(false);
    expect(result.prompted).toBe(false);
    expect(result.decision.verdict).toBe("unset");
    expect(judge.calls).toHaveLength(0);
  });

  it("a design-token doc does not seed the billing bank", () => {
    const decision = heuristicBankRoute({
      text: DESIGN_DOC,
      path: "docs/design-tokens.md",
      banks: [BILLING, DESIGN],
      currentBankId: "billing-service",
    });
    expect(decision.verdict).toBe("route");
    expect(decision.bank).toBe("design-system");
    expect(decision.bank).not.toBe("billing-service");
    expect(decision.seedCurrent).toBe(false);
    expect(decision.agentMessage).toMatch(/Do not seed the current bank/);
  });

  it("routes a billing doc to the current billing bank", () => {
    const decision = heuristicBankRoute({
      text: "Invoice and subscription payments live in the billing service.",
      path: "docs/billing.md",
      banks: [BILLING, DESIGN],
      currentBankId: "billing-service",
    });
    expect(decision.verdict).toBe("route");
    expect(decision.bank).toBe(BANK_ROUTE_CURRENT);
    expect(decision.seedCurrent).toBe(true);
  });

  it("asks when the section matches no bank", () => {
    const decision = heuristicBankRoute({
      text: "Hello world from the readme introduction paragraph.",
      banks: [BILLING, DESIGN],
      currentBankId: "billing-service",
    });
    expect(decision.verdict).toBe("ask");
    expect(decision.seedCurrent).toBe(false);
  });

  it("uses Jev when routeBanks is opted in", async () => {
    const judge = new ScriptedJudge();
    const result = await judgeBankRoute({
      text: DESIGN_DOC,
      path: "docs/design-tokens.md",
      banks: [BILLING, DESIGN],
      currentBankId: "billing-service",
      judge,
      confidence: 0.8,
      routeBanks: true,
    });
    expect(result.prompted).toBe(true);
    expect(result.decision.source).toBe("jev");
    expect(result.decision.bank).toBe("design-system");
    expect(result.decision.seedCurrent).toBe(false);
    expect(judge.calls).toHaveLength(1);
    expect((judge.calls[0]?.state as { type?: string }).type).toBe("bank_route");
    const question = judge.calls[0]?.questions.bank;
    expect(question?.type).toBe("choice");
    if (question?.type === "choice") {
      expect(question.criteria["billing-service"]).toBeDefined();
      expect(question.criteria["ghost-bank"]).toBeUndefined();
    }
  });

  it("rejects an invented bank id", () => {
    const decision = interpretBankRoute({
      confidence: 0.8,
      banks: [BILLING, DESIGN],
      currentBankId: "billing-service",
      answers: {
        bank: {
          type: "choice",
          choice: "ghost-bank",
          probabilities: { "ghost-bank": 0.99 },
          confidence: 0.99,
        },
      },
    });
    expect(decision.verdict).toBe("ask");
    expect(decision.seedCurrent).toBe(false);
  });

  it("falls back to the heuristic when Jev falls back", async () => {
    const judge = new ScriptedJudge();
    judge.fellBackFromJev = true;
    judge.choice = "billing-service";
    const result = await judgeBankRoute({
      text: DESIGN_DOC,
      path: "docs/design-tokens.md",
      banks: [BILLING, DESIGN],
      currentBankId: "billing-service",
      judge,
      confidence: 0.8,
      routeBanks: true,
    });
    expect(result.decision.source).toBe("heuristic");
    expect(result.decision.bank).toBe("design-system");
    expect(result.decision.seedCurrent).toBe(false);
  });

  it("enables from ORTO_JEV_BANK_ROUTE", async () => {
    const result = await judgeBankRoute({
      text: DESIGN_DOC,
      path: "docs/design-tokens.md",
      banks: [BILLING, DESIGN],
      currentBankId: "billing-service",
      confidence: 0.8,
      env: { ORTO_JEV_BANK_ROUTE: "1" },
    });
    expect(result.enabled).toBe(true);
    expect(result.decision.bank).toBe("design-system");
    expect(result.decision.seedCurrent).toBe(false);
  });

  it("formatBankRouteLines includes the route and latency", () => {
    const decision = heuristicBankRoute({
      text: DESIGN_DOC,
      banks: [BILLING, DESIGN],
      currentBankId: "billing-service",
    });
    const lines = formatBankRouteLines({ decision, latencyMs: 11 });
    expect(lines.some((line) => line.includes("Bank route: route → design-system"))).toBe(
      true,
    );
    expect(lines.some((line) => line.includes("seed current: no"))).toBe(true);
    expect(lines.some((line) => line.includes("latency: 11ms vs ungated bank route"))).toBe(
      true,
    );
  });
});
