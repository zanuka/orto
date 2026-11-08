import { describe, expect, it } from "vitest";
import {
  createDefaultConfig,
  defaultVolumeName,
  normalizeResourceName,
  OrtoConfigSchema,
  slugify,
} from "./schema.js";

describe("OrtoConfigSchema", () => {
  it("accepts a valid config", () => {
    const config = createDefaultConfig({
      name: "my-app",
      root: ".",
    });
    expect(OrtoConfigSchema.parse(config).bankId).toBe("my-app");
    expect(config.root).toBe(".");
    expect(config.deploymentProfile).toBe("local");
  });

  it("accepts retain-budget weights", () => {
    const parsed = OrtoConfigSchema.parse({
      version: 1,
      name: "fixture",
      provider: "hindsight",
      bankId: "fixture",
      root: ".",
      createdAt: new Date().toISOString(),
      judge: {
        priorityWeights: {
          durability: 0.4,
          centrality: 0.3,
          supersession: 0.15,
          fanout: 0.15,
          secretRisk: 0.25,
        },
      },
    });
    expect(parsed.judge?.priorityWeights?.durability).toBe(0.4);
  });

  it("accepts bankTemplate.extraction overrides", () => {
    const parsed = OrtoConfigSchema.parse({
      version: 1,
      name: "fixture",
      provider: "hindsight",
      bankId: "fixture",
      root: ".",
      createdAt: new Date().toISOString(),
      bankTemplate: { extraction: "conservative" },
    });
    expect(parsed.bankTemplate?.extraction).toBe("conservative");
  });

  it("accepts an optional deploymentProfile", () => {
    const parsed = OrtoConfigSchema.parse({
      version: 1,
      name: "cloud-app",
      provider: "hindsight",
      bankId: "cloud-app",
      root: ".",
      createdAt: new Date().toISOString(),
      deploymentProfile: "hindsight-cloud",
    });
    expect(parsed.deploymentProfile).toBe("hindsight-cloud");
  });

  it("slugifies bank ids", () => {
    const config = createDefaultConfig({
      name: "My Cool App!",
    });
    expect(config.bankId).toBe("my-cool-app");
  });

  it("accepts explicit bankId and docker settings", () => {
    const config = createDefaultConfig({
      name: "My Cool App!",
      bankId: "acme-brain",
      docker: {
        containerName: "hindsight",
        volumeName: "hindsight-data",
      },
    });
    expect(config.bankId).toBe("acme-brain");
    expect(config.docker?.containerName).toBe("hindsight");
    expect(OrtoConfigSchema.parse(config).docker?.volumeName).toBe(
      "hindsight-data",
    );
  });

  it("accepts config without docker (backward compatible)", () => {
    const parsed = OrtoConfigSchema.parse({
      version: 1,
      name: "legacy",
      provider: "hindsight",
      bankId: "legacy",
      root: ".",
      createdAt: new Date().toISOString(),
    });
    expect(parsed.docker).toBeUndefined();
  });

  it("accepts an optional scanner policy", () => {
    const parsed = OrtoConfigSchema.parse({
      version: 1,
      name: "zanuka-web",
      provider: "hindsight",
      bankId: "zanuka-web",
      root: ".",
      createdAt: new Date().toISOString(),
      scanner: {
        include: ["docs/**/*.md", "src/content/works/**/*.mdx"],
        exclude: ["docs/interviews/panel-2/**", "**/_*.mdx"],
        extensions: [".md", ".markdown", ".mdx"],
      },
    });
    expect(parsed.scanner?.include).toEqual([
      "docs/**/*.md",
      "src/content/works/**/*.mdx",
    ]);
  });

  it("rejects scanner extensions that are not dotted suffixes", () => {
    expect(() =>
      OrtoConfigSchema.parse({
        version: 1,
        name: "x",
        provider: "hindsight",
        bankId: "x",
        root: ".",
        createdAt: new Date().toISOString(),
        scanner: { extensions: ["md"] },
      }),
    ).toThrow();
  });

  it("rejects invalid provider", () => {
    expect(() =>
      OrtoConfigSchema.parse({
        version: 1,
        name: "x",
        provider: "other",
        bankId: "x",
        root: "/",
        createdAt: new Date().toISOString(),
      }),
    ).toThrow();
  });
});

describe("slugify / normalizeResourceName", () => {
  it("slugifies display names", () => {
    expect(slugify("My Cool App!")).toBe("my-cool-app");
  });

  it("normalizes resource names", () => {
    expect(normalizeResourceName("Acme Brain")).toBe("acme-brain");
    expect(normalizeResourceName("hindsight")).toBe("hindsight");
  });

  it("derives volume names from container names", () => {
    expect(defaultVolumeName("hindsight")).toBe("hindsight-data");
    expect(defaultVolumeName("team-hindsight")).toBe("team-hindsight-data");
  });
});
