import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "../judge/types.js";
import type { ResolvedJudge } from "../judge/resolve.js";
import { runConfigure } from "./configure.js";

describe("runConfigure mission fit", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "orto-configure-"));
    dirs.push(dir);
    await mkdir(join(dir, ".orto"), { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "fixture", private: true }),
      "utf8",
    );
    await writeFile(
      join(dir, "README.md"),
      "# Fixture\n\nDurable CLI for local memory banks.\n",
      "utf8",
    );
    await writeFile(
      join(dir, ".orto", "config.json"),
      JSON.stringify({
        version: 1,
        name: "fixture",
        provider: "hindsight",
        bankId: "fixture",
        root: ".",
        createdAt: new Date().toISOString(),
        hindsightBaseUrl: "http://localhost:8888",
      }),
      "utf8",
    );
    return dir;
  }

  function resolved(judge: Judge): ResolvedJudge {
    return { judgeId: "jev", confidence: 0.8, strict: false, judge };
  }

  function missionAnswers(score: number, confidence: number): JudgeResult {
    return {
      judgeId: "jev",
      answers: {
        mission_fit: {
          type: "score",
          score,
          legend: {},
          probabilities: {},
          confidence,
        },
        directives_conflict_with_docs: { type: "noul", noul: 0.1 },
      },
    };
  }

  it("default configure without judge writes the template unchanged", async () => {
    const root = await tempProject();
    const result = await runConfigure({
      cwd: root,
      yes: true,
    });
    expect(result.wrote).toBe(true);
    expect(result.skippedWriteForReview).toBe(false);
    expect(result.missionFit).toBeUndefined();
    expect(result.extraction).toBeUndefined();
    expect(result.template.bank.retain_extraction_mode).toBe("verbose");
    const raw = await readFile(result.templatePath, "utf8");
    expect(raw).toContain("retain_mission");
  });

  it("skips write on low mission_fit with high confidence unless --yes", async () => {
    const root = await tempProject();
    const judge: Judge = {
      id: "jev",
      async evaluate(): Promise<JudgeResult> {
        return missionAnswers(0, 0.94);
      },
    };

    const skipped = await runConfigure({
      cwd: root,
      judge: "jev",
      resolvedJudge: resolved(judge),
    });
    expect(skipped.wrote).toBe(false);
    expect(skipped.skippedWriteForReview).toBe(true);
    expect(skipped.configUpdated).toBe(false);
    expect(skipped.missionFit?.needsReview).toBe(true);
    expect(skipped.missionFit?.reason).toContain(
      "review mission before applying",
    );
    await expect(readFile(skipped.templatePath, "utf8")).rejects.toThrow();
  });

  it("writes when low mission_fit review is overridden with --yes", async () => {
    const root = await tempProject();
    const judge: Judge = {
      id: "jev",
      async evaluate(): Promise<JudgeResult> {
        return missionAnswers(1, 0.9);
      },
    };

    const first = await runConfigure({
      cwd: root,
      judge: "jev",
      resolvedJudge: resolved(judge),
      yes: false,
    });
    expect(first.skippedWriteForReview).toBe(true);
    expect(first.wrote).toBe(false);

    const second = await runConfigure({
      cwd: root,
      judge: "jev",
      resolvedJudge: resolved(judge),
      yes: true,
    });
    expect(second.skippedWriteForReview).toBe(false);
    expect(second.wrote).toBe(true);
    expect(second.missionFit?.needsReview).toBe(true);
    const raw = await readFile(second.templatePath, "utf8");
    expect(raw).toContain("retain_mission");
  });

  it("writes when mission_fit is high", async () => {
    const root = await tempProject();
    const judge: Judge = {
      id: "jev",
      async evaluate(): Promise<JudgeResult> {
        return missionAnswers(3, 0.93);
      },
    };

    const result = await runConfigure({
      cwd: root,
      yes: true,
      judge: "jev",
      resolvedJudge: resolved(judge),
    });
    expect(result.wrote).toBe(true);
    expect(result.skippedWriteForReview).toBe(false);
    expect(result.missionFit?.needsReview).toBe(false);
  });
});

describe("runConfigure extraction aggressiveness", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function writeConfig(
    root: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await mkdir(join(root, ".orto"), { recursive: true });
    await writeFile(
      join(root, ".orto", "config.json"),
      JSON.stringify({
        version: 1,
        name: "fixture",
        provider: "hindsight",
        bankId: "fixture",
        root: ".",
        createdAt: new Date().toISOString(),
        hindsightBaseUrl: "http://localhost:8888",
        ...extra,
      }),
      "utf8",
    );
  }

  async function tinyReadmeProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "orto-configure-tiny-"));
    dirs.push(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "fixture", private: true }),
      "utf8",
    );
    await writeFile(join(dir, "README.md"), "# Tiny\n\nOne page.\n", "utf8");
    await writeConfig(dir);
    return dir;
  }

  async function adrTreeProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "orto-configure-adr-"));
    dirs.push(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "fixture", private: true }),
      "utf8",
    );
    await writeFile(join(dir, "README.md"), "# App\n", "utf8");
    await mkdir(join(dir, "docs", "adr"), { recursive: true });
    await writeFile(
      join(dir, "docs", "adr", "0001-record.md"),
      "# ADR 1\n\nWe chose local-first banks.\n",
      "utf8",
    );
    await writeConfig(dir);
    return dir;
  }

  function resolved(judge: Judge): ResolvedJudge {
    return { judgeId: "jev", confidence: 0.8, strict: false, judge };
  }

  class RoutingJudge implements Judge {
    readonly id = "jev" as const;
    readonly calls: JudgeEvaluateInput[] = [];
    extractionChoice = "standard";
    extractionConfidence = 0.92;

    async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
      this.calls.push(input);
      if (input.questions.extraction !== undefined) {
        return {
          judgeId: "jev",
          answers: {
            extraction: {
              type: "choice",
              choice: this.extractionChoice,
              probabilities: { [this.extractionChoice]: 1 },
              confidence: this.extractionConfidence,
            },
          },
        };
      }
      return {
        judgeId: "jev",
        answers: {
          mission_fit: {
            type: "score",
            score: 3,
            legend: {},
            probabilities: {},
            confidence: 0.93,
          },
          directives_conflict_with_docs: { type: "noul", noul: 0.05 },
        },
      };
    }
  }

  it("chooses conservative for a tiny one-README library with --judge jev", async () => {
    const root = await tinyReadmeProject();
    const judge = new RoutingJudge();
    judge.extractionChoice = "conservative";

    const result = await runConfigure({
      cwd: root,
      yes: true,
      judge: "jev",
      resolvedJudge: resolved(judge),
    });

    expect(result.extraction?.extraction).toBe("conservative");
    expect(result.extraction?.source).toBe("jev");
    expect(result.template.bank.retain_extraction_mode).toBe("concise");
    expect(result.configUpdated).toBe(true);
    const config = JSON.parse(
      await readFile(join(root, ".orto", "config.json"), "utf8"),
    ) as { bankTemplate?: { extraction?: string } };
    expect(config.bankTemplate?.extraction).toBe("conservative");
  });

  it("can select standard or greedy for a docs/adr tree", async () => {
    const root = await adrTreeProject();
    const judge = new RoutingJudge();
    judge.extractionChoice = "greedy";

    const result = await runConfigure({
      cwd: root,
      yes: true,
      judge: "jev",
      resolvedJudge: resolved(judge),
    });

    expect(["standard", "greedy"]).toContain(result.extraction?.extraction);
    expect(result.extraction?.extraction).toBe("greedy");
    expect(result.template.bank.retain_extraction_mode).toBe("verbatim");
  });

  it("honors --extraction over Jev", async () => {
    const root = await tinyReadmeProject();
    const judge = new RoutingJudge();
    judge.extractionChoice = "greedy";

    const result = await runConfigure({
      cwd: root,
      yes: true,
      extraction: "conservative",
      judge: "jev",
      resolvedJudge: resolved(judge),
    });

    expect(result.extraction?.source).toBe("override");
    expect(result.extraction?.extraction).toBe("conservative");
    expect(result.template.bank.retain_extraction_mode).toBe("concise");
    expect(
      judge.calls.some((call) => call.questions.extraction !== undefined),
    ).toBe(false);
  });

  it("honors bankTemplate.extraction from config", async () => {
    const root = await tinyReadmeProject();
    await writeConfig(root, {
      bankTemplate: { extraction: "greedy" },
    });

    const result = await runConfigure({
      cwd: root,
      yes: true,
    });

    expect(result.extraction?.source).toBe("override");
    expect(result.extraction?.extraction).toBe("greedy");
    expect(result.template.bank.retain_extraction_mode).toBe("verbatim");
    expect(result.configUpdated).toBe(false);
  });
});
