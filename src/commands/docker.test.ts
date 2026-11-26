import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveDockerNames,
  resolveDockerSettings,
  runDockerHelper,
} from "./docker.js";

describe("resolveDockerNames", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("prefers explicit CLI container name", async () => {
    const resolved = await resolveDockerNames({
      containerName: "custom-hindsight",
    });
    expect(resolved).toEqual({
      containerName: "custom-hindsight",
      volumeName: "custom-hindsight-data",
    });
  });

  it("reads docker names from project config", async () => {
    const root = await mkdtemp(join(tmpdir(), "orto-docker-"));
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
        docker: {
          containerName: "team-hindsight",
          volumeName: "team-hindsight-data",
        },
      }),
      "utf8",
    );

    const resolved = await resolveDockerNames({ cwd: root });
    expect(resolved).toEqual({
      containerName: "team-hindsight",
      volumeName: "team-hindsight-data",
    });
  });

  it("falls back to hindsight defaults without config", async () => {
    const root = await mkdtemp(join(tmpdir(), "orto-docker-"));
    dirs.push(root);
    const resolved = await resolveDockerNames({ cwd: root });
    expect(resolved).toEqual({
      containerName: "hindsight",
      volumeName: "hindsight-data",
    });
  });

  it("reads model choices from config.docker and prefers CLI flags", async () => {
    const root = await mkdtemp(join(tmpdir(), "orto-docker-"));
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
        docker: {
          containerName: "team-hindsight",
          llmProvider: "ollama",
          llmModel: "qwen2.5:7b",
          llmBaseUrl: "http://host.docker.internal:11434/v1",
          reflectLlmModel: "llama3.1:8b",
        },
      }),
      "utf8",
    );

    const fromConfig = await resolveDockerSettings({ cwd: root });
    expect(fromConfig.llmProvider).toBe("ollama");
    expect(fromConfig.llmModel).toBe("qwen2.5:7b");
    expect(fromConfig.llmBaseUrl).toBe("http://host.docker.internal:11434/v1");
    expect(fromConfig.reflectLlmModel).toBe("llama3.1:8b");

    const overridden = await resolveDockerSettings({
      cwd: root,
      reflectLlmModel: "qwen3:8b",
    });
    expect(overridden.reflectLlmModel).toBe("qwen3:8b");

    const dryRun = await runDockerHelper({
      action: "up",
      dryRun: true,
      cwd: root,
    });
    expect(dryRun.display).toContain("HINDSIGHT_API_REFLECT_LLM_PROVIDER=ollama");
    expect(dryRun.display).toContain(
      "HINDSIGHT_API_REFLECT_LLM_MODEL=llama3.1:8b",
    );
    expect(dryRun.display).toContain(
      "HINDSIGHT_API_REFLECT_LLM_BASE_URL=http://host.docker.internal:11434/v1",
    );
  });
});
