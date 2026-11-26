import { describe, expect, it } from "vitest";
import {
  buildDockerStopPlan,
  buildDockerUpPlan,
  formatDockerArgv,
  resolveLlmApiKey,
} from "./hindsight.js";

describe("buildDockerUpPlan", () => {
  it("builds a detached pull-always run for the official image", () => {
    const plan = buildDockerUpPlan({
      llmApiKey: "sk-test",
      llmKeyDisplay: "$OPENAI_API_KEY",
      tenantApiKey: "tenant-secret",
      tenantKeyDisplay: "$ORTO_HINDSIGHT_API_KEY",
    });
    expect(plan.argv[0]).toBe("docker");
    expect(plan.argv).toContain("-d");
    expect(plan.argv).toContain("--pull");
    expect(plan.argv).toContain("always");
    expect(plan.argv).toContain("ghcr.io/vectorize-io/hindsight:latest");
    expect(plan.argv).toContain("HINDSIGHT_API_LLM_API_KEY=sk-test");
    expect(plan.argv).toContain("HINDSIGHT_API_TENANT_API_KEY=tenant-secret");
    expect(plan.argv).toContain("HINDSIGHT_CP_DATAPLANE_API_KEY=tenant-secret");
    expect(plan.display).toContain("HINDSIGHT_API_LLM_API_KEY=$OPENAI_API_KEY");
    expect(plan.display).toContain(
      "HINDSIGHT_API_TENANT_API_KEY=$ORTO_HINDSIGHT_API_KEY",
    );
    expect(plan.display).not.toContain("sk-test");
    expect(plan.display).not.toContain("tenant-secret");
    expect(plan.apiUrl).toBe("http://localhost:8888");
    expect(plan.uiUrl).toBe("http://localhost:9999");
  });

  it("warns when LLM key is missing", () => {
    const plan = buildDockerUpPlan({});
    expect(plan.envHints.some((h) => /LLM API key/i.test(h))).toBe(true);
  });

  it("emits LLM model, base URL, and reflect overrides when set", () => {
    const plan = buildDockerUpPlan({
      llmProvider: "ollama",
      llmModel: "qwen2.5:7b",
      llmBaseUrl: "http://host.docker.internal:11434/v1",
      reflectLlmModel: "llama3.1:8b",
    });
    expect(plan.argv).toContain("HINDSIGHT_API_LLM_PROVIDER=ollama");
    expect(plan.argv).toContain("HINDSIGHT_API_LLM_MODEL=qwen2.5:7b");
    expect(plan.argv).toContain(
      "HINDSIGHT_API_LLM_BASE_URL=http://host.docker.internal:11434/v1",
    );
    expect(plan.argv).toContain("HINDSIGHT_API_REFLECT_LLM_PROVIDER=ollama");
    expect(plan.argv).toContain("HINDSIGHT_API_REFLECT_LLM_MODEL=llama3.1:8b");
    expect(plan.argv).toContain(
      "HINDSIGHT_API_REFLECT_LLM_BASE_URL=http://host.docker.internal:11434/v1",
    );
    expect(plan.display).toContain("HINDSIGHT_API_REFLECT_LLM_PROVIDER=ollama");
    expect(plan.display).toContain(
      "HINDSIGHT_API_REFLECT_LLM_MODEL=llama3.1:8b",
    );
    expect(plan.display).toContain(
      "HINDSIGHT_API_REFLECT_LLM_BASE_URL=http://host.docker.internal:11434/v1",
    );
  });

  it("allows explicit reflect provider and base URL overrides", () => {
    const plan = buildDockerUpPlan({
      llmProvider: "ollama",
      llmModel: "qwen2.5:7b",
      llmBaseUrl: "http://host.docker.internal:11434/v1",
      reflectLlmProvider: "openai",
      reflectLlmModel: "gpt-4o-mini",
      reflectLlmBaseUrl: "https://api.openai.com/v1",
    });
    expect(plan.argv).toContain("HINDSIGHT_API_REFLECT_LLM_PROVIDER=openai");
    expect(plan.argv).toContain("HINDSIGHT_API_REFLECT_LLM_MODEL=gpt-4o-mini");
    expect(plan.argv).toContain(
      "HINDSIGHT_API_REFLECT_LLM_BASE_URL=https://api.openai.com/v1",
    );
  });

  it("omits LLM model and reflect env vars when not set", () => {
    const plan = buildDockerUpPlan({ llmProvider: "ollama" });
    expect(plan.argv.join(" ")).not.toContain("HINDSIGHT_API_LLM_MODEL");
    expect(plan.argv.join(" ")).not.toContain("HINDSIGHT_API_LLM_BASE_URL");
    expect(plan.argv.join(" ")).not.toContain("HINDSIGHT_API_REFLECT_LLM_");
  });
});

describe("buildDockerStopPlan", () => {
  it("force-removes the container", () => {
    const plan = buildDockerStopPlan("hindsight");
    expect(plan.argv).toEqual(["docker", "rm", "-f", "hindsight"]);
  });
});

describe("default names", () => {
  it("uses hindsight as the default container and volume", () => {
    const plan = buildDockerUpPlan({});
    expect(plan.containerName).toBe("hindsight");
    expect(plan.argv).toContain("hindsight");
    expect(plan.argv).toContain("hindsight-data:/home/hindsight/.pg0");
  });
});

describe("formatDockerArgv", () => {
  it("quotes values with spaces", () => {
    expect(formatDockerArgv(["docker", "run", "-e", "FOO=bar baz"])).toContain(
      "'FOO=bar baz'",
    );
  });
});

describe("resolveLlmApiKey", () => {
  it("prefers HINDSIGHT_API_LLM_API_KEY", () => {
    expect(
      resolveLlmApiKey({
        HINDSIGHT_API_LLM_API_KEY: "a",
        OPENAI_API_KEY: "b",
      }),
    ).toBe("a");
  });
});
