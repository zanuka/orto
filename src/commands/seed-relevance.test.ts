import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KNOWLEDGE_KIND_IDS } from "../judge/knowledge-kinds.js";
import {
  OBSERVATION_RELATIONS,
  type ObservationRelation,
} from "../judge/relations.js";
import type { ChoiceAnswer, Judge, JudgeEvaluateInput, JudgeResult } from "../judge/types.js";
import type { ResolvedJudge } from "../judge/resolve.js";
import type { HindsightClient } from "../providers/hindsight/client.js";
import { seedManifestPath } from "../seeder/manifest.js";
import { runSeed } from "./seed.js";

const ADR = `# ADR 0001: Keep the bank local

## Decision

We keep the Hindsight bank on the machine. This architecture decision is a project invariant and a standard for later integrations.
`;

const CHANGELOG = `# Changelog

## Notes

This generated changelog is a badge wall and a table of contents. The dump mentions the module architecture so a keyword filter keeps the section. It is still a TODO pile.
`;

const BADGES = `# Status

## Shields

This badge wall lists generated status images for the module architecture. It is not a decision or a standard. The section is long enough to clear the heuristic floor.
`;

const TOC = `# Guide

## Map

Table of contents for the generated pages. The word architecture appears here so the heuristic keeps the section. These links are navigation only and not a standard.
`;

const WORKSHOP = `# Notes

## Workshop

Workshop notes from a design session. We discussed the module architecture and whether it belongs in the bank. The section is long enough for the heuristic filter to keep it.
`;

const MIXED_README = `# Fixture

## Architecture

The module boundary is a local-first architecture decision. We chose to keep the Hindsight bank on the machine. This invariant is a project standard for later integrations.

## Changelog

This generated changelog is a badge wall and a table of contents. The notes are a TODO pile, not a decision or a standard.
`;

function kindFor(text: string): { choice: string; confidence: number } {
  if (/changelog|badge wall|table of contents/i.test(text)) {
    return { choice: "noise", confidence: 0.95 };
  }
  if (/personal editor theme/i.test(text)) {
    return { choice: "style_pref", confidence: 0.94 };
  }
  if (/workshop notes/i.test(text)) {
    return { choice: "opinion", confidence: 0.44 };
  }
  if (/kind split/i.test(text)) {
    return { choice: "historical_context", confidence: 0.46 };
  }
  if (/module boundary is a local-first/i.test(text)) {
    return { choice: "architecture", confidence: 0.92 };
  }
  return { choice: "adr", confidence: 0.93 };
}

function kindAnswer(choice: string, confidence: number): ChoiceAnswer {
  const probabilities: Record<string, number> = {};
  const rest = KNOWLEDGE_KIND_IDS.filter((id) => id !== choice);
  const share = rest.length === 0 ? 0 : (1 - confidence) / rest.length;
  for (const id of KNOWLEDGE_KIND_IDS) {
    probabilities[id] = id === choice ? confidence : share;
  }
  return { type: "choice", choice, probabilities, confidence };
}

function answersFor(text: string): JudgeResult {
  const ephemeral = /changelog|badge wall|table of contents/i.test(text);
  const uncertain = /workshop notes/i.test(text);
  const noul = uncertain ? 0.55 : ephemeral ? 0.05 : 0.96;
  const flipped = uncertain ? 0.55 : ephemeral ? 0.97 : 0.04;
  const kind = kindFor(text);
  return {
    judgeId: "jev",
    model: "jev-1.13.0",
    answers: {
      is_durable: { type: "noul", noul },
      is_ephemeral: { type: "noul", noul: flipped },
      in_scope: { type: "noul", noul: uncertain ? 0.55 : 0.93 },
      durability: {
        type: "score",
        score: ephemeral ? 0 : uncertain ? 2 : 4,
        legend: { "0": "Ephemeral", "4": "Constitutional" },
        probabilities: { "0": ephemeral ? 0.9 : 0.1 },
        confidence: uncertain ? 0.4 : 0.91,
      },
      kind: kindAnswer(kind.choice, kind.confidence),
      contains_secret: { type: "noul", noul: 0.02 },
      contains_pii: { type: "noul", noul: 0.02 },
    },
  };
}

class ScriptedJudge implements Judge {
  readonly id = "jev" as const;
  readonly calls: JudgeEvaluateInput[] = [];

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    const state = input.state as { path?: string; text?: string };
    return answersFor(`${state.path ?? ""}\n${state.text ?? ""}`);
  }
}

describe("seed relevance gate", () => {
  const dirs: string[] = [];
  let logs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "orto-seed-jev-"));
    dirs.push(dir);
    await mkdir(join(dir, ".orto", "hindsight"), { recursive: true });
    await mkdir(join(dir, "docs", "adr"), { recursive: true });
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
    await writeFile(
      join(dir, ".orto", "hindsight", "bank-template.json"),
      JSON.stringify({
        version: "1",
        bank: { retain_mission: "Hold durable decisions for Fixture." },
        mental_models: [],
        directives: [],
      }),
      "utf8",
    );
    await writeFile(join(dir, "docs", "adr", "0001-local-bank.md"), ADR, "utf8");
    await writeFile(join(dir, "docs", "changelog.md"), CHANGELOG, "utf8");
    await writeFile(join(dir, "docs", "badges.md"), BADGES, "utf8");
    await writeFile(join(dir, "docs", "contents.md"), TOC, "utf8");
    await writeFile(join(dir, "docs", "notes.md"), WORKSHOP, "utf8");
    return dir;
  }

  function captureLogs(): void {
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((part) => String(part)).join(" "));
    });
  }

  function retainedItems(client: { retain: ReturnType<typeof vi.fn> }): Array<{
    document_id: string;
    tags: string[];
    metadata: Record<string, string>;
  }> {
    return client.retain.mock.calls.flatMap((call) => {
      const request = call[1] as {
        items?: Array<{
          document_id: string;
          tags?: string[];
          metadata?: Record<string, string>;
        }>;
      };
      return (request.items ?? []).map((item) => ({
        document_id: item.document_id,
        tags: item.tags ?? [],
        metadata: item.metadata ?? {},
      }));
    });
  }

  function retainedIds(client: { retain: ReturnType<typeof vi.fn> }): string[] {
    return retainedItems(client).map((item) => item.document_id);
  }

  it("prints path, heading, decisions, scores, confidence, and heuristic-vs-jev on dry-run", async () => {
    const root = await tempProject();
    const judge = new ScriptedJudge();
    const resolved: ResolvedJudge = {
      judgeId: "jev",
      confidence: 0.8,
      strict: false,
      judge,
    };
    captureLogs();

    const result = await runSeed({
      cwd: root,
      dryRun: true,
      resolvedJudge: resolved,
      recallObservations: async () => [],
      extractFacts: async () => [],
    });

    const output = logs.join("\n");
    expect(output).toContain("document_id:");
    expect(output).toContain("path: docs/adr/0001-local-bank.md");
    expect(output).toContain("heading:");
    expect(output).toContain("heuristic-vs-jev:");
    expect(output).toContain("is_durable:");
    expect(output).toContain("is_ephemeral:");
    expect(output).toContain("in_scope:");
    expect(output).toContain("score: durability=");
    expect(output).toContain("confidence=");
    expect(output).toContain("kind: adr confidence=0.93");
    expect(output).toContain("probabilities:");
    expect(output).toContain("adr=0.93");
    expect(output).toContain("decision:");
    expect(output).toMatch(/bank mission: Hold durable decisions for Fixture\./);

    const actions = new Map(
      result.relevance?.rows.map((row) => [row.fact.provenance.sourcePath, row.action]),
    );
    expect(actions.get("docs/adr/0001-local-bank.md")).toBe("retain");
    expect(actions.get("docs/changelog.md")).toBe("skip");
    expect(actions.get("docs/badges.md")).toBe("skip");
    expect(actions.get("docs/contents.md")).toBe("skip");
    expect(actions.get("docs/notes.md")).toBe("review");
    expect(
      result.prepared.factsToRetain.every(
        (fact) => fact.provenance.sourcePath === "docs/adr/0001-local-bank.md",
      ),
    ).toBe(true);
    expect(result.prepared.factsToRetain.length).toBeGreaterThan(0);
    expect(judge.calls.length).toBeGreaterThan(0);
    expect(Object.keys(judge.calls[0]?.questions ?? {})).toEqual([
      "is_durable",
      "is_ephemeral",
      "in_scope",
      "durability",
      "kind",
      "layer",
      "domain",
      "stability",
      "contains_secret",
      "contains_pii",
    ]);
    const kindQuestion = judge.calls[0]?.questions.kind;
    expect(kindQuestion?.type).toBe("choice");
    if (kindQuestion?.type === "choice") {
      expect(kindQuestion.criteria.adr).toMatchObject({
        what: expect.any(String),
        not_for: expect.any(String),
        examples: expect.any(Array),
      });
    }
    const state = judge.calls.find((call) => {
      const body = call.state as { path?: string };
      return body.path === "docs/adr/0001-local-bank.md";
    })?.state as { text?: string; bankMission?: string };
    expect(state.bankMission).toBe("Hold durable decisions for Fixture.");
    expect(state.text).toMatch(/architecture decision/);
  });

  it("live seed retains the ADR and skips only high-confidence rejects", async () => {
    const root = await tempProject();
    const judge = new ScriptedJudge();
    const resolved: ResolvedJudge = {
      judgeId: "jev",
      confidence: 0.8,
      strict: false,
      judge,
    };
    const client = {
      retain: vi.fn(async () => ({ success: true })),
    } as unknown as HindsightClient & { retain: ReturnType<typeof vi.fn> };
    captureLogs();

    const result = await runSeed({
      cwd: root,
      resolvedJudge: resolved,
      client,
    });

    const ids = retainedIds(client);
    expect(ids.some((id) => id.includes("docs/adr/0001-local-bank.md"))).toBe(true);
    expect(ids.some((id) => id.includes("docs/changelog.md"))).toBe(false);
    expect(ids.some((id) => id.includes("docs/badges.md"))).toBe(false);
    expect(ids.some((id) => id.includes("docs/contents.md"))).toBe(false);
    expect(ids.some((id) => id.includes("docs/notes.md"))).toBe(false);
    expect(result.relevance?.rows.some((row) => row.action === "skip")).toBe(true);
    expect(
      result.relevance?.rows.find((row) => row.fact.provenance.sourcePath === "docs/notes.md")
        ?.action,
    ).toBe("review");
    expect(result.retained).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
    const adr = retainedItems(client).find((item) =>
      item.document_id.includes("docs/adr/0001-local-bank.md#"),
    );
    expect(adr?.document_id).toBe(
      "orto:docs/adr/0001-local-bank.md#decision",
    );
    expect(adr?.document_id).not.toContain("knowledge:");
    expect(adr?.tags).toEqual(["orto", "kind:docs", "knowledge:adr"]);
    expect(adr?.metadata.knowledge_kind).toBe("adr");
  });

  it("keeps heuristic candidates when --judge jev is omitted", async () => {
    const root = await tempProject();
    const client = {
      retain: vi.fn(async () => ({ success: true })),
    } as unknown as HindsightClient & { retain: ReturnType<typeof vi.fn> };
    captureLogs();

    const result = await runSeed({
      cwd: root,
      client,
    });

    const ids = retainedIds(client);
    expect(result.relevance).toBeUndefined();
    expect(ids.some((id) => id.includes("docs/adr/0001-local-bank.md"))).toBe(true);
    expect(ids.some((id) => id.includes("docs/changelog.md"))).toBe(true);
    expect(ids.some((id) => id.includes("docs/badges.md"))).toBe(true);
    expect(ids.some((id) => id.includes("docs/contents.md"))).toBe(true);
    expect(ids.some((id) => id.includes("docs/notes.md"))).toBe(true);
    const adr = retainedItems(client).find((item) =>
      item.document_id.includes("docs/adr/0001-local-bank.md#"),
    );
    expect(adr?.tags).toEqual(["orto", "kind:docs", "knowledge:domain"]);
    expect(adr?.tags).not.toContain("knowledge:adr");
    expect(adr?.metadata.knowledge_kind).toBe("domain");
  });

  it("dry-run shows one row per README section and retains only the architecture section", async () => {
    const root = await tempProject();
    await writeFile(join(root, "README.md"), MIXED_README, "utf8");
    const judge = new ScriptedJudge();
    const resolved: ResolvedJudge = {
      judgeId: "jev",
      confidence: 0.8,
      strict: false,
      judge,
    };
    captureLogs();

    const result = await runSeed({
      cwd: root,
      dryRun: true,
      resolvedJudge: resolved,
      recallObservations: async () => [],
      extractFacts: async () => [],
    });

    const output = logs.join("\n");
    const readmeRows =
      result.relevance?.rows.filter(
        (row) => row.fact.provenance.sourcePath === "README.md",
      ) ?? [];
    expect(readmeRows.map((row) => [row.fact.id, row.action])).toEqual([
      ["orto:README.md#architecture", "retain"],
      ["orto:README.md#changelog", "skip"],
    ]);
    expect(output).toContain("document_id: orto:README.md#architecture");
    expect(output).toContain("document_id: orto:README.md#changelog");
    expect(output).toContain("heading: Architecture");
    expect(output).toContain("heading: Changelog");
    expect(output).toMatch(
      /document_id: orto:README.md#changelog[\s\S]*?heuristic: skip/,
    );

    const readmeCalls = judge.calls.filter((call) => {
      const state = call.state as { path?: string };
      return state.path === "README.md";
    });
    expect(readmeCalls).toHaveLength(2);
    const architecture = readmeCalls.find((call) => {
      const state = call.state as { heading?: string };
      return state.heading === "Architecture";
    })?.state as { text?: string };
    const changelog = readmeCalls.find((call) => {
      const state = call.state as { heading?: string };
      return state.heading === "Changelog";
    })?.state as { text?: string };
    expect(architecture.text).toMatch(/local-first/);
    expect(architecture.text).not.toMatch(/badge wall/);
    expect(changelog.text).toMatch(/changelog/i);
    expect(changelog.text).not.toMatch(/local-first/);

    const ids = result.prepared.factsToRetain.map((fact) => fact.id);
    expect(ids).toContain("orto:README.md#architecture");
    expect(ids).not.toContain("orto:README.md#changelog");
  });

  it("live seed retains the README architecture section and skips its changelog section", async () => {
    const root = await tempProject();
    await writeFile(join(root, "README.md"), MIXED_README, "utf8");
    const judge = new ScriptedJudge();
    const resolved: ResolvedJudge = {
      judgeId: "jev",
      confidence: 0.8,
      strict: false,
      judge,
    };
    const client = {
      retain: vi.fn(async () => ({ success: true })),
    } as unknown as HindsightClient & { retain: ReturnType<typeof vi.fn> };

    const result = await runSeed({
      cwd: root,
      resolvedJudge: resolved,
      client,
    });

    const ids = retainedIds(client);
    expect(ids).toContain("orto:README.md#architecture");
    expect(ids).not.toContain("orto:README.md#changelog");
    expect(
      result.relevance?.rows.find((row) => row.fact.id === "orto:README.md#changelog")
        ?.action,
    ).toBe("skip");

    const manifest = JSON.parse(await readFile(seedManifestPath(root), "utf8")) as {
      sources: Record<string, { factIds: string[] }>;
    };
    expect(manifest.sources["README.md"]?.factIds).toContain(
      "orto:README.md#architecture",
    );
    expect(manifest.sources["README.md"]?.factIds ?? []).not.toContain(
      "orto:README.md#changelog",
    );
  });

  it("leaves the changelog section out when --judge jev is omitted", async () => {
    const root = await tempProject();
    await writeFile(join(root, "README.md"), MIXED_README, "utf8");
    const client = {
      retain: vi.fn(async () => ({ success: true })),
    } as unknown as HindsightClient & { retain: ReturnType<typeof vi.fn> };

    const result = await runSeed({
      cwd: root,
      client,
    });

    const ids = retainedIds(client);
    expect(result.relevance).toBeUndefined();
    expect(ids).toContain("orto:README.md#architecture");
    expect(ids).not.toContain("orto:README.md#changelog");
  });

  it("skips style preferences and holds an uncertain kind out of retain", async () => {
    const root = await tempProject();
    await writeFile(
      join(root, "docs", "style.md"),
      `# Preferences

## Editor

This section records a personal editor theme and a two-space indent in scratch notes. It mentions architecture and a standard so the keyword filter keeps it. It is not a project decision or invariant.
`,
      "utf8",
    );
    await writeFile(
      join(root, "docs", "split.md"),
      `# Context

## Background

This kind split section mentions architecture and a standard so the heuristic keeps it. It may be historical context. The paragraph is long enough to score as a candidate.
`,
      "utf8",
    );
    const judge = new ScriptedJudge();
    const resolved: ResolvedJudge = {
      judgeId: "jev",
      confidence: 0.8,
      strict: false,
      judge,
    };
    const client = {
      retain: vi.fn(async () => ({ success: true })),
    } as unknown as HindsightClient & { retain: ReturnType<typeof vi.fn> };
    captureLogs();

    const result = await runSeed({
      cwd: root,
      resolvedJudge: resolved,
      client,
    });

    const output = logs.join("\n");
    expect(output).toContain("kind: style_pref confidence=0.94");
    expect(output).toContain("style preference stays out of the company bank");
    expect(output).toContain("kind: historical_context confidence=0.46");
    expect(output).toContain("kind confidence below 0.80");
    const actions = new Map(
      result.relevance?.rows.map((row) => [row.fact.provenance.sourcePath, row.action]),
    );
    expect(actions.get("docs/style.md")).toBe("skip");
    expect(actions.get("docs/split.md")).toBe("review");
    const ids = retainedIds(client);
    expect(ids.some((id) => id.includes("docs/style.md"))).toBe(false);
    expect(ids.some((id) => id.includes("docs/split.md"))).toBe(false);
    expect(ids.some((id) => id.includes("docs/adr/0001-local-bank.md"))).toBe(true);
  });

  it("dry-run flags a Postgres ADR against a MySQL observation and does not retain", async () => {
    const root = await tempProject();
    const postgres = `# ADR 0008: Use Postgres

## Decision

We use Postgres. This architecture decision retires the previous database. It is a project invariant and a standard for later integrations.
`;
    await writeFile(join(root, "docs", "adr", "0008-postgres.md"), postgres, "utf8");
    const judge: Judge = {
      id: "jev",
      async evaluate(input) {
        const state = input.state as { text?: string; overlaps?: unknown };
        const base = answersFor(state.text ?? "");
        if (input.questions.relation === undefined) {
          return base;
        }
        const choice: ObservationRelation = /We use Postgres/.test(state.text ?? "")
          ? "supersedes"
          : "unrelated";
        expect(state.overlaps).toEqual([
          expect.objectContaining({ id: "obs-mysql", summary: "We use MySQL." }),
        ]);
        return {
          ...base,
          answers: {
            ...base.answers,
            relation: seedRelationAnswer(choice, 0.93),
          },
        };
      },
    };
    const client = {
      retain: vi.fn(async () => ({ success: true })),
    } as unknown as HindsightClient & { retain: ReturnType<typeof vi.fn> };
    captureLogs();

    const result = await runSeed({
      cwd: root,
      dryRun: true,
      resolvedJudge: {
        judgeId: "jev",
        confidence: 0.8,
        strict: false,
        judge,
      },
      client,
      recallObservations: async () => [
        { id: "obs-mysql", text: "We use MySQL." },
      ],
    });

    expect(client.retain).not.toHaveBeenCalled();
    expect(result.retained).toBe(0);
    expect(result.dryRun).toBe(true);
    const output = logs.join("\n");
    expect(output).toContain("relation: supersedes");
    expect(output).toContain("observations: obs-mysql");
    expect(output).toContain("The old observation is not deleted.");
    expect(output).toContain("recalled (read-only)");
    const postgresFact = result.prepared.factsToRetain.find((item) =>
      item.id.includes("0008-postgres.md"),
    );
    expect(postgresFact?.observationLinks).toEqual([
      { relation: "supersedes", observationId: "obs-mysql" },
    ]);
    const local = result.prepared.factsToRetain.find((item) =>
      item.id.includes("0001-local-bank.md"),
    );
    expect(local?.observationLinks).toBeUndefined();
    const ids = result.prepared.factsToRetain.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.includes("0008-postgres.md"))).toHaveLength(1);
  });

  it("skips a pasted key in an ADR, warns with the path, and still retains a clean ADR", async () => {
    const root = await tempProject();
    const secret = "sk-test-abcdefghijklmnopqrstuvwxyz";
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0123456789abcdef\n-----END RSA PRIVATE KEY-----";
    await writeFile(
      join(root, "docs", "adr", "0001.md"),
      `# ADR 0001\n\n## Decision\n\nWe keep the Hindsight bank on the machine. This architecture decision is a project invariant and a standard for later integrations.\n\n${pem}\n\n${secret}\n`,
      "utf8",
    );
    await writeFile(join(root, "docs", "adr", "0002-clean.md"), ADR, "utf8");
    const judge: Judge = {
      id: "jev",
      async evaluate(input) {
        const encoded = JSON.stringify(input.state);
        if (
          encoded.includes(secret) ||
          encoded.includes("BEGIN RSA PRIVATE KEY") ||
          encoded.includes("MIIEow")
        ) {
          throw new Error("secret reached the judge");
        }
        const state = input.state as { text?: string };
        return answersFor(state.text ?? "");
      },
    };
    const client = {
      retain: vi.fn(async () => ({ success: true })),
    } as unknown as HindsightClient & { retain: ReturnType<typeof vi.fn> };
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((part) => String(part)).join(" "));
    });
    captureLogs();

    const result = await runSeed({
      cwd: root,
      resolvedJudge: {
        judgeId: "jev",
        confidence: 0.8,
        strict: false,
        judge,
      },
      client,
      recallObservations: async () => [],
    });

    const stderr = errors.join("\n");
    const stdout = logs.join("\n");
    expect(stderr).toContain("Warning: skipped docs/adr/0001.md: section contains a secret.");
    expect(stderr).not.toContain(secret);
    expect(stderr).not.toContain("MIIEow");
    expect(stdout).not.toContain(secret);
    expect(stdout).not.toContain("MIIEow");
    expect(result.prepared.factsToRetain.some((fact) => fact.id.includes("0001.md"))).toBe(false);
    expect(result.prepared.factsToRetain.some((fact) => fact.id.includes("0002-clean.md"))).toBe(true);
    const retained = retainedItems(client);
    expect(retained.some((item) => item.document_id.includes("0001.md"))).toBe(false);
    expect(retained.some((item) => item.document_id.includes("0002-clean.md"))).toBe(true);
  });

  it("drops an extracted claim the section does not contain and keeps the quote in one Jev call", async () => {
    const root = await tempProject();
    await writeFile(
      join(root, "docs", "adr", "0009-postgres.md"),
      `# ADR 0009: Database

## Decision

We use Postgres. This architecture decision is a project invariant and a standard for later integrations.
`,
      "utf8",
    );
    const citationCalls: JudgeEvaluateInput[] = [];
    const judge: Judge = {
      id: "jev",
      async evaluate(input) {
        if (input.questions.supported_by_source_0 !== undefined) {
          citationCalls.push(input);
          const facts = (input.state as { facts?: Array<{ text?: string }> }).facts ?? [];
          const body: JudgeResult["answers"] = {};
          facts.forEach((fact, index) => {
            const quoted = (fact.text ?? "").includes("Postgres");
            body[`supported_by_source_${index}`] = {
              type: "noul",
              noul: quoted ? 0.96 : 0.05,
            };
            body[`support_${index}`] = supportAnswer(
              quoted ? "quoted" : "unsupported",
              quoted ? 0.95 : 0.94,
            );
          });
          return { judgeId: "jev", answers: body };
        }
        const state = input.state as { path?: string; text?: string };
        return answersFor(`${state.path ?? ""}\n${state.text ?? ""}`);
      },
    };
    const resolved: ResolvedJudge = {
      judgeId: "jev",
      confidence: 0.8,
      strict: false,
      judge,
    };
    const client = {
      retain: vi.fn(async () => ({ success: true })),
    } as unknown as HindsightClient & { retain: ReturnType<typeof vi.fn> };
    captureLogs();

    const dry = await runSeed({
      cwd: root,
      dryRun: true,
      resolvedJudge: resolved,
      client,
      recallObservations: async () => [],
      extractFacts: async (fact) =>
        fact.content.includes("We use Postgres")
          ? ["We use Postgres.", "We use MySQL."]
          : [],
    });

    expect(client.retain).not.toHaveBeenCalled();
    expect(citationCalls).toHaveLength(1);
    expect(Object.keys(citationCalls[0]?.questions ?? {})).toEqual([
      "supported_by_source_0",
      "support_0",
      "supported_by_source_1",
      "support_1",
    ]);
    const preview = dry.prepared.factsToRetain.find((fact) =>
      fact.id.includes("0009-postgres.md"),
    );
    expect(preview?.content).toBe("We use Postgres.");
    expect(preview?.content).not.toContain("MySQL");
    const dryOutput = logs.join("\n");
    expect(dryOutput).toContain("keep quoted");
    expect(dryOutput).toContain("drop unsupported");
    expect(dryOutput).toContain("Extracted facts were previewed (read-only). Nothing was written.");
    expect(dryOutput).toContain("No memories were retained.");

    citationCalls.length = 0;
    captureLogs();
    await runSeed({
      cwd: root,
      resolvedJudge: resolved,
      client,
      recallObservations: async () => [],
      extractFacts: async (fact) =>
        fact.content.includes("We use Postgres")
          ? ["We use Postgres.", "We use MySQL."]
          : [],
    });

    expect(citationCalls).toHaveLength(1);
    const retained = client.retain.mock.calls.flatMap((call) => {
      const request = call[1] as { items?: Array<{ document_id: string; content: string }> };
      return request.items ?? [];
    });
    const postgres = retained.find((item) => item.document_id.includes("0009-postgres.md"));
    expect(postgres?.content).toBe("We use Postgres.");
    expect(JSON.stringify(retained)).not.toContain("MySQL");
  });
});

function supportAnswer(choice: string, confidence: number): ChoiceAnswer {
  const ids = ["quoted", "implied", "unsupported"];
  const probabilities: Record<string, number> = {};
  const rest = ids.filter((id) => id !== choice);
  const share = (1 - confidence) / rest.length;
  for (const id of ids) {
    probabilities[id] = id === choice ? confidence : share;
  }
  return { type: "choice", choice, probabilities, confidence };
}

function seedRelationAnswer(
  choice: ObservationRelation,
  confidence: number,
): ChoiceAnswer {
  const probabilities: Record<string, number> = {};
  const rest = OBSERVATION_RELATIONS.filter((id) => id !== choice);
  const share = (1 - confidence) / rest.length;
  for (const id of OBSERVATION_RELATIONS) {
    probabilities[id] = id === choice ? confidence : share;
  }
  return { type: "choice", choice, probabilities, confidence };
}
