import { describe, expect, it } from "vitest";
import {
  DEFAULT_MIN_RELEVANCE,
  formatRecallRankLines,
  heuristicRankRecalledPassages,
  interpretRecallRank,
  judgeRecallRanked,
  packRecallContext,
  passThroughRecallPassages,
  recallRankQuestions,
  relevanceKey,
} from "./recall-rank.js";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";

const TASK = "How should Orto seed durable ADRs into the local Hindsight bank?";

const ADR_PASSAGE = {
  id: "adr-1",
  text: "ADR: Prefer local-first Hindsight banks. Seed durable ADRs with provenance via orto seed.",
};

const CHAT_PASSAGE = {
  id: "chat-1",
  text: "User: can you help debug this flaky test?\nAssistant: I just tried restarting docker.",
};

const NOISE_PASSAGE = {
  id: "noise-1",
  text: "Badge wall: build passing, coverage 92%, npm downloads this week.",
};

class ScriptedJudge implements Judge {
  readonly id = "jev" as const;
  readonly calls: JudgeEvaluateInput[] = [];
  scores: Record<string, { score: number; confidence: number }> = {
    [relevanceKey(ADR_PASSAGE.id)]: { score: 4, confidence: 0.95 },
    [relevanceKey(CHAT_PASSAGE.id)]: { score: 0, confidence: 0.93 },
    [relevanceKey(NOISE_PASSAGE.id)]: { score: 1, confidence: 0.9 },
  };

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    const answers: JudgeResult["answers"] = {};
    for (const [key, scored] of Object.entries(this.scores)) {
      answers[key] = {
        type: "score",
        score: scored.score,
        legend: {},
        probabilities: {},
        confidence: scored.confidence,
      };
    }
    return { judgeId: "jev", answers };
  }
}

describe("recall rank guardrail", () => {
  it("builds one relevance score question per passage", () => {
    const questions = recallRankQuestions([ADR_PASSAGE, CHAT_PASSAGE]);
    expect(Object.keys(questions)).toEqual([
      relevanceKey(ADR_PASSAGE.id),
      relevanceKey(CHAT_PASSAGE.id),
    ]);
    expect(questions[relevanceKey(ADR_PASSAGE.id)]?.type).toBe("score");
  });

  it("pass-through keeps every passage without ranking", () => {
    const ranked = passThroughRecallPassages([ADR_PASSAGE, NOISE_PASSAGE]);
    expect(ranked.every((passage) => passage.kept)).toBe(true);
    expect(ranked.every((passage) => passage.source === "pass_through")).toBe(
      true,
    );
  });

  it("heuristically drops low-overlap noise for the task", () => {
    const ranked = heuristicRankRecalledPassages({
      task: TASK,
      passages: [ADR_PASSAGE, NOISE_PASSAGE],
      minRelevance: DEFAULT_MIN_RELEVANCE,
    });
    const adr = ranked.find((passage) => passage.id === ADR_PASSAGE.id);
    const noise = ranked.find((passage) => passage.id === NOISE_PASSAGE.id);
    expect(adr?.kept).toBe(true);
    expect(noise?.kept).toBe(false);
  });

  it("omits confident low-score passages from interpret", () => {
    const ranked = interpretRecallRank({
      passages: [ADR_PASSAGE, CHAT_PASSAGE, NOISE_PASSAGE],
      confidence: 0.8,
      answers: {
        [relevanceKey(ADR_PASSAGE.id)]: {
          type: "score",
          score: 4,
          legend: {},
          probabilities: {},
          confidence: 0.95,
        },
        [relevanceKey(CHAT_PASSAGE.id)]: {
          type: "score",
          score: 0,
          legend: {},
          probabilities: {},
          confidence: 0.93,
        },
        [relevanceKey(NOISE_PASSAGE.id)]: {
          type: "score",
          score: 1,
          legend: {},
          probabilities: {},
          confidence: 0.9,
        },
      },
    });
    expect(ranked.find((passage) => passage.id === ADR_PASSAGE.id)?.kept).toBe(
      true,
    );
    expect(ranked.find((passage) => passage.id === CHAT_PASSAGE.id)?.kept).toBe(
      false,
    );
    expect(ranked.find((passage) => passage.id === NOISE_PASSAGE.id)?.kept).toBe(
      false,
    );
  });

  it("keeps low scores when confidence is below the threshold", () => {
    const ranked = interpretRecallRank({
      passages: [NOISE_PASSAGE],
      confidence: 0.8,
      answers: {
        [relevanceKey(NOISE_PASSAGE.id)]: {
          type: "score",
          score: 0,
          legend: {},
          probabilities: {},
          confidence: 0.4,
        },
      },
    });
    expect(ranked[0]?.kept).toBe(true);
    expect(ranked[0]?.reason).toContain("low-confidence");
  });

  it("default judgeRecallRanked stays pass-through and skips TypeSafe", async () => {
    const judge = new ScriptedJudge();
    const result = await judgeRecallRanked({
      task: TASK,
      passages: [ADR_PASSAGE, NOISE_PASSAGE],
      judge,
      confidence: 0.8,
    });
    expect(result.source).toBe("pass_through");
    expect(judge.calls).toHaveLength(0);
    expect(result.ranked.every((passage) => passage.kept)).toBe(true);
  });

  it("ranks with Jev when rank is opted in", async () => {
    const judge = new ScriptedJudge();
    const result = await judgeRecallRanked({
      task: TASK,
      passages: [ADR_PASSAGE, CHAT_PASSAGE, NOISE_PASSAGE],
      judge,
      confidence: 0.8,
      rank: true,
    });
    expect(result.source).toBe("jev");
    expect(judge.calls).toHaveLength(1);
    expect(result.ranked.find((passage) => passage.id === ADR_PASSAGE.id)?.kept).toBe(
      true,
    );
    expect(result.ranked.find((passage) => passage.id === CHAT_PASSAGE.id)?.kept).toBe(
      false,
    );
  });

  it("packRecallContext pass-through preserves order and does not omit", async () => {
    const packed = await packRecallContext({
      task: TASK,
      passages: [NOISE_PASSAGE, ADR_PASSAGE],
      maxChars: 10_000,
    });
    expect(packed.source).toBe("pass_through");
    expect(packed.omittedCount).toBe(0);
    expect(packed.text.startsWith(NOISE_PASSAGE.text)).toBe(true);
  });

  it("packRecallContext omits low-score passages when ranking", async () => {
    const judge = new ScriptedJudge();
    const packed = await packRecallContext({
      task: TASK,
      passages: [ADR_PASSAGE, CHAT_PASSAGE, NOISE_PASSAGE],
      maxChars: 10_000,
      rank: true,
      judge,
      confidence: 0.8,
    });
    expect(packed.omittedCount).toBe(2);
    expect(packed.text).toContain("local-first Hindsight");
    expect(packed.text).not.toContain("flaky test");
    expect(packed.text).not.toContain("Badge wall");
  });

  it("formatRecallRankLines includes a latency benchmark note", () => {
    const ranked = interpretRecallRank({
      passages: [ADR_PASSAGE, NOISE_PASSAGE],
      confidence: 0.8,
      answers: {
        [relevanceKey(ADR_PASSAGE.id)]: {
          type: "score",
          score: 4,
          legend: {},
          probabilities: {},
          confidence: 0.95,
        },
        [relevanceKey(NOISE_PASSAGE.id)]: {
          type: "score",
          score: 1,
          legend: {},
          probabilities: {},
          confidence: 0.9,
        },
      },
    });
    const lines = formatRecallRankLines({
      ranked,
      latencyMs: 120,
      baselineMs: 0,
    });
    expect(lines.some((line) => line.includes("latency: 120ms vs unranked recall"))).toBe(
      true,
    );
    expect(lines.some((line) => line.includes("baseline pass-through 0ms"))).toBe(
      true,
    );
  });
});
