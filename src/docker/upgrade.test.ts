import { describe, expect, it } from "vitest";
import {
  assertNoVolumeDeleteArgv,
  buildBackupPlan,
  buildBackupReadme,
  buildRecreatePlan,
  buildVolumeTarballPlan,
  countPendingOperations,
  defaultBackupDir,
  diffBankFactCounts,
  formatEnvForDisplay,
  formatFactCountTable,
  isSecretEnvKey,
  normalizeBankManifest,
  normalizeVersionTag,
  parseDockerInspect,
  parseEnvList,
  pinnedHindsightImage,
  preserveContainerEnv,
  versionsEqual,
} from "./upgrade.js";
import { OrtoError } from "../utils/errors.js";

describe("normalizeVersionTag / pinnedHindsightImage", () => {
  it("pins ghcr.io tags from short versions", () => {
    expect(normalizeVersionTag("0.9.2")).toBe("0.9.2");
    expect(pinnedHindsightImage("0.9.2")).toBe(
      "ghcr.io/vectorize-io/hindsight:0.9.2",
    );
    expect(normalizeVersionTag("v0.9.2")).toBe("0.9.2");
  });

  it("refuses latest", () => {
    expect(() => normalizeVersionTag("latest")).toThrow(OrtoError);
    expect(() => pinnedHindsightImage("latest")).toThrow(/latest/i);
  });

  it("compares versions ignoring v prefix", () => {
    expect(versionsEqual("0.9.2", "v0.9.2")).toBe(true);
    expect(versionsEqual("0.9.2", "0.8.4")).toBe(false);
  });
});

describe("env preservation and masking", () => {
  it("preserves full env list", () => {
    const env = [
      "PATH=/usr/bin",
      "HINDSIGHT_API_TENANT_API_KEY=secret",
      "HINDSIGHT_API_LLM_PROVIDER=ollama",
    ];
    expect(preserveContainerEnv(env)).toEqual(env);
  });

  it("masks secret keys for display", () => {
    expect(isSecretEnvKey("HINDSIGHT_API_TENANT_API_KEY")).toBe(true);
    expect(isSecretEnvKey("HINDSIGHT_API_LLM_PROVIDER")).toBe(false);
    expect(
      formatEnvForDisplay([
        "HINDSIGHT_API_TENANT_API_KEY=super-secret",
        "HINDSIGHT_API_LLM_PROVIDER=ollama",
      ]),
    ).toEqual([
      "HINDSIGHT_API_TENANT_API_KEY=***",
      "HINDSIGHT_API_LLM_PROVIDER=ollama",
    ]);
  });

  it("parses env list into a record", () => {
    expect(
      parseEnvList(["FOO=bar", "BAZ=a=b"]),
    ).toEqual({ FOO: "bar", BAZ: "a=b" });
  });
});

describe("parseDockerInspect + recreate plan", () => {
  const inspectFixture = [
    {
      Name: "/suchconfig-hindsight",
      Config: {
        Image: "ghcr.io/vectorize-io/hindsight:0.8.4",
        Env: [
          "HINDSIGHT_API_LLM_PROVIDER=ollama",
          "HINDSIGHT_API_TENANT_API_KEY=tenant-secret",
          "PATH=/usr/local/bin:/usr/bin",
        ],
      },
      HostConfig: {
        PortBindings: {
          "8888/tcp": [{ HostIp: "", HostPort: "8888" }],
          "9999/tcp": [{ HostPort: "9999" }],
        },
        RestartPolicy: { Name: "unless-stopped" },
      },
      Mounts: [
        {
          Type: "volume",
          Name: "hindsight-data",
          Destination: "/home/hindsight/.pg0",
        },
      ],
    },
  ];

  it("reads volume from live mounts not config guesses", () => {
    const inspected = parseDockerInspect(inspectFixture);
    expect(inspected.name).toBe("suchconfig-hindsight");
    expect(inspected.pg0VolumeName).toBe("hindsight-data");
    expect(inspected.apiHostPort).toBe(8888);
    expect(inspected.uiHostPort).toBe(9999);
  });

  it("builds recreate argv with preserved env and new image", () => {
    const inspected = parseDockerInspect(inspectFixture);
    const plan = buildRecreatePlan({
      inspected,
      targetImage: "ghcr.io/vectorize-io/hindsight:0.9.2",
    });
    expect(plan.argv).toContain("suchconfig-hindsight");
    expect(plan.argv).toContain("hindsight-data:/home/hindsight/.pg0");
    expect(plan.argv).toContain(
      "HINDSIGHT_API_TENANT_API_KEY=tenant-secret",
    );
    expect(plan.argv).toContain("ghcr.io/vectorize-io/hindsight:0.9.2");
    expect(plan.display).toContain("HINDSIGHT_API_TENANT_API_KEY=***");
    expect(plan.display).not.toContain("tenant-secret");
    expect(plan.argv.join(" ")).not.toMatch(/volume rm/);
  });

  it("preserves HINDSIGHT_API_REFLECT_LLM_* overrides across upgrade", () => {
    const baseFixture = inspectFixture[0]!;
    const fixtureWithReflect = [
      {
        ...baseFixture,
        Config: {
          ...baseFixture.Config,
          Env: [
            ...baseFixture.Config.Env,
            "HINDSIGHT_API_LLM_MODEL=qwen2.5:7b",
            "HINDSIGHT_API_LLM_BASE_URL=http://host.docker.internal:11434/v1",
            "HINDSIGHT_API_REFLECT_LLM_PROVIDER=ollama",
            "HINDSIGHT_API_REFLECT_LLM_MODEL=llama3.1:8b",
            "HINDSIGHT_API_REFLECT_LLM_BASE_URL=http://host.docker.internal:11434/v1",
          ],
        },
      },
    ];
    const inspected = parseDockerInspect(fixtureWithReflect);
    const plan = buildRecreatePlan({
      inspected,
      targetImage: "ghcr.io/vectorize-io/hindsight:0.10.3",
    });
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
});

describe("backup plan", () => {
  it("builds default backup dir under home", () => {
    const dir = defaultBackupDir({
      toVersion: "0.9.2",
      timestamp: new Date("2026-03-12T17:30:00.000Z"),
      homeDir: "/Users/me",
    });
    expect(dir).toBe(
      "/Users/me/hindsight-bank-backups/pre-0.9.2-2026-03-12T17-30-00Z",
    );
  });

  it("builds volume tarball docker plan", () => {
    const plan = buildVolumeTarballPlan({
      volumeName: "hindsight-data",
      backupDir: "/tmp/backup",
    });
    expect(plan.argv).toEqual([
      "docker",
      "run",
      "--rm",
      "-v",
      "hindsight-data:/data:ro",
      "-v",
      "/tmp/backup:/backup",
      "alpine",
      "tar",
      "czf",
      "/backup/hindsight-data-volume.tar.gz",
      "-C",
      "/data",
      ".",
    ]);
    expect(plan.hostTarballPath).toBe(
      "/tmp/backup/hindsight-data-volume.tar.gz",
    );
  });

  it("summarizes backup artifacts", () => {
    const summary = buildBackupPlan({
      backupDir: "/tmp/pre",
      volumeName: "hindsight-data",
    });
    expect(summary.manifestPath).toBe("/tmp/pre/banks-manifest.json");
    expect(summary.banksDir).toBe("/tmp/pre/banks");
  });

  it("writes readme without secrets", () => {
    const readme = buildBackupReadme({
      timestamp: "2026-03-12T17:30:00.000Z",
      fromVersion: "0.8.4",
      toVersion: "0.9.2",
      containerName: "hindsight",
      volumeName: "hindsight-data",
      banks: [{ bank_id: "orto", fact_count: 42, name: "Orto" }],
      projectBankId: "orto",
    });
    expect(readme).toContain("0.8.4");
    expect(readme).toContain("0.9.2");
    expect(readme).toContain("orto");
    expect(readme).toContain("project bank");
    expect(readme).not.toMatch(/Bearer |sk-|hsk_/);
  });
});

describe("fact count validation", () => {
  it("normalizes bank manifests", () => {
    expect(
      normalizeBankManifest([
        { bankId: "b", factCount: 2 },
        { bank_id: "a", fact_count: 1, name: "A" },
      ]),
    ).toEqual([
      { bank_id: "a", fact_count: 1, name: "A" },
      { bank_id: "b", fact_count: 2 },
    ]);
  });

  it("diffs fact counts exactly", () => {
    const before = [
      { bank_id: "a", fact_count: 10 },
      { bank_id: "b", fact_count: 5 },
    ];
    const ok = diffBankFactCounts(before, [
      { bank_id: "b", fact_count: 5 },
      { bank_id: "a", fact_count: 10 },
    ]);
    expect(ok.ok).toBe(true);
    expect(formatFactCountTable(ok.rows)).toContain("OK");

    const bad = diffBankFactCounts(before, [
      { bank_id: "a", fact_count: 9 },
      { bank_id: "b", fact_count: 5 },
    ]);
    expect(bad.ok).toBe(false);
    expect(bad.rows.find((r) => r.bank_id === "a")?.ok).toBe(false);
  });

  it("flags missing and unexpected banks", () => {
    const diff = diffBankFactCounts(
      [{ bank_id: "a", fact_count: 1 }],
      [{ bank_id: "c", fact_count: 1 }],
    );
    expect(diff.ok).toBe(false);
    expect(diff.missingAfter).toEqual(["a"]);
    expect(diff.unexpectedAfter).toEqual(["c"]);
  });
});

describe("pending ops + volume delete guard", () => {
  it("counts pending/processing fields", () => {
    expect(
      countPendingOperations([
        { pending_operations: 2, processing_operations: 1 },
        { operations: { pending: 3 } },
      ]),
    ).toBe(6);
  });

  it("rejects volume rm argv", () => {
    expect(() =>
      assertNoVolumeDeleteArgv(["docker", "volume", "rm", "hindsight-data"]),
    ).toThrow(/volume delete/i);
  });
});
