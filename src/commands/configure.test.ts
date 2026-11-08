import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Judge, JudgeResult } from "../judge/types.js";
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

  it("default configure without judge writes the template unchanged", async () => {
    const root = await tempProject();
    const result = await runConfigure({
      cwd: root,
      yes: true,
    });
    expect(result.wrote).toBe(true);
    expect(result.skippedWriteForReview).toBe(false);
    expect(result.missionFit).toBeUndefined();
    const raw = await readFile(result.templatePath, "utf8");
    expect(raw).toContain("retain_mission");
  });

  it("skips write on low mission_fit with high confidence unless --yes", async () => {
    const root = await tempProject();
    const judge: Judge = {
      id: "jev",
      async evaluate(): Promise<JudgeResult> {
        return {
          judgeId: "jev",
          answers: {
            mission_fit: {
              type: "score",
              score: 0,
              legend: {},
              probabilities: {},
              confidence: 0.94,
            },
            directives_conflict_with_docs: { type: "noul", noul: 0.1 },
          },
        };
      },
    };

    const skipped = await runConfigure({
      cwd: root,
      judge: "jev",
      resolvedJudge: resolved(judge),
    });
    expect(skipped.wrote).toBe(false);
    expect(skipped.skippedWriteForReview).toBe(true);
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
        return {
          judgeId: "jev",
          answers: {
            mission_fit: {
              type: "score",
              score: 1,
              legend: {},
              probabilities: {},
              confidence: 0.9,
            },
            directives_conflict_with_docs: { type: "noul", noul: 0.2 },
          },
        };
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
