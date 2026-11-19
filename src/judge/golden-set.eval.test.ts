import { describe, expect, it } from "vitest";
import { createJudge } from "./resolve.js";
import {
  GOLDEN_SECTIONS,
  evaluateGoldenSet,
  formatGoldenReport,
} from "./golden-set.js";

describe("golden eval job", () => {
  it("reports heuristic vs Jev vs labels", async () => {
    const live = process.env.ORTO_EVAL_JUDGE_LIVE === "1";
    const report = live
      ? await evaluateGoldenSet({ judge: createJudge({ judge: "jev" }).judge })
      : await evaluateGoldenSet();
    const lines = formatGoldenReport(report);
    console.log(lines.join("\n"));
    expect(report.rows).toHaveLength(GOLDEN_SECTIONS.length);
    expect(lines[0]).toContain("heuristic");
    expect(lines[0]).toContain("jev");
    expect(lines[0]).toContain("label");
    if (!live) {
      expect(report.rows.every((row) => row.source === "recorded")).toBe(true);
    }
  });
});
