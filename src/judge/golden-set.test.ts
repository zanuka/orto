import { describe, expect, it } from "vitest";
import {
  GOLDEN_EVAL_GUIDANCE,
  GOLDEN_SECTIONS,
  evaluateGoldenSet,
  formatGoldenReport,
  goldenFindings,
  recordedJudgeResult,
  scoreGoldenHeuristic,
  type GoldenRow,
} from "./golden-set.js";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";

describe("golden set", () => {
  it("replays recorded answers with no API key", async () => {
    const previous = process.env.ORTO_TYPESAFE_API_KEY;
    delete process.env.ORTO_TYPESAFE_API_KEY;
    try {
      const report = await evaluateGoldenSet();
      expect(report.rows).toHaveLength(GOLDEN_SECTIONS.length);
      expect(report.rows.every((row) => row.source === "recorded")).toBe(true);
      expect(report.jevActionMatches).toBe(report.rows.length);
      expect(report.heuristicActionMatches).toBe(report.rows.length);
      expect(report.heuristicKindMatchesOnKeeps).toBe(report.labeledKeeps);
      expect(report.findings).toEqual([]);
    } finally {
      if (previous !== undefined) {
        process.env.ORTO_TYPESAFE_API_KEY = previous;
      }
    }
  });

  it("keeps a security standard and skips changelog text that says we decided", () => {
    const standard = GOLDEN_SECTIONS.find((section) => section.id === "security-standard");
    const changelog = GOLDEN_SECTIONS.find((section) => section.id === "changelog-rename");
    expect(standard).toBeDefined();
    expect(changelog).toBeDefined();
    expect(scoreGoldenHeuristic(standard!)).toEqual({
      action: "keep",
      kind: "standard",
    });
    expect(scoreGoldenHeuristic(changelog!).action).toBe("skip");
  });

  it("turns a label-and-Jev agreement into a heuristic tweak, not a Jev requirement", () => {
    const row: GoldenRow = {
      id: "synthetic-miss",
      labelAction: "keep",
      labelKind: "decision",
      heuristicAction: "skip",
      heuristicKind: "other",
      jevAction: "keep",
      jevKind: "decision",
      source: "recorded",
    };
    const findings = goldenFindings([row]);
    expect(findings.map((finding) => finding.field)).toEqual(["action", "kind"]);
    expect(findings.every((finding) => finding.guidance === GOLDEN_EVAL_GUIDANCE)).toBe(
      true,
    );
    const rendered = findings.map((finding) => finding.guidance).join(" ");
    expect(rendered).toMatch(/offline heuristic/i);
    expect(rendered).not.toMatch(/require jev/i);
  });

  it("prints heuristic, Jev, and label columns", async () => {
    const report = await evaluateGoldenSet();
    const lines = formatGoldenReport(report);
    expect(lines[0]).toBe("id | label | heuristic | jev | source");
    expect(lines.some((line) => line.startsWith("security-standard | keep standard |"))).toBe(
      true,
    );
    expect(lines.at(-1)).toBe(GOLDEN_EVAL_GUIDANCE);
  });

  it("uses a supplied Jev judge as the live yardstick", async () => {
    const calls: JudgeEvaluateInput[] = [];
    const judge: Judge = {
      id: "jev",
      async evaluate(input): Promise<JudgeResult> {
        calls.push(input);
        const section = GOLDEN_SECTIONS.find((item) =>
          JSON.stringify(input.state).includes(item.relativePath),
        );
        if (section === undefined) {
          throw new Error("missing golden section");
        }
        return recordedJudgeResult(section);
      },
    };
    const report = await evaluateGoldenSet({ judge });
    expect(calls).toHaveLength(GOLDEN_SECTIONS.length);
    expect(report.rows.every((row) => row.source === "live")).toBe(true);
    expect(report.jevActionMatches).toBe(report.rows.length);
    expect(report.findings).toEqual([]);
  });
});
