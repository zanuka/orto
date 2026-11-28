import type { CandidateFact } from "../extractor/types.js";
import { createEmptyManifest } from "./manifest.js";
import { nextManifest, toRetainItems, type PreparedSeed } from "./prepare.js";

describe("toRetainItems", () => {
  it("maps candidate facts to Hindsight retain items with provenance", () => {
    const fact: CandidateFact = {
      id: "orto:README.md#goal",
      title: "Goal",
      content: "Seed durable knowledge.",
      knowledgeKind: "overview",
      score: 5,
      provenance: {
        sourcePath: "README.md",
        kind: "readme",
        commit: "deadbeef",
      },
    };

    const items = toRetainItems([fact]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      document_id: "orto:README.md#goal",
      timestamp: "unset",
      tags: ["orto", "kind:readme", "knowledge:overview"],
    });
    expect(items[0]?.metadata).toStrictEqual({
      source: "README.md",
      commit: "deadbeef",
    });
  });

  it("keeps metadata short so extraction does not collapse a section", () => {
    const fact: CandidateFact = {
      id: "orto:STRATEGY.md#durable-over-complete",
      title: "Durable over complete",
      content: "Orto retains only durable knowledge.",
      knowledgeKind: "standard",
      score: 4,
      provenance: { sourcePath: "STRATEGY.md", kind: "docs" },
    };

    const [item] = toRetainItems([fact]);
    expect(item?.document_id).toBe("orto:STRATEGY.md#durable-over-complete");
    expect(item?.metadata).toStrictEqual({ source: "STRATEGY.md" });
  });

  it("uses catalog tags for a judged kind and keeps the document id", () => {
    const fact: CandidateFact = {
      id: "orto:docs/adr/0001-local-bank.md#document",
      title: "ADR 0001",
      content: "We chose a local bank.",
      knowledgeKind: "decision",
      score: 10,
      bankKind: { id: "adr", tags: ["knowledge:adr"] },
      provenance: {
        sourcePath: "docs/adr/0001-local-bank.md",
        kind: "adr",
      },
    };

    const items = toRetainItems([fact]);
    expect(items[0]?.document_id).toBe(
      "orto:docs/adr/0001-local-bank.md#document",
    );
    expect(items[0]?.document_id).not.toContain("knowledge:");
    expect(items[0]?.tags).toEqual(["orto", "kind:adr", "knowledge:adr"]);
  });
});

describe("nextManifest", () => {
  it("records a settled empty source and drops a reopened one", () => {
    const previous = createEmptyManifest("bank");
    previous.sources["docs/review.md"] = {
      contentHash: "old",
      factIds: ["orto:docs/review.md#old"],
      seededAt: "2020-01-01T00:00:00.000Z",
    };
    const prepared: PreparedSeed = {
      projectRoot: "/tmp/p",
      bankId: "bank",
      sources: [
        {
          relativePath: "docs/changelog.md",
          contentHash: "hash-changelog",
          facts: [],
          heuristicSkips: [],
          skipped: true,
          skipReason: "Jev skipped every section",
          unchanged: false,
        },
        {
          relativePath: "docs/review.md",
          contentHash: "hash-review",
          facts: [],
          heuristicSkips: [],
          skipped: true,
          unchanged: false,
        },
      ],
      factsToRetain: [],
      skippedUnchanged: 0,
      skippedEmpty: 0,
      skippedTombstoned: 0,
    };

    const manifest = nextManifest(previous, "bank", prepared, new Set(), {
      settleEmptyPaths: new Set(["docs/changelog.md"]),
      reopenPaths: new Set(["docs/review.md"]),
    });

    expect(manifest.sources["docs/changelog.md"]?.factIds).toEqual([]);
    expect(manifest.sources["docs/changelog.md"]?.contentHash).toBe(
      "hash-changelog",
    );
    expect(manifest.sources["docs/review.md"]).toBeUndefined();
  });

  it("keeps deferred budget facts pending and clears them after they are retained", () => {
    const prepared: PreparedSeed = {
      projectRoot: "/tmp/p",
      bankId: "bank",
      sources: [
        {
          relativePath: "docs/adr/0001.md",
          contentHash: "hash-adr",
          facts: [
            {
              id: "orto:docs/adr/0001.md#decision",
              title: "Decision",
              content: "Keep it local.",
              knowledgeKind: "decision",
              score: 8,
              provenance: { sourcePath: "docs/adr/0001.md", kind: "adr" },
            },
          ],
          heuristicSkips: [],
          skipped: false,
          unchanged: false,
        },
        {
          relativePath: "docs/changelog.md",
          contentHash: "hash-changelog",
          facts: [
            {
              id: "orto:docs/changelog.md#notes",
              title: "Notes",
              content: "Wording only.",
              knowledgeKind: "overview",
              score: 2,
              provenance: { sourcePath: "docs/changelog.md", kind: "docs" },
            },
          ],
          heuristicSkips: [],
          skipped: false,
          unchanged: false,
        },
      ],
      factsToRetain: [],
      skippedUnchanged: 0,
      skippedEmpty: 0,
      skippedTombstoned: 0,
    };
    const budgetFactIds = new Set([
      "orto:docs/adr/0001.md#decision",
      "orto:docs/changelog.md#notes",
    ]);
    const first = nextManifest(
      createEmptyManifest("bank"),
      "bank",
      prepared,
      new Set(["orto:docs/adr/0001.md#decision"]),
      { budgetFactIds },
    );
    expect(first.sources["docs/changelog.md"]?.pendingFactIds).toEqual([
      "orto:docs/changelog.md#notes",
    ]);
    expect(first.sources["docs/adr/0001.md"]?.factIds).toEqual([
      "orto:docs/adr/0001.md#decision",
    ]);

    const followUp: PreparedSeed = {
      ...prepared,
      sources: [
        {
          relativePath: "docs/changelog.md",
          contentHash: "hash-changelog",
          facts: prepared.sources[1]?.facts ?? [],
          heuristicSkips: [],
          skipped: false,
          unchanged: false,
        },
      ],
    };
    const second = nextManifest(
      first,
      "bank",
      followUp,
      new Set(["orto:docs/changelog.md#notes"]),
      { budgetFactIds: new Set(["orto:docs/changelog.md#notes"]) },
    );
    expect(second.sources["docs/changelog.md"]?.pendingFactIds).toBeUndefined();
    expect(second.sources["docs/changelog.md"]?.factIds).toEqual([
      "orto:docs/changelog.md#notes",
    ]);
    expect(second.sources["docs/adr/0001.md"]?.factIds).toEqual([
      "orto:docs/adr/0001.md#decision",
    ]);
  });
});
