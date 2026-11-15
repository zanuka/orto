import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatRecallVerifyLines,
  interpretRecallVerify,
  judgeRecallVerified,
  parseRecallVerifyEnabled,
  passThroughRecallVerify,
  recallVerifyQuestions,
  resolveRecallVerifyEnabled,
  stillTrueKey,
} from "./recall-verify.js";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";

const CURRENT = {
  id: "adr-current",
  text: "Decision: keep the Hindsight bank local-first.",
  documentId: "orto:docs/adr/0001-local.md#decision",
  currentExcerpt: "Decision: keep the Hindsight bank local-first.",
  sourceStillExists: true,
};

const STALE = {
  id: "adr-stale",
  text: "Decision: use MySQL for the company brain.",
  documentId: "orto:docs/adr/0002-mysql.md#decision",
  currentExcerpt: "Decision: use Postgres for the company brain.",
  sourceStillExists: true,
};

const MISSING = {
  id: "adr-missing",
  text: "Decision: always deploy to the public cloud.",
  documentId: "orto:docs/adr/gone.md#decision",
  sourceStillExists: false,
};

class ScriptedJudge implements Judge {
  readonly id = "jev" as const;
  readonly calls: JudgeEvaluateInput[] = [];
  answers: Record<string, number> = {
    [stillTrueKey(CURRENT.id)]: 0.95,
    [stillTrueKey(STALE.id)]: 0.05,
  };

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    const answers: JudgeResult["answers"] = {};
    for (const [key, noul] of Object.entries(this.answers)) {
      answers[key] = { type: "noul", noul };
    }
    return { judgeId: "jev", answers };
  }
}

describe("recall still-true verify", () => {
  it("builds one still_true noul per passage", () => {
    const questions = recallVerifyQuestions([CURRENT, STALE]);
    expect(Object.keys(questions)).toEqual([
      stillTrueKey(CURRENT.id),
      stillTrueKey(STALE.id),
    ]);
    expect(questions[stillTrueKey(CURRENT.id)]?.type).toBe("noul");
  });

  it("is off by default via env parser", () => {
    expect(parseRecallVerifyEnabled({})).toBe(false);
    expect(parseRecallVerifyEnabled({ ORTO_JEV_RECALL_VERIFY: "0" })).toBe(false);
    expect(parseRecallVerifyEnabled({ ORTO_JEV_RECALL_VERIFY: "1" })).toBe(true);
    expect(parseRecallVerifyEnabled({ NOCCIOLO_JEV_RECALL_VERIFY: "true" })).toBe(
      true,
    );
    expect(resolveRecallVerifyEnabled({})).toBe(false);
    expect(resolveRecallVerifyEnabled({ verify: true })).toBe(true);
    expect(
      resolveRecallVerifyEnabled({
        verify: false,
        env: { ORTO_JEV_RECALL_VERIFY: "1" },
      }),
    ).toBe(false);
  });

  it("pass-through keeps stale false", () => {
    const verified = passThroughRecallVerify([CURRENT, STALE, MISSING]);
    expect(verified.every((passage) => passage.stale === false)).toBe(true);
    expect(verified.every((passage) => passage.status === "pass_through")).toBe(
      true,
    );
  });

  it("default judgeRecallVerified stays pass-through and skips TypeSafe", async () => {
    const judge = new ScriptedJudge();
    const result = await judgeRecallVerified({
      passages: [CURRENT, STALE],
      judge,
      confidence: 0.8,
    });
    expect(result.verifyEnabled).toBe(false);
    expect(result.source).toBe("pass_through");
    expect(judge.calls).toHaveLength(0);
    expect(result.verified.every((passage) => passage.stale === false)).toBe(true);
  });

  it("marks confident contradictions stale when verify is on", async () => {
    const judge = new ScriptedJudge();
    const result = await judgeRecallVerified({
      passages: [CURRENT, STALE],
      judge,
      confidence: 0.8,
      verify: true,
    });
    expect(result.verifyEnabled).toBe(true);
    expect(result.source).toBe("jev");
    expect(judge.calls).toHaveLength(1);
    expect(result.verified.find((passage) => passage.id === CURRENT.id)?.stale).toBe(
      false,
    );
    expect(result.verified.find((passage) => passage.id === CURRENT.id)?.status).toBe(
      "current",
    );
    const stale = result.verified.find((passage) => passage.id === STALE.id);
    expect(stale?.stale).toBe(true);
    expect(stale?.status).toBe("stale");
    expect(stale?.reason).toContain("contradicts");
  });

  it("marks missing source stale without calling the judge", async () => {
    const judge = new ScriptedJudge();
    const result = await judgeRecallVerified({
      passages: [MISSING],
      judge,
      confidence: 0.8,
      verify: true,
    });
    expect(judge.calls).toHaveLength(0);
    expect(result.verified[0]?.stale).toBe(true);
    expect(result.verified[0]?.reason).toBe("source missing");
  });

  it("does not crash when source file is missing on disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "orto-recall-verify-"));
    await mkdir(join(root, "docs"), { recursive: true });
    const judge = new ScriptedJudge();
    const result = await judgeRecallVerified({
      passages: [
        {
          id: "gone",
          text: "Decision: use Redis everywhere.",
          documentId: "orto:docs/missing-adr.md#decision",
        },
      ],
      judge,
      confidence: 0.8,
      verify: true,
      projectRoot: root,
    });
    expect(result.verified[0]?.stale).toBe(true);
    expect(result.verified[0]?.reason).toBe("source missing");
    expect(judge.calls).toHaveLength(0);
  });

  it("loads an on-disk excerpt and marks contradiction stale", async () => {
    const root = await mkdtemp(join(tmpdir(), "orto-recall-verify-"));
    await mkdir(join(root, "docs", "adr"), { recursive: true });
    await writeFile(
      join(root, "docs", "adr", "0002-mysql.md"),
      "# ADR\n\n## Decision\n\nUse Postgres for the company brain.\n",
      "utf8",
    );
    const judge = new ScriptedJudge();
    judge.answers = {
      [stillTrueKey("loaded")]: 0.04,
    };
    const result = await judgeRecallVerified({
      passages: [
        {
          id: "loaded",
          text: "Decision: use MySQL for the company brain.",
          documentId: "orto:docs/adr/0002-mysql.md#decision",
        },
      ],
      judge,
      confidence: 0.8,
      verify: true,
      projectRoot: root,
    });
    expect(judge.calls).toHaveLength(1);
    expect(result.verified[0]?.stale).toBe(true);
    expect(result.verified[0]?.currentExcerpt).toContain("Postgres");
  });

  it("enables verify from ORTO_JEV_RECALL_VERIFY", async () => {
    const judge = new ScriptedJudge();
    const result = await judgeRecallVerified({
      passages: [STALE],
      judge,
      confidence: 0.8,
      env: { ORTO_JEV_RECALL_VERIFY: "1" },
    });
    expect(result.verifyEnabled).toBe(true);
    expect(result.verified[0]?.stale).toBe(true);
  });

  it("interpret keeps uncertain still_true as not stale", () => {
    const verified = interpretRecallVerify({
      passages: [STALE],
      confidence: 0.8,
      answers: {
        [stillTrueKey(STALE.id)]: { type: "noul", noul: 0.5 },
      },
    });
    expect(verified[0]?.stale).toBe(false);
    expect(verified[0]?.stillTrueBand).toBe("uncertain");
  });

  it("formatRecallVerifyLines includes stale rows and latency", () => {
    const verified = interpretRecallVerify({
      passages: [CURRENT, STALE],
      confidence: 0.8,
      answers: {
        [stillTrueKey(CURRENT.id)]: { type: "noul", noul: 0.95 },
        [stillTrueKey(STALE.id)]: { type: "noul", noul: 0.05 },
      },
    });
    const lines = formatRecallVerifyLines({
      verified,
      latencyMs: 90,
    });
    expect(lines.some((line) => line.includes("1 stale"))).toBe(true);
    expect(
      lines.some((line) => line.includes("latency: 90ms vs unverified recall")),
    ).toBe(true);
    expect(lines.some((line) => line.includes("stale adr-stale"))).toBe(true);
  });
});
