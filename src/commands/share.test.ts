import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runShare } from "./share.js";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "../judge/types.js";

describe("runShare", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempProject(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "orto-share-"));
    dirs.push(root);
    await mkdir(join(root, ".orto"), { recursive: true });
    await writeFile(
      join(root, ".orto", "config.json"),
      JSON.stringify({
        version: 1,
        name: "fixture",
        provider: "hindsight",
        bankId: "fixture-bank",
        root: ".",
        createdAt: new Date().toISOString(),
      }),
      "utf8",
    );
    return root;
  }

  it("writes share.json for lan with baseUrl", async () => {
    const root = await tempProject();
    const result = await runShare({
      cwd: root,
      profile: "lan",
      baseUrl: "http://192.168.1.50:8888",
    });
    expect(result.wrote).toBe(true);
    expect(result.profile).toBe("lan");
    expect(result.baseUrl).toBe("http://192.168.1.50:8888");
    expect(result.serverName).toBe("hindsight-fixture-bank");

    const share = JSON.parse(
      await readFile(join(root, ".orto", "share.json"), "utf8"),
    ) as { profile: string; baseUrl: string };
    expect(share.profile).toBe("lan");
    expect(share.baseUrl).toBe("http://192.168.1.50:8888");

    const config = JSON.parse(
      await readFile(join(root, ".orto", "config.json"), "utf8"),
    ) as { deploymentProfile?: string };
    expect(config.deploymentProfile).toBe("lan");
  });

  it("dry-run does not write share.json", async () => {
    const root = await tempProject();
    await runShare({
      cwd: root,
      profile: "hindsight-cloud",
      dryRun: true,
    });
    await expect(
      readFile(join(root, ".orto", "share.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("public share without --judge keeps the Phase 4 write path", async () => {
    const root = await tempProject();
    await writeFile(
      join(root, "README.md"),
      "SSH to db.internal.corp on 10.0.4.12.\n",
      "utf8",
    );
    const result = await runShare({
      cwd: root,
      profile: "public",
      baseUrl: "https://brain.example.com",
    });
    expect(result.wrote).toBe(true);
    expect(result.profile).toBe("public");
    expect(result.shareSafety).toBeUndefined();
    const share = JSON.parse(
      await readFile(join(root, ".orto", "share.json"), "utf8"),
    ) as { profile: string };
    expect(share.profile).toBe("public");
  });

  it("refuses a public share of an internal runbook when --judge jev is set", async () => {
    const root = await tempProject();
    const judge: Judge = {
      id: "jev",
      async evaluate(): Promise<JudgeResult> {
        throw new Error("private host text must not call TypeSafe");
      },
    };
    await expect(
      runShare({
        cwd: root,
        profile: "public",
        baseUrl: "https://brain.example.com",
        judgeId: "jev",
        judge,
        confidence: 0.8,
        safetyText:
          "Internal runbook. SSH to db.internal.corp. Host 10.0.4.12. Customer at vpn.corp.example.",
      }),
    ).rejects.toThrow(/Refusing public share/);
    await expect(
      readFile(join(root, ".orto", "share.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("allows a public-by-design standards doc when --judge jev agrees", async () => {
    const root = await tempProject();
    const calls: JudgeEvaluateInput[] = [];
    const judge: Judge = {
      id: "jev",
      async evaluate(input): Promise<JudgeResult> {
        calls.push(input);
        return {
          judgeId: "jev",
          answers: {
            safe_outside_trusted_network: { type: "noul", noul: 0.96 },
            leaks_internal_urls_or_customers: { type: "noul", noul: 0.04 },
            sensitivity: {
              type: "score",
              score: 0,
              legend: {},
              probabilities: { "0": 0.95 },
              confidence: 0.95,
            },
            profile_ok: {
              type: "choice",
              choice: "public_ok",
              probabilities: { public_ok: 0.95 },
              confidence: 0.95,
            },
          },
        };
      },
    };
    const result = await runShare({
      cwd: root,
      profile: "public",
      baseUrl: "https://brain.example.com",
      judgeId: "jev",
      judge,
      confidence: 0.8,
      safetyText:
        "These coding standards are public by design. Contributors may share them.",
    });
    expect(result.wrote).toBe(true);
    expect(result.shareSafety?.allowPublic).toBe(true);
    expect(result.shareSafety?.profileOk).toBe("public_ok");
    expect(calls).toHaveLength(1);
  });

  it("does not run the safety gate for a lan profile", async () => {
    const root = await tempProject();
    const judge: Judge = {
      id: "jev",
      async evaluate(): Promise<JudgeResult> {
        throw new Error("lan share must stay on Phase 4 checks");
      },
    };
    const result = await runShare({
      cwd: root,
      profile: "lan",
      baseUrl: "http://192.168.1.50:8888",
      judgeId: "jev",
      judge,
      confidence: 0.8,
      safetyText: "SSH to db.internal.corp",
    });
    expect(result.wrote).toBe(true);
    expect(result.profile).toBe("lan");
    expect(result.shareSafety).toBeUndefined();
  });
});
