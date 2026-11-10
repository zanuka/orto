import { describe, expect, it } from "vitest";
import type { CandidateFact } from "../extractor/types.js";
import type { Judge, JudgeResult } from "./types.js";
import type { PreparedSeed } from "../seeder/prepare.js";
import { toRetainItems } from "../seeder/prepare.js";
import { KNOWLEDGE_KIND_IDS, knowledgeKindById } from "./knowledge-kinds.js";
import {
  OBSERVATION_RELATIONS,
  RELATION_CHOICE_MAX_OVERLAPS,
  type ObservationRelation,
} from "./relations.js";
import {
  applyRelevanceRows,
  decideRelevance,
  formatRelevanceLines,
  judgeSeedRelevance,
  noulBand,
  relevanceQuestions,
} from "./relevance.js";

const ADR_TEXT = `# ADR 0001: Keep the bank local

## Decision

We keep the Hindsight bank on the machine. This architecture decision is a project invariant and a standard for later integrations.
`;

const CHANGELOG_TEXT = `# Changelog

## Notes

This generated changelog is a badge wall and a table of contents for an API dump. Meeting notes and a TODO pile were pasted under the release heading.
`;

const BADGE_TEXT = `# Badges

## Shields

This badge wall lists generated status images. It is not a decision, invariant, or standard.
`;

const TOC_TEXT = `# Guide

## Map

Table of contents for the generated API dump. The links below are navigation, not architecture.
`;

function fact(input: {
  id: string;
  path: string;
  title: string;
  content: string;
  commit?: string;
}): CandidateFact {
  return {
    id: input.id,
    title: input.title,
    content: input.content,
    knowledgeKind: "decision",
    score: 10,
    provenance: {
      sourcePath: input.path,
      kind: "docs",
      ...(input.commit !== undefined ? { commit: input.commit } : {}),
    },
  };
}

function kindAnswer(choice: string, confidence: number): JudgeResult["answers"][string] {
  const probabilities: Record<string, number> = {};
  const rest = KNOWLEDGE_KIND_IDS.filter((id) => id !== choice);
  const share = rest.length === 0 ? 0 : (1 - confidence) / rest.length;
  for (const id of KNOWLEDGE_KIND_IDS) {
    probabilities[id] = id === choice ? confidence : share;
  }
  if (!KNOWLEDGE_KIND_IDS.includes(choice as (typeof KNOWLEDGE_KIND_IDS)[number])) {
    probabilities[choice] = confidence;
  }
  return {
    type: "choice",
    choice,
    probabilities,
    confidence,
  };
}

function jevResult(input: {
  isDurable: number;
  isEphemeral: number;
  inScope: number;
  durability?: number;
  durabilityConfidence?: number;
  fellBack?: boolean;
  kind?: { choice: string; confidence: number };
  layer?: { choice: string; confidence: number };
  domain?: { choice: string; confidence: number };
  stability?: { choice: string; confidence: number };
  containsSecret?: number;
  containsPii?: number;
  omitSafety?: boolean;
}): JudgeResult {
  return {
    judgeId: "jev",
    ...(input.fellBack ? { fellBackFromJev: true } : {}),
    answers: {
      is_durable: { type: "noul", noul: input.isDurable },
      is_ephemeral: { type: "noul", noul: input.isEphemeral },
      in_scope: { type: "noul", noul: input.inScope },
      ...(input.omitSafety
        ? {}
        : {
            contains_secret: { type: "noul" as const, noul: input.containsSecret ?? 0.02 },
            contains_pii: { type: "noul" as const, noul: input.containsPii ?? 0.02 },
          }),
      durability: {
        type: "score",
        score: input.durability ?? 3,
        legend: { "0": "Ephemeral", "4": "Constitutional" },
        probabilities: { "3": 1 },
        confidence: input.durabilityConfidence ?? 0.91,
      },
      ...(input.kind !== undefined
        ? { kind: kindAnswer(input.kind.choice, input.kind.confidence) }
        : {}),
      ...(input.layer !== undefined
        ? {
            layer: {
              type: "choice" as const,
              choice: input.layer.choice,
              probabilities: { [input.layer.choice]: input.layer.confidence },
              confidence: input.layer.confidence,
            },
          }
        : {}),
      ...(input.domain !== undefined
        ? {
            domain: {
              type: "choice" as const,
              choice: input.domain.choice,
              probabilities: { [input.domain.choice]: input.domain.confidence },
              confidence: input.domain.confidence,
            },
          }
        : {}),
      ...(input.stability !== undefined
        ? {
            stability: {
              type: "choice" as const,
              choice: input.stability.choice,
              probabilities: {
                [input.stability.choice]: input.stability.confidence,
              },
              confidence: input.stability.confidence,
            },
          }
        : {}),
    },
  };
}

describe("relevanceQuestions", () => {
  it("asks durability, ephemerality, scope, and a 0-4 score in one call", () => {
    const questions = relevanceQuestions();
    expect(Object.keys(questions)).toEqual([
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
    const kind = questions.kind;
    expect(kind?.type).toBe("choice");
    if (kind?.type === "choice") {
      const adr = kind.criteria.adr;
      expect(adr).toEqual(knowledgeKindById("adr")?.criteria);
      expect(adr).toMatchObject({
        what: expect.any(String),
        not_for: expect.any(String),
        examples: expect.any(Array),
      });
    }
    expect(questions.durability?.type).toBe("score");
    if (questions.durability?.type === "score") {
      expect(questions.durability.criteria).toHaveLength(5);
      expect(questions.durability.criteria[0]).toMatch(/Ephemeral/);
      expect(questions.durability.criteria[4]).toMatch(/Constitutional/);
    }
  });
});

describe("noulBand", () => {
  it("treats --confidence as a confident yes and 1 - confidence as a confident no", () => {
    expect(noulBand(0.8, 0.8)).toBe("yes");
    expect(noulBand(0.2, 0.8)).toBe("no");
    expect(noulBand(0.5, 0.8)).toBe("uncertain");
    expect(noulBand(0.79, 0.8)).toBe("uncertain");
  });
});

describe("decideRelevance", () => {
  it("does not skip a known ADR when Jev is confident it is durable and in scope", () => {
    const decision = decideRelevance(
      jevResult({ isDurable: 0.96, isEphemeral: 0.04, inScope: 0.93, durability: 4 }),
      0.8,
    );
    expect(decision.action).toBe("retain");
    expect(decision.heuristicVsJev).toBe("agree");
    expect(ADR_TEXT).toMatch(/Decision/);
  });

  it("skips a changelog when Jev is confident it is ephemeral and not durable", () => {
    const decision = decideRelevance(
      jevResult({ isDurable: 0.05, isEphemeral: 0.97, inScope: 0.9, durability: 0 }),
      0.8,
    );
    expect(decision.action).toBe("skip");
    expect(decision.reason).toBe("ephemeral and not durable");
    expect(CHANGELOG_TEXT).toMatch(/changelog/i);
  });

  it("skips badge and TOC fixtures when Jev is confident", () => {
    const badge = decideRelevance(
      jevResult({ isDurable: 0.08, isEphemeral: 0.95, inScope: 0.88, durability: 0 }),
      0.8,
    );
    const toc = decideRelevance(
      jevResult({ isDurable: 0.04, isEphemeral: 0.99, inScope: 0.7, durability: 0 }),
      0.8,
    );
    expect(badge.action).toBe("skip");
    expect(toc.action).toBe("skip");
    expect(BADGE_TEXT).toMatch(/badge wall/i);
    expect(TOC_TEXT).toMatch(/Table of contents/);
  });

  it("skips a confident out-of-scope section", () => {
    const decision = decideRelevance(
      jevResult({ isDurable: 0.92, isEphemeral: 0.05, inScope: 0.1 }),
      0.8,
    );
    expect(decision.action).toBe("skip");
    expect(decision.reason).toBe("out of scope");
  });

  it("keeps a low-confidence answer in review instead of skipping or retaining", () => {
    const decision = decideRelevance(
      jevResult({ isDurable: 0.55, isEphemeral: 0.48, inScope: 0.61 }),
      0.8,
    );
    expect(decision.action).toBe("review");
    expect(decision.heuristicVsJev).toBe("review");
    expect(decision.reason).toMatch(/confidence below 0\.80/);
  });

  it("does not skip when ephemeral is high but durability is uncertain", () => {
    const decision = decideRelevance(
      jevResult({ isDurable: 0.5, isEphemeral: 0.96, inScope: 0.93 }),
      0.8,
    );
    expect(decision.action).toBe("review");
  });

  it("keeps the heuristic candidate when Jev falls back", () => {
    const decision = decideRelevance(
      jevResult({
        isDurable: 0,
        isEphemeral: 0,
        inScope: 0,
        fellBack: true,
      }),
      0.8,
    );
    expect(decision.action).toBe("retain");
    expect(decision.heuristicVsJev).toBe("fallback");
  });

  it("agrees with a heuristic skip and disagrees when Jev would retain it", () => {
    const skipped = decideRelevance(
      jevResult({ isDurable: 0.05, isEphemeral: 0.97, inScope: 0.9, durability: 0 }),
      0.8,
      { heuristicKept: false },
    );
    const promoted = decideRelevance(
      jevResult({ isDurable: 0.96, isEphemeral: 0.04, inScope: 0.93, durability: 4 }),
      0.8,
      { heuristicKept: false },
    );
    expect(skipped.action).toBe("skip");
    expect(skipped.heuristicVsJev).toBe("agree");
    expect(promoted.action).toBe("retain");
    expect(promoted.heuristicVsJev).toBe("disagree");
  });
});

describe("judgeSeedRelevance", () => {
  it("sends path, heading, text, bank mission, and source commit in one fan-out", async () => {
    const calls: Array<{ state: unknown; questionIds: string[] }> = [];
    const judge: Judge = {
      id: "jev",
      async evaluate(input) {
        calls.push({
          state: input.state,
          questionIds: Object.keys(input.questions),
        });
        return jevResult({ isDurable: 0.96, isEphemeral: 0.04, inScope: 0.93 });
      },
    };

    const rows = await judgeSeedRelevance({
      facts: [
        fact({
          id: "orto:docs/adr/0001-local-bank.md#document",
          path: "docs/adr/0001-local-bank.md",
          title: "ADR 0001: Keep the bank local",
          content: ADR_TEXT,
          commit: "abc123",
        }),
      ],
      judge,
      confidence: 0.8,
      mission: "Hold durable decisions for Fixture.",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.questionIds).toEqual([
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
    expect(calls[0]?.state).toEqual({
      path: "docs/adr/0001-local-bank.md",
      heading: "ADR 0001: Keep the bank local",
      text: ADR_TEXT.trim(),
      bankMission: "Hold durable decisions for Fixture.",
      sourceCommit: "abc123",
    });
    expect(rows[0]?.action).toBe("retain");
  });

  it("does not call Jev when the section contains a secret, and skips it", async () => {
    let called = false;
    const judge: Judge = {
      id: "jev",
      async evaluate() {
        called = true;
        return jevResult({ isDurable: 0, isEphemeral: 1, inScope: 0 });
      },
    };
    const rows = await judgeSeedRelevance({
      facts: [
        fact({
          id: "orto:docs/adr/0002.md#document",
          path: "docs/adr/0002.md",
          title: "Decision",
          content: `Keep the bank local.\n\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0123456789abcdef\n-----END RSA PRIVATE KEY-----\n\nsk-test-abcdefghijklmnopqrstuvwxyz`,
        }),
      ],
      judge,
      confidence: 0.8,
      mission: "Hold durable decisions.",
    });
    expect(called).toBe(false);
    expect(rows[0]?.action).toBe("skip");
    expect(rows[0]?.warnSecret).toBe(true);
    expect(rows[0]?.heuristicVsJev).toBe("unjudged");
    expect(rows[0]?.reason).toMatch(/secret pattern/);
    expect(rows[0]?.reason).not.toContain("sk-test-abcdefghijklmnopqrstuvwxyz");
    expect(rows[0]?.reason).not.toContain("MIIEow");
    expect(rows[0]?.reason).not.toContain("BEGIN RSA PRIVATE KEY");
  });

  it("judges a heuristic skip on its own section and does not retain it on fallback", async () => {
    let calls = 0;
    const judge: Judge = {
      id: "jev",
      async evaluate() {
        calls += 1;
        return {
          judgeId: "jev",
          fellBackFromJev: true,
          answers: {},
        };
      },
    };
    const kept = fact({
      id: "orto:README.md#architecture",
      path: "README.md",
      title: "Architecture",
      content: ADR_TEXT,
    });
    const skipped = fact({
      id: "orto:README.md#changelog",
      path: "README.md",
      title: "Changelog",
      content: CHANGELOG_TEXT,
    });
    const rows = await judgeSeedRelevance({
      facts: [kept],
      heuristicSkips: [skipped],
      judge,
      confidence: 0.8,
    });
    expect(calls).toBe(1);
    expect(rows.map((row) => [row.fact.id, row.action])).toEqual([
      ["orto:README.md#architecture", "retain"],
      ["orto:README.md#changelog", "skip"],
    ]);
    expect(rows[1]?.reason).toMatch(/heuristic skip/);
  });

  it("does not retain a heuristic skip when Jev agrees it is ephemeral", async () => {
    const judge: Judge = {
      id: "jev",
      async evaluate(input) {
        const state = input.state as { text?: string };
        const ephemeral = /changelog/i.test(state.text ?? "");
        return jevResult({
          isDurable: ephemeral ? 0.05 : 0.96,
          isEphemeral: ephemeral ? 0.97 : 0.04,
          inScope: 0.93,
          durability: ephemeral ? 0 : 4,
        });
      },
    };
    const architecture = fact({
      id: "orto:README.md#architecture",
      path: "README.md",
      title: "Architecture",
      content: ADR_TEXT,
    });
    const changelog = fact({
      id: "orto:README.md#changelog",
      path: "README.md",
      title: "Changelog",
      content: CHANGELOG_TEXT,
    });
    const rows = await judgeSeedRelevance({
      facts: [architecture],
      heuristicSkips: [changelog],
      judge,
      confidence: 0.8,
      mission: "Hold durable decisions.",
    });
    const prepared: PreparedSeed = {
      projectRoot: "/tmp/p",
      bankId: "fixture",
      sources: [
        {
          relativePath: "README.md",
          contentHash: "hash",
          facts: [architecture],
          heuristicSkips: [changelog],
          skipped: false,
          unchanged: false,
        },
      ],
      factsToRetain: [architecture],
      skippedUnchanged: 0,
      skippedEmpty: 0,
      skippedTombstoned: 0,
    };
    const applied = applyRelevanceRows(prepared, rows);
    expect(rows.map((row) => [row.fact.id, row.action, row.heuristicVsJev])).toEqual([
      ["orto:README.md#architecture", "retain", "agree"],
      ["orto:README.md#changelog", "skip", "agree"],
    ]);
    expect(applied.prepared.factsToRetain.map((item) => item.id)).toEqual([
      "orto:README.md#architecture",
    ]);
    expect(applied.prepared.sources[0]?.heuristicSkips).toEqual([]);
    expect(applied.settleEmptyPaths).toEqual([]);
  });

  it("promotes a heuristic skip when Jev is confident the section is durable", async () => {
    const judge: Judge = {
      id: "jev",
      async evaluate() {
        return jevResult({
          isDurable: 0.96,
          isEphemeral: 0.04,
          inScope: 0.93,
          durability: 4,
        });
      },
    };
    const changelog = fact({
      id: "orto:README.md#changelog",
      path: "README.md",
      title: "Changelog",
      content: ADR_TEXT,
    });
    const rows = await judgeSeedRelevance({
      facts: [],
      heuristicSkips: [changelog],
      judge,
      confidence: 0.8,
    });
    const prepared: PreparedSeed = {
      projectRoot: "/tmp/p",
      bankId: "fixture",
      sources: [
        {
          relativePath: "README.md",
          contentHash: "hash",
          facts: [],
          heuristicSkips: [changelog],
          skipped: true,
          unchanged: false,
        },
      ],
      factsToRetain: [],
      skippedUnchanged: 0,
      skippedEmpty: 1,
      skippedTombstoned: 0,
    };
    const applied = applyRelevanceRows(prepared, rows);
    expect(rows[0]?.action).toBe("retain");
    expect(rows[0]?.heuristicVsJev).toBe("disagree");
    expect(rows[0]?.heuristicKept).toBe(false);
    expect(applied.prepared.factsToRetain.map((item) => item.id)).toEqual([
      "orto:README.md#changelog",
    ]);
    expect(applied.prepared.sources[0]?.facts.map((item) => item.id)).toEqual([
      "orto:README.md#changelog",
    ]);
  });
});

describe("knowledge kind on the relevance call", () => {
  const durable = {
    isDurable: 0.96,
    isEphemeral: 0.04,
    inScope: 0.93,
    durability: 4,
  };

  it("prints kind and probabilities on a dry-run row", () => {
    const decision = decideRelevance(
      jevResult({ ...durable, kind: { choice: "adr", confidence: 0.93 } }),
      0.8,
    );
    const lines = formatRelevanceLines({
      rows: [
        {
          fact: fact({
            id: "orto:docs/adr/0001-local-bank.md#document",
            path: "docs/adr/0001-local-bank.md",
            title: "ADR 0001",
            content: ADR_TEXT,
          }),
          heuristicKept: true,
          ...decision,
        },
      ],
      confidence: 0.8,
      dryRun: true,
    });
    const output = lines.join("\n");
    expect(output).toContain("[dry-run] kind: adr confidence=0.93");
    expect(output).toContain("[dry-run] probabilities:");
    expect(output).toContain("adr=0.93");
    expect(output).toContain("noise=");
    expect(decision.bankKind).toEqual({
      id: "adr",
      tags: ["knowledge:adr"],
    });
  });

  it("skips a confident noise kind even when relevance would retain", () => {
    const decision = decideRelevance(
      jevResult({ ...durable, kind: { choice: "noise", confidence: 0.96 } }),
      0.8,
    );
    expect(decision.action).toBe("skip");
    expect(decision.reason).toBe("knowledge kind noise");
    expect(decision.bankKind).toBeUndefined();
  });

  it("skips a confident style preference instead of retaining it in the company bank", () => {
    const decision = decideRelevance(
      jevResult({
        ...durable,
        kind: { choice: "style_pref", confidence: 0.91 },
      }),
      0.8,
    );
    expect(decision.action).toBe("skip");
    expect(decision.reason).toBe(
      "style preference stays out of the company bank",
    );
    expect(decision.kind?.probabilities.style_pref).toBeCloseTo(0.91);
  });

  it("holds a low-confidence kind for review and does not stamp tags", () => {
    const decision = decideRelevance(
      jevResult({
        ...durable,
        kind: { choice: "adr", confidence: 0.46 },
      }),
      0.8,
    );
    expect(decision.action).toBe("review");
    expect(decision.reason).toBe("kind confidence below 0.80");
    expect(decision.bankKind).toBeUndefined();
  });

  it("keeps an ephemeral skip when the kind is also noise", () => {
    const decision = decideRelevance(
      jevResult({
        isDurable: 0.05,
        isEphemeral: 0.97,
        inScope: 0.9,
        durability: 0,
        kind: { choice: "noise", confidence: 0.99 },
      }),
      0.8,
    );
    expect(decision.action).toBe("skip");
    expect(decision.reason).toBe("ephemeral and not durable");
    expect(decision.kind?.choice).toBe("noise");
  });

  it("stamps retained facts with the catalog tags", () => {
    const decision = decideRelevance(
      jevResult({
        ...durable,
        kind: { choice: "architecture", confidence: 0.92 },
      }),
      0.8,
    );
    const architecture = fact({
      id: "orto:README.md#architecture",
      path: "README.md",
      title: "Architecture",
      content: ADR_TEXT,
    });
    const prepared: PreparedSeed = {
      projectRoot: "/tmp/p",
      bankId: "fixture",
      sources: [
        {
          relativePath: "README.md",
          contentHash: "hash",
          facts: [architecture],
          heuristicSkips: [],
          skipped: false,
          unchanged: false,
        },
      ],
      factsToRetain: [architecture],
      skippedUnchanged: 0,
      skippedEmpty: 0,
      skippedTombstoned: 0,
    };
    const applied = applyRelevanceRows(prepared, [
      { fact: architecture, heuristicKept: true, ...decision },
    ]);
    expect(applied.prepared.factsToRetain[0]?.bankKind).toEqual({
      id: "architecture",
      tags: ["knowledge:architecture"],
    });
    expect(applied.prepared.factsToRetain[0]?.id).toBe(
      "orto:README.md#architecture",
    );
  });

  it("composes layer, domain, and stability tags onto retained bankKind stamps", () => {
    const decision = decideRelevance(
      jevResult({
        ...durable,
        kind: { choice: "architecture", confidence: 0.92 },
        layer: { choice: "platform", confidence: 0.9 },
        domain: { choice: "engineering", confidence: 0.87 },
        stability: { choice: "frozen", confidence: 0.85 },
      }),
      0.8,
    );
    expect(decision.action).toBe("retain");
    expect(decision.bankKind).toEqual({
      id: "architecture",
      tags: [
        "knowledge:architecture",
        "layer:platform",
        "domain:engineering",
        "stability:frozen",
      ],
    });
    expect(decision.retainTags?.map((item) => item.tag)).toEqual([
      "layer:platform",
      "domain:engineering",
      "stability:frozen",
    ]);
    const architecture = fact({
      id: "orto:README.md#architecture",
      path: "README.md",
      title: "Architecture",
      content: ADR_TEXT,
    });
    const items = toRetainItems([
      {
        ...architecture,
        bankKind: decision.bankKind,
      },
    ]);
    expect(items[0]?.tags).toEqual([
      "orto",
      "kind:docs",
      "knowledge:architecture",
      "layer:platform",
      "domain:engineering",
      "stability:frozen",
    ]);
  });
});

const POSTGRES_ADR = `# ADR 0008: Use Postgres

## Decision

We use Postgres.
`;

const MYSQL_OBSERVATION = {
  id: "obs-mysql",
  summary: "We use MySQL.",
};

function relationAnswer(
  choice: ObservationRelation,
  confidence: number,
): JudgeResult["answers"][string] {
  const probabilities: Record<string, number> = {};
  const rest = OBSERVATION_RELATIONS.filter((id) => id !== choice);
  const share = rest.length === 0 ? 0 : (1 - confidence) / rest.length;
  for (const id of OBSERVATION_RELATIONS) {
    probabilities[id] = id === choice ? confidence : share;
  }
  return {
    type: "choice",
    choice,
    probabilities,
    confidence,
  };
}

function postgresFact(): CandidateFact {
  return fact({
    id: "orto:docs/adr/0008-postgres.md#decision",
    path: "docs/adr/0008-postgres.md",
    title: "ADR 0008: Use Postgres",
    content: POSTGRES_ADR,
  });
}

describe("contradiction check against observations", () => {
  const durable = {
    isDurable: 0.96,
    isEphemeral: 0.04,
    inScope: 0.93,
    durability: 4,
    kind: { choice: "adr", confidence: 0.93 },
  };

  it("flags ADR-0008 Postgres against a MySQL observation as supersede or contradict", () => {
    for (const relation of ["supersedes", "contradicts"] as const) {
      const decision = decideRelevance(
        {
          ...jevResult(durable),
          answers: {
            ...jevResult(durable).answers,
            relation: relationAnswer(relation, 0.91),
          },
        },
        0.8,
        { overlaps: [MYSQL_OBSERVATION] },
      );
      expect(decision.action).toBe("retain");
      expect(decision.observationLinks).toEqual([
        { relation, observationId: "obs-mysql" },
      ]);
      const links = decision.observationLinks;
      if (links === undefined) {
        throw new Error("expected observation links");
      }
      const items = toRetainItems([
        { ...postgresFact(), observationLinks: links },
      ]);
      expect(items).toHaveLength(1);
      expect(items[0]?.document_id).toBe(
        "orto:docs/adr/0008-postgres.md#decision",
      );
      expect(items[0]?.metadata[relation]).toBe("obs-mysql");
      expect(POSTGRES_ADR).toMatch(/We use Postgres/);
      expect(MYSQL_OBSERVATION.summary).toBe("We use MySQL.");
    }
  });

  it("does not add a retain item when the relation is unrelated, supports, or extends", () => {
    const section = postgresFact();
    for (const relation of ["unrelated", "supports", "extends"] as const) {
      const decision = decideRelevance(
        {
          ...jevResult(durable),
          answers: {
            ...jevResult(durable).answers,
            relation: relationAnswer(relation, 0.9),
          },
        },
        0.8,
        { overlaps: [MYSQL_OBSERVATION] },
      );
      expect(decision.action).toBe("retain");
      expect(decision.observationLinks).toBeUndefined();
      const items = toRetainItems([{ ...section, ...decision }]);
      expect(items).toHaveLength(1);
      expect(items[0]?.document_id).toBe(section.id);
      expect(items[0]?.metadata.supersedes).toBeUndefined();
      expect(items[0]?.metadata.contradicts).toBeUndefined();
    }
  });

  it("prints the relation on dry-run and does not describe a delete", () => {
    const decision = decideRelevance(
      {
        ...jevResult(durable),
        answers: {
          ...jevResult(durable).answers,
          relation: relationAnswer("supersedes", 0.94),
        },
      },
      0.8,
      { overlaps: [MYSQL_OBSERVATION] },
    );
    const lines = formatRelevanceLines({
      rows: [{ fact: postgresFact(), heuristicKept: true, ...decision }],
      confidence: 0.8,
      dryRun: true,
    });
    const output = lines.join("\n");
    expect(output).toContain("[dry-run] relation: supersedes confidence=0.94");
    expect(output).toContain("[dry-run] observations: obs-mysql");
    expect(output).toContain("The old observation is not deleted.");
    expect(output).not.toMatch(/deleteDocument|deleted the old/);
  });

  it("does not stamp supersession metadata when relation confidence is low", () => {
    const decision = decideRelevance(
      {
        ...jevResult(durable),
        answers: {
          ...jevResult(durable).answers,
          relation: relationAnswer("supersedes", 0.4),
        },
      },
      0.8,
      { overlaps: [MYSQL_OBSERVATION] },
    );
    expect(decision.action).toBe("retain");
    expect(decision.observationLinks).toBeUndefined();
    const output = formatRelevanceLines({
      rows: [{ fact: postgresFact(), heuristicKept: true, ...decision }],
      confidence: 0.8,
      dryRun: true,
    }).join("\n");
    expect(output).toContain("below 0.80, no supersession metadata");
    expect(output).not.toContain("The old observation is not deleted.");
  });

  it("asks one relation choice for a short overlap list and nouls when there are many", async () => {
    const calls: Array<{ questionIds: string[] }> = [];
    const judge: Judge = {
      id: "jev",
      async evaluate(input) {
        calls.push({ questionIds: Object.keys(input.questions) });
        const many = input.questions.conflicts_with_0 !== undefined;
        if (many) {
          return {
            ...jevResult(durable),
            answers: {
              ...jevResult(durable).answers,
              conflicts_with_0: { type: "noul", noul: 0.93 },
              conflicts_with_1: { type: "noul", noul: 0.05 },
              conflicts_with_2: { type: "noul", noul: 0.5 },
              conflicts_with_3: { type: "noul", noul: 0.91 },
            },
          };
        }
        return {
          ...jevResult(durable),
          answers: {
            ...jevResult(durable).answers,
            relation: relationAnswer("supersedes", 0.92),
          },
        };
      },
    };
    const short = await judgeSeedRelevance({
      facts: [postgresFact()],
      judge,
      confidence: 0.8,
      overlapsFor: async () => [MYSQL_OBSERVATION],
    });
    expect(calls[0]?.questionIds).toContain("relation");
    expect(calls[0]?.questionIds).not.toContain("conflicts_with_0");
    expect(short[0]?.observationLinks).toEqual([
      { relation: "supersedes", observationId: "obs-mysql" },
    ]);
    expect(RELATION_CHOICE_MAX_OVERLAPS).toBe(3);

    const manyOverlaps = ["a", "b", "c", "d"].map((id) => ({
      id: `obs-${id}`,
      summary: `We use ${id}.`,
    }));
    const wide = await judgeSeedRelevance({
      facts: [postgresFact()],
      judge,
      confidence: 0.8,
      overlapsFor: async () => manyOverlaps,
    });
    expect(calls[1]?.questionIds).toEqual(
      expect.arrayContaining([
        "conflicts_with_0",
        "conflicts_with_1",
        "conflicts_with_2",
        "conflicts_with_3",
      ]),
    );
    expect(calls[1]?.questionIds).not.toContain("relation");
    expect(wide[0]?.observationLinks).toEqual([
      { relation: "contradicts", observationId: "obs-a" },
      { relation: "contradicts", observationId: "obs-d" },
    ]);
    const links = wide[0]?.observationLinks;
    if (links === undefined) {
      throw new Error("expected observation links");
    }
    const items = toRetainItems([
      { ...postgresFact(), observationLinks: links },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.metadata.contradicts).toBe("obs-a|obs-d");
    expect(items[0]?.metadata.supersedes).toBeUndefined();
  });
});

describe("secret and personal-data second pass", () => {
  const durable = {
    isDurable: 0.96,
    isEphemeral: 0.04,
    inScope: 0.93,
    kind: { choice: "adr" as const, confidence: 0.93 },
  };

  it("does not flag a clean ADR", () => {
    const decision = decideRelevance(jevResult(durable), 0.8);
    expect(decision.action).toBe("retain");
    expect(decision.warnSecret).toBeUndefined();
    expect(decision.safety).toEqual({
      containsSecret: 0.02,
      containsPii: 0.02,
      secretBand: "no",
      piiBand: "no",
    });
  });

  it("skips a confident secret and drops supersession metadata", () => {
    const decision = decideRelevance(
      {
        ...jevResult({ ...durable, containsSecret: 0.96 }),
        answers: {
          ...jevResult({ ...durable, containsSecret: 0.96 }).answers,
          relation: relationAnswer("supersedes", 0.94),
        },
      },
      0.8,
      { overlaps: [MYSQL_OBSERVATION] },
    );
    expect(decision.action).toBe("skip");
    expect(decision.reason).toBe("section contains a secret");
    expect(decision.warnSecret).toBe(true);
    expect(decision.observationLinks).toBeUndefined();
    expect(decision.bankKind).toBeUndefined();
  });

  it("skips confident personal data without a secret warning", () => {
    const decision = decideRelevance(jevResult({ ...durable, containsPii: 0.91 }), 0.8);
    expect(decision.action).toBe("skip");
    expect(decision.reason).toBe("section contains personal data");
    expect(decision.warnSecret).toBeUndefined();
  });

  it("holds a mid-range secret score for review and does not retain", () => {
    const decision = decideRelevance(jevResult({ ...durable, containsSecret: 0.5 }), 0.8);
    expect(decision.action).toBe("review");
    expect(decision.reason).toBe("secret or personal-data check below 0.80");
    expect(decision.bankKind).toBeUndefined();
  });

  it("does not retain when the secret check is missing", () => {
    const decision = decideRelevance(jevResult({ ...durable, omitSafety: true }), 0.8);
    expect(decision.action).toBe("review");
    expect(decision.reason).toBe("secret check did not return a score");
  });

  it("prints the safety scores and not the section text", () => {
    const secret = "sk-test-abcdefghijklmnopqrstuvwxyz";
    const decision = decideRelevance(jevResult({ ...durable, containsSecret: 0.97 }), 0.8);
    const output = formatRelevanceLines({
      rows: [
        {
          fact: fact({
            id: "orto:docs/adr/0001.md#decision",
            path: "docs/adr/0001.md",
            title: "Decision",
            content: `We use Postgres.\n${secret}`,
          }),
          heuristicKept: true,
          ...decision,
        },
      ],
      confidence: 0.8,
      dryRun: true,
    }).join("\n");
    expect(output).toContain("contains_secret: 0.97 yes");
    expect(output).toContain("contains_pii: 0.02 no");
    expect(output).toContain("docs/adr/0001.md");
    expect(output).not.toContain(secret);
  });
});
