import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractionAggressivenessQuestions,
  interpretExtractionAggressiveness,
  judgeExtractionAggressiveness,
  overrideExtractionAggressiveness,
  parseExtractionAggressiveness,
  suggestExtractionFromSnapshot,
  toRetainExtractionMode,
} from "./extraction-aggressiveness.js";
import { buildRepoShapeSnapshot } from "./repo-shape.js";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";

class ScriptedJudge implements Judge {
  readonly id = "jev" as const;
  readonly calls: JudgeEvaluateInput[] = [];
  choice = "standard";
  confidence = 0.91;

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    return {
      judgeId: "jev",
      answers: {
        extraction: {
          type: "choice",
          choice: this.choice,
          probabilities: { [this.choice]: 1 },
          confidence: this.confidence,
        },
      },
    };
  }
}

describe("extraction aggressiveness", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempRoot(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "orto-extraction-"));
    dirs.push(dir);
    return dir;
  }

  it("maps aggressiveness onto retain_extraction_mode", () => {
    expect(toRetainExtractionMode("conservative")).toBe("concise");
    expect(toRetainExtractionMode("standard")).toBe("verbose");
    expect(toRetainExtractionMode("greedy")).toBe("verbatim");
  });

  it("parses operator overrides", () => {
    expect(parseExtractionAggressiveness("Conservative")).toBe("conservative");
    expect(() => parseExtractionAggressiveness("max")).toThrow(/Invalid extraction/);
  });

  it("suggests conservative for a tiny one-README library", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "README.md"), "# Tiny\n\nOne page.\n", "utf8");
    const snapshot = await buildRepoShapeSnapshot(root);
    expect(suggestExtractionFromSnapshot(snapshot)).toBe("conservative");
  });

  it("suggests standard or greedy for a docs/adr tree", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "README.md"), "# App\n", "utf8");
    await mkdir(join(root, "docs", "adr"), { recursive: true });
    await writeFile(
      join(root, "docs", "adr", "0001-record.md"),
      "# ADR 1\n\nWe chose local-first banks.\n",
      "utf8",
    );

    const small = await buildRepoShapeSnapshot(root);
    expect(suggestExtractionFromSnapshot(small)).toBe("standard");

    await writeFile(
      join(root, "docs", "adr", "0002-record.md"),
      `# ADR 2\n\n${"more durable decision text ".repeat(80)}\n`,
      "utf8",
    );
    await writeFile(
      join(root, "docs", "adr", "0003-record.md"),
      `# ADR 3\n\n${"another durable decision ".repeat(80)}\n`,
      "utf8",
    );
    const dense = await buildRepoShapeSnapshot(root);
    expect(dense.adrCount).toBeGreaterThanOrEqual(3);
    expect(suggestExtractionFromSnapshot(dense)).toBe("greedy");
  });

  it("asks the extraction choice", () => {
    expect(Object.keys(extractionAggressivenessQuestions())).toEqual([
      "extraction",
    ]);
  });

  it("uses a confident Jev choice", async () => {
    const judge = new ScriptedJudge();
    judge.choice = "greedy";
    const decision = await judgeExtractionAggressiveness({
      snapshot: {
        readmeCount: 1,
        docsCount: 2,
        adrCount: 3,
        markdownFileCount: 6,
        docsBytes: 50_000,
        hasAdrTree: true,
      },
      judge,
      confidence: 0.8,
      projectName: "fixture",
    });
    expect(decision.extraction).toBe("greedy");
    expect(decision.source).toBe("jev");
    expect(decision.retainExtractionMode).toBe("verbatim");
    expect(judge.calls[0]?.questions).toEqual(
      extractionAggressivenessQuestions(),
    );
  });

  it("falls back to the snapshot heuristic below confidence", () => {
    const decision = interpretExtractionAggressiveness({
      confidence: 0.8,
      snapshot: {
        readmeCount: 1,
        docsCount: 0,
        adrCount: 0,
        markdownFileCount: 1,
        docsBytes: 0,
        hasAdrTree: false,
      },
      answers: {
        extraction: {
          type: "choice",
          choice: "greedy",
          probabilities: { greedy: 1 },
          confidence: 0.4,
        },
      },
    });
    expect(decision.extraction).toBe("conservative");
    expect(decision.source).toBe("heuristic");
  });

  it("records an operator override", () => {
    const decision = overrideExtractionAggressiveness("conservative");
    expect(decision.source).toBe("override");
    expect(decision.retainExtractionMode).toBe("concise");
  });
});
