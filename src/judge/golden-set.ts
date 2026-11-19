import { extractFromSource } from "../extractor/extract.js";
import type { KnowledgeKind } from "../extractor/types.js";
import type { DurableSource } from "../scanner/durable-sources.js";
import { decideRelevance, relevanceQuestions } from "./relevance.js";
import { buildJevState } from "./state.js";
import type { Judge, JudgeAnswer, JudgeResult } from "./types.js";
import type { KnowledgeKindId } from "./knowledge-kinds.js";

export const GOLDEN_EVAL_GUIDANCE =
  "Tune the offline heuristic. Jev is the yardstick for this eval, not a production dependency.";

export type GoldenAction = "keep" | "skip";
export type GoldenJevAction = GoldenAction | "review";
export type GoldenAnswerSource = "recorded" | "live";

export interface GoldenLabel {
  action: GoldenAction;
  kind: KnowledgeKind;
}

export interface GoldenRecorded {
  isDurable: number;
  isEphemeral: number;
  inScope: number;
  durability: number;
  confidence: number;
  kind: KnowledgeKindId;
}

export interface GoldenSection {
  id: string;
  relativePath: string;
  sourceKind: DurableSource["kind"];
  body: string;
  label: GoldenLabel;
  recorded: GoldenRecorded;
}

export interface GoldenRow {
  id: string;
  labelAction: GoldenAction;
  labelKind: KnowledgeKind;
  heuristicAction: GoldenAction;
  heuristicKind: KnowledgeKind;
  jevAction: GoldenJevAction;
  jevKind: KnowledgeKind;
  source: GoldenAnswerSource;
}

export interface GoldenFinding {
  id: string;
  field: "action" | "kind";
  heuristic: string;
  label: string;
  jev: string;
  guidance: string;
}

export interface GoldenReport {
  rows: GoldenRow[];
  findings: GoldenFinding[];
  heuristicActionMatches: number;
  jevActionMatches: number;
  heuristicKindMatchesOnKeeps: number;
  labeledKeeps: number;
}

const JEV_KIND_TO_LABEL: Record<string, KnowledgeKind> = {
  adr: "decision",
  invariant: "domain",
  public_api: "architecture",
  architecture: "architecture",
  standard: "standard",
  runbook: "other",
  schema: "domain",
  style_pref: "other",
  historical_context: "overview",
  opinion: "other",
  noise: "other",
};

function kept(kind: KnowledgeKindId): GoldenRecorded {
  return {
    isDurable: 0.96,
    isEphemeral: 0.04,
    inScope: 0.95,
    durability: 3,
    confidence: 0.94,
    kind,
  };
}

function skipped(kind: KnowledgeKindId): GoldenRecorded {
  return {
    isDurable: 0.05,
    isEphemeral: 0.96,
    inScope: 0.2,
    durability: 0,
    confidence: 0.94,
    kind,
  };
}

export const GOLDEN_SECTIONS: readonly GoldenSection[] = [
  {
    id: "adr-typescript",
    relativePath: "docs/adr/0001-typescript.md",
    sourceKind: "adr",
    body: `# ADR 0001: Use TypeScript

We decided to use TypeScript for the CLI so config schemas stay typed.
`,
    label: { action: "keep", kind: "decision" },
    recorded: kept("adr"),
  },
  {
    id: "architecture-boundaries",
    relativePath: "docs/architecture.md",
    sourceKind: "docs",
    body: `# Module boundaries

The scanner, extractor, and seeder stay separate. Each module boundary is an architecture boundary.
`,
    label: { action: "keep", kind: "architecture" },
    recorded: kept("architecture"),
  },
  {
    id: "domain-invariant",
    relativePath: "docs/domain.md",
    sourceKind: "docs",
    body: `# Invariants

The bank id is not the container name. This domain invariant is a business rule.
`,
    label: { action: "keep", kind: "domain" },
    recorded: kept("invariant"),
  },
  {
    id: "readme-goal",
    relativePath: "README.md",
    sourceKind: "readme",
    body: `# Goal

The purpose of this project is a local company brain for durable documentation.
`,
    label: { action: "keep", kind: "overview" },
    recorded: kept("historical_context"),
  },
  {
    id: "security-standard",
    relativePath: "docs/security-standard.md",
    sourceKind: "docs",
    body: `# Security standard

API keys must never be committed. This coding standard applies to every package in the repo.
`,
    label: { action: "keep", kind: "standard" },
    recorded: kept("standard"),
  },
  {
    id: "changelog-rename",
    relativePath: "docs/changelog.md",
    sourceKind: "docs",
    body: `# Changelog

We decided to rename the CLI in 0.2. This changelog entry is not an architecture decision record.
`,
    label: { action: "skip", kind: "other" },
    recorded: skipped("noise"),
  },
  {
    id: "install-steps",
    relativePath: "docs/install.md",
    sourceKind: "docs",
    body: `# Installation

Follow these shell steps to install the package on a laptop before the first run.
`,
    label: { action: "skip", kind: "other" },
    recorded: skipped("noise"),
  },
  {
    id: "security-mailbox",
    relativePath: "docs/security.md",
    sourceKind: "docs",
    body: `# Security

Report vulnerabilities to the private list for this repository only.
`,
    label: { action: "skip", kind: "other" },
    recorded: skipped("noise"),
  },
  {
    id: "quick-start",
    relativePath: "docs/quick-start.md",
    sourceKind: "docs",
    body: `# Quick Start

Run the init command in a fresh checkout and follow the printed prompts.
`,
    label: { action: "skip", kind: "other" },
    recorded: skipped("noise"),
  },
  {
    id: "editor-theme",
    relativePath: "docs/editor-theme.md",
    sourceKind: "docs",
    body: `# Editor theme

I prefer a two-space indent in my personal editor settings for this checkout.
`,
    label: { action: "skip", kind: "other" },
    recorded: {
      isDurable: 0.9,
      isEphemeral: 0.08,
      inScope: 0.9,
      durability: 2,
      confidence: 0.94,
      kind: "style_pref",
    },
  },
];

export function scoreGoldenHeuristic(section: GoldenSection): {
  action: GoldenAction;
  kind: KnowledgeKind;
} {
  const extracted = extractFromSource(
    {
      absolutePath: section.relativePath,
      relativePath: section.relativePath,
      kind: section.sourceKind,
    },
    section.body,
  );
  const keptFact = extracted.facts[0];
  if (keptFact !== undefined) {
    return { action: "keep", kind: keptFact.knowledgeKind };
  }
  const skippedFact = extracted.heuristicSkips[0];
  if (skippedFact !== undefined) {
    return { action: "skip", kind: skippedFact.knowledgeKind };
  }
  return { action: "skip", kind: "other" };
}

export function recordedJudgeResult(section: GoldenSection): JudgeResult {
  const recorded = section.recorded;
  const durabilityKey = String(recorded.durability);
  return {
    judgeId: "jev",
    answers: {
      is_durable: noul(recorded.isDurable),
      is_ephemeral: noul(recorded.isEphemeral),
      in_scope: noul(recorded.inScope),
      durability: {
        type: "score",
        score: recorded.durability,
        legend: { [durabilityKey]: durabilityKey },
        probabilities: { [durabilityKey]: recorded.confidence },
        confidence: recorded.confidence,
      },
      kind: {
        type: "choice",
        choice: recorded.kind,
        probabilities: { [recorded.kind]: recorded.confidence },
        confidence: recorded.confidence,
      },
      contains_secret: noul(0.02),
      contains_pii: noul(0.02),
    },
  };
}

export function jevKindToLabel(kind: string | undefined): KnowledgeKind {
  if (kind === undefined) {
    return "other";
  }
  return JEV_KIND_TO_LABEL[kind] ?? "other";
}

export function readGoldenJev(section: GoldenSection, result: JudgeResult): {
  action: GoldenJevAction;
  kind: KnowledgeKind;
} {
  const heuristic = scoreGoldenHeuristic(section);
  const decision = decideRelevance(result, 0.8, {
    heuristicKept: heuristic.action === "keep",
  });
  const action: GoldenJevAction =
    decision.action === "retain"
      ? "keep"
      : decision.action === "skip"
        ? "skip"
        : "review";
  return {
    action,
    kind: jevKindToLabel(decision.kind?.choice),
  };
}

export function goldenFindings(rows: readonly GoldenRow[]): GoldenFinding[] {
  const findings: GoldenFinding[] = [];
  for (const row of rows) {
    const jevAgrees =
      row.jevAction !== "review" && row.jevAction === row.labelAction;
    if (!jevAgrees) {
      continue;
    }
    if (row.heuristicAction !== row.labelAction) {
      findings.push({
        id: row.id,
        field: "action",
        heuristic: row.heuristicAction,
        label: row.labelAction,
        jev: row.jevAction,
        guidance: GOLDEN_EVAL_GUIDANCE,
      });
    }
    if (
      row.labelAction === "keep" &&
      row.jevKind === row.labelKind &&
      row.heuristicKind !== row.labelKind
    ) {
      findings.push({
        id: row.id,
        field: "kind",
        heuristic: row.heuristicKind,
        label: row.labelKind,
        jev: row.jevKind,
        guidance: GOLDEN_EVAL_GUIDANCE,
      });
    }
  }
  return findings;
}

export async function evaluateGoldenSet(input?: {
  judge?: Judge;
  sections?: readonly GoldenSection[];
}): Promise<GoldenReport> {
  const sections = input?.sections ?? GOLDEN_SECTIONS;
  const rows: GoldenRow[] = [];
  for (const section of sections) {
    const heuristic = scoreGoldenHeuristic(section);
    const judged = await judgeSection(section, input?.judge);
    const jev = readGoldenJev(section, judged.result);
    rows.push({
      id: section.id,
      labelAction: section.label.action,
      labelKind: section.label.kind,
      heuristicAction: heuristic.action,
      heuristicKind: heuristic.kind,
      jevAction: jev.action,
      jevKind: jev.kind,
      source: judged.source,
    });
  }
  const labeledKeeps = rows.filter((row) => row.labelAction === "keep").length;
  return {
    rows,
    findings: goldenFindings(rows),
    heuristicActionMatches: rows.filter(
      (row) => row.heuristicAction === row.labelAction,
    ).length,
    jevActionMatches: rows.filter(
      (row) => row.jevAction === row.labelAction,
    ).length,
    heuristicKindMatchesOnKeeps: rows.filter(
      (row) =>
        row.labelAction === "keep" && row.heuristicKind === row.labelKind,
    ).length,
    labeledKeeps,
  };
}

export function formatGoldenReport(report: GoldenReport): string[] {
  const lines = [
    "id | label | heuristic | jev | source",
    ...report.rows.map(
      (row) =>
        `${row.id} | ${row.labelAction} ${row.labelKind} | ${row.heuristicAction} ${row.heuristicKind} | ${row.jevAction} ${row.jevKind} | ${row.source}`,
    ),
    `sections: ${report.rows.length}`,
    `heuristic matches label action: ${report.heuristicActionMatches}/${report.rows.length}`,
    `jev matches label action: ${report.jevActionMatches}/${report.rows.length}`,
    `heuristic matches label kind on keeps: ${report.heuristicKindMatchesOnKeeps}/${report.labeledKeeps}`,
  ];
  if (report.findings.length === 0) {
    lines.push("findings: none");
  } else {
    lines.push("findings:");
    for (const finding of report.findings) {
      lines.push(
        `- ${finding.id} ${finding.field}: heuristic ${finding.heuristic}, label ${finding.label}, jev ${finding.jev}. ${finding.guidance}`,
      );
    }
  }
  lines.push(GOLDEN_EVAL_GUIDANCE);
  return lines;
}

async function judgeSection(
  section: GoldenSection,
  judge: Judge | undefined,
): Promise<{ result: JudgeResult; source: GoldenAnswerSource }> {
  if (judge === undefined || judge.id !== "jev") {
    return { result: recordedJudgeResult(section), source: "recorded" };
  }
  const built = buildJevState({
    path: section.relativePath,
    heading: section.id,
    sectionText: section.body,
  });
  if (!built.ok) {
    return { result: recordedJudgeResult(section), source: "recorded" };
  }
  const result = await judge.evaluate({
    state: built.state,
    questions: relevanceQuestions(),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    return { result: recordedJudgeResult(section), source: "recorded" };
  }
  return { result, source: "live" };
}

function noul(value: number): JudgeAnswer {
  return { type: "noul", noul: value };
}
