import { describe, expect, it } from "vitest";
import {
  destinationKindQuestions,
  formatDestinationKindLines,
  heuristicDestinationKind,
  interpretDestinationKind,
  judgeDestinationKind,
  parseDestinationKindEnabled,
  passThroughDestinationKind,
  resolveDestinationKindEnabled,
  resolveDestinationProvider,
} from "./destination-kind.js";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";

const ADR = `# ADR 0001: Keep the bank local

## Decision

We decided to keep the Hindsight bank on the machine. This architecture decision is a project invariant.
`;

const STYLE = `I prefer a two-space indent in scratch notes.
I like this editor theme for markdown.
This is a personal formatting taste.
`;

const EPISODE = `Incident on 2024-03-01: the deploy failed, then recovered.
Timeline of what changed on 2024-03-01.
`;

class ScriptedJudge implements Judge {
  readonly id = "jev" as const;
  readonly calls: JudgeEvaluateInput[] = [];
  choice = "personal_preference";
  confidence = 0.93;
  fellBackFromJev = false;

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    return {
      judgeId: "jev",
      fellBackFromJev: this.fellBackFromJev,
      answers: {
        destination_kind: {
          type: "choice",
          choice: this.choice,
          probabilities: { [this.choice]: this.confidence },
          confidence: this.confidence,
        },
      },
    };
  }
}

describe("destination kind", () => {
  it("asks destination_kind, not a vendor name", () => {
    const questions = destinationKindQuestions();
    expect(questions.destination_kind?.type).toBe("choice");
    if (questions.destination_kind?.type === "choice") {
      expect(Object.keys(questions.destination_kind.criteria).sort()).toEqual([
        "institutional",
        "personal_preference",
        "temporal_episode",
      ]);
    }
  });

  it("is off by default", () => {
    expect(parseDestinationKindEnabled({})).toBe(false);
    expect(parseDestinationKindEnabled({ ORTO_JEV_DESTINATION_KIND: "1" })).toBe(
      true,
    );
    expect(resolveDestinationKindEnabled({})).toBe(false);
    expect(resolveDestinationKindEnabled({ destinationKind: true })).toBe(true);
  });

  it("pass-through stays on Hindsight and does not call TypeSafe", async () => {
    const judge = new ScriptedJudge();
    const result = await judgeDestinationKind({
      text: STYLE,
      configuredProviders: ["mem0"],
      judge,
      confidence: 0.8,
    });
    expect(result.enabled).toBe(false);
    expect(result.decision.provider).toBe("hindsight");
    expect(passThroughDestinationKind().routeHindsightBank).toBe(true);
    expect(judge.calls).toHaveLength(0);
  });

  it("keeps an ADR on Hindsight even when Mem0 is available", () => {
    const decision = heuristicDestinationKind({
      text: ADR,
      configuredProviders: ["mem0", "graphiti"],
    });
    expect(decision.kind).toBe("institutional");
    expect(decision.provider).toBe("hindsight");
    expect(decision.fellBackToHindsight).toBe(false);
    expect(decision.warning).toBeUndefined();
    expect(decision.routeHindsightBank).toBe(true);
  });

  it("selects Mem0 for a style preference when mem0 is configured", () => {
    const decision = heuristicDestinationKind({
      text: STYLE,
      configuredProviders: ["mem0"],
    });
    expect(decision.kind).toBe("personal_preference");
    expect(decision.provider).toBe("mem0");
    expect(decision.routeHindsightBank).toBe(false);
    expect(decision.agentMessage).toMatch(/Do not also seed/);
  });

  it("defaults to Hindsight with a warning when Mem0 is not configured", () => {
    expect(() =>
      heuristicDestinationKind({
        text: STYLE,
        configuredProviders: [],
      }),
    ).not.toThrow();
    const decision = heuristicDestinationKind({
      text: STYLE,
    });
    expect(decision.kind).toBe("personal_preference");
    expect(decision.provider).toBe("hindsight");
    expect(decision.requestedProvider).toBe("mem0");
    expect(decision.fellBackToHindsight).toBe(true);
    expect(decision.warning).toMatch(/mem0, which is not configured/);
    expect(decision.warning).toMatch(/defaulting to Hindsight/);
  });

  it("defaults to Hindsight with a warning when Graphiti is not configured", () => {
    const decision = heuristicDestinationKind({
      text: EPISODE,
      configuredProviders: ["mem0"],
    });
    expect(decision.kind).toBe("temporal_episode");
    expect(decision.provider).toBe("hindsight");
    expect(decision.warning).toMatch(/graphiti, which is not configured/);
  });

  it("routes a temporal episode to Graphiti when that provider is configured", () => {
    const decision = heuristicDestinationKind({
      text: EPISODE,
      configuredProviders: ["graphiti"],
    });
    expect(decision.provider).toBe("graphiti");
    expect(decision.fellBackToHindsight).toBe(false);
    expect(decision.routeHindsightBank).toBe(false);
  });

  it("uses Jev when destinationKind is opted in", async () => {
    const judge = new ScriptedJudge();
    const result = await judgeDestinationKind({
      text: STYLE,
      configuredProviders: ["mem0"],
      judge,
      confidence: 0.8,
      destinationKind: true,
    });
    expect(result.decision.source).toBe("jev");
    expect(result.decision.provider).toBe("mem0");
    expect(judge.calls).toHaveLength(1);
    expect((judge.calls[0]?.state as { type?: string }).type).toBe(
      "destination_kind",
    );
  });

  it("Jev personal_preference without Mem0 falls back and does not throw", () => {
    expect(() =>
      interpretDestinationKind({
        confidence: 0.8,
        answers: {
          destination_kind: {
            type: "choice",
            choice: "personal_preference",
            probabilities: { personal_preference: 0.95 },
            confidence: 0.95,
          },
        },
      }),
    ).not.toThrow();
    const decision = interpretDestinationKind({
      confidence: 0.8,
      answers: {
        destination_kind: {
          type: "choice",
          choice: "personal_preference",
          probabilities: { personal_preference: 0.95 },
          confidence: 0.95,
        },
      },
    });
    expect(decision.provider).toBe("hindsight");
    expect(decision.warning).toMatch(/not configured/);
  });

  it("low-confidence Jev choice defaults to Hindsight", () => {
    const decision = interpretDestinationKind({
      confidence: 0.8,
      configuredProviders: ["mem0"],
      answers: {
        destination_kind: {
          type: "choice",
          choice: "personal_preference",
          probabilities: { personal_preference: 0.4 },
          confidence: 0.4,
        },
      },
    });
    expect(decision.kind).toBe("institutional");
    expect(decision.provider).toBe("hindsight");
    expect(decision.warning).toMatch(/defaulting to Hindsight/);
  });

  it("resolveDestinationProvider never throws for an unknown extra name", () => {
    const resolved = resolveDestinationProvider({
      kind: "temporal_episode",
      configuredProviders: ["not-a-provider"],
    });
    expect(resolved.provider).toBe("hindsight");
    expect(resolved.fellBackToHindsight).toBe(true);
  });

  it("formatDestinationKindLines includes a fallback warning", () => {
    const decision = heuristicDestinationKind({ text: STYLE });
    const lines = formatDestinationKindLines({ decision, latencyMs: 9 });
    expect(
      lines.some((line) =>
        line.includes("Destination kind: personal_preference → hindsight"),
      ),
    ).toBe(true);
    expect(lines.some((line) => line.includes("warning:"))).toBe(true);
    expect(
      lines.some((line) => line.includes("latency: 9ms vs ungated destination kind")),
    ).toBe(true);
  });
});
