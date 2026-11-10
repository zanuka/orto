import type {
  BankKindStamp,
  CandidateFact,
  ObservationLink,
} from "../extractor/types.js";
import type { PreparedSeed } from "../seeder/prepare.js";
import { knowledgeKindById, knowledgeKindQuestion, listKnowledgeKinds } from "./knowledge-kinds.js";
import { priorityQuestions, readPrioritySignals } from "./priority.js";
import { interpretRelation, OBSERVATION_RELATIONS, relationQuestions } from "./relations.js";
import {
  composeRetainTags,
  retainTagQuestions,
  type RetainTagAxisRead,
} from "./retain-tags.js";
import { safetyQuestions } from "./safety.js";
import { buildJevState, containsInlineSecret, type JevOverlap } from "./state.js";
import type {
  Judge,
  JudgeAnswer,
  JudgeQuestion,
  JudgeResult,
  ScoreAnswer,
} from "./types.js";

const SOURCE_COMMIT_MAX_CHARS = 64;

export type NoulBand = "yes" | "no" | "uncertain";

export type RelevanceAction = "retain" | "skip" | "review";

export type HeuristicVsJev =
  | "agree"
  | "disagree"
  | "review"
  | "fallback"
  | "unjudged";

export interface RelevanceState {
  path: string;
  heading?: string;
  text: string;
  bankMission?: string;
  sourceCommit?: string;
  overlaps?: JevOverlap[];
}

export interface RelevanceRow {
  fact: CandidateFact;
  heuristicKept: boolean;
  action: RelevanceAction;
  reason: string;
  heuristicVsJev: HeuristicVsJev;
  model?: string;
  bands?: {
    isDurable: NoulBand;
    isEphemeral: NoulBand;
    inScope: NoulBand;
  };
  noul?: {
    isDurable: number;
    isEphemeral: number;
    inScope: number;
  };
  durability?: {
    score: number;
    confidence: number;
  };
  centrality?: {
    score: number;
    confidence: number;
  };
  supersedesExisting?: number;
  fanout?: {
    score: number;
    confidence: number;
  };
  kind?: {
    choice: string;
    confidence: number;
    probabilities: Record<string, number>;
  };
  bankKind?: BankKindStamp;
  retainTags?: RetainTagAxisRead[];
  relation?: {
    choice: string;
    confidence: number;
    probabilities: Record<string, number>;
    observationIds: string[];
  };
  conflicts?: Array<{
    observationId: string;
    noul: number;
    band: NoulBand;
  }>;
  observationLinks?: ObservationLink[];
  safety?: {
    containsSecret: number;
    containsPii: number;
    secretBand: NoulBand;
    piiBand: NoulBand;
  };
  warnSecret?: boolean;
}

export interface RelevanceReport {
  confidence: number;
  mission?: string;
  rows: RelevanceRow[];
  settleEmptyPaths: string[];
  reopenPaths: string[];
}

export function relevanceQuestions(): Record<string, JudgeQuestion> {
  return {
    is_durable: {
      type: "noul",
      instructions:
        "Is this section a durable project decision, invariant, architecture note, or standard?",
      criteria: {
        true: "A decision, invariant, architecture note, or coding standard that should outlive one session.",
        false: "Not a decision, invariant, architecture note, or standard.",
      },
    },
    is_ephemeral: {
      type: "noul",
      instructions:
        "Is this section ephemeral: a changelog, table of contents, generated API dump, badge wall, meeting notes, or TODO pile?",
      criteria: {
        true: "Changelog, table of contents, badge wall, generated API dump, meeting notes, or a TODO pile.",
        false: "Not ephemeral boilerplate.",
      },
    },
    in_scope: {
      type: "noul",
      instructions: "Does this section match the bank mission?",
      criteria: {
        true: "The section belongs in this bank's mission.",
        false: "The section is outside this bank's mission.",
      },
    },
    durability: {
      type: "score",
      instructions:
        "How durable is this section as project knowledge? 0 is ephemeral and 4 is constitutional.",
      criteria: [
        "Ephemeral: changelog, badge wall, table of contents, generated API dump, meeting notes, or a TODO pile",
        "Weak: temporary notes that should not enter the bank",
        "Contextual: useful background that is not a decision or standard",
        "Durable: a decision, invariant, architecture note, or standard",
        "Constitutional: a constraint the project must keep",
      ],
    },
    kind: knowledgeKindQuestion(),
    ...retainTagQuestions(),
    ...safetyQuestions(),
  };
}

export function noulBand(noul: number, confidence: number): NoulBand {
  if (!Number.isFinite(noul) || noul < 0 || noul > 1) {
    return "uncertain";
  }
  const yes = noul + 1e-9 >= confidence;
  const no = noul <= 1 - confidence + 1e-9;
  if (yes === no) {
    return "uncertain";
  }
  return yes ? "yes" : "no";
}

export function decideRelevance(
  result: JudgeResult,
  confidence: number,
  options?: { heuristicKept?: boolean; overlaps?: readonly JevOverlap[] },
): Omit<RelevanceRow, "fact" | "heuristicKept"> {
  const heuristicKept = options?.heuristicKept ?? true;
  const overlaps = options?.overlaps ?? [];
  if (result.fellBackFromJev || result.judgeId !== "jev") {
    return {
      action: heuristicKept ? "retain" : "skip",
      reason: heuristicKept
        ? "TypeSafe unavailable; kept the heuristic candidate"
        : "TypeSafe unavailable; left the heuristic skip in place",
      heuristicVsJev: "fallback",
      ...(result.model !== undefined ? { model: result.model } : {}),
    };
  }

  const isDurable = readNoul(result.answers.is_durable);
  const isEphemeral = readNoul(result.answers.is_ephemeral);
  const inScope = readNoul(result.answers.in_scope);
  const durability = readScore(result.answers.durability);
  const base = {
    ...(result.model !== undefined ? { model: result.model } : {}),
    ...(durability !== undefined ? { durability } : {}),
  };

  const kind = readKind(result.answers.kind);
  if (isDurable === undefined || isEphemeral === undefined || inScope === undefined) {
    return finishDecision(
      applyKnowledgeKind(
        {
          ...base,
          action: "review",
          reason: `confidence below ${formatConfidence(confidence)}`,
          heuristicVsJev: "review",
        },
        kind,
        confidence,
        heuristicKept,
      ),
      result,
      overlaps,
      confidence,
      heuristicKept,
    );
  }

  const bands = {
    isDurable: noulBand(isDurable, confidence),
    isEphemeral: noulBand(isEphemeral, confidence),
    inScope: noulBand(inScope, confidence),
  };
  const scored = {
    ...base,
    bands,
    noul: {
      isDurable,
      isEphemeral,
      inScope,
    },
  };

  const reasons: string[] = [];
  if (bands.isEphemeral === "yes" && bands.isDurable === "no") {
    reasons.push("ephemeral and not durable");
  }
  if (bands.inScope === "no") {
    reasons.push("out of scope");
  }
  if (reasons.length > 0) {
    return finishDecision(
      applyKnowledgeKind(
        {
          ...scored,
          action: "skip",
          reason: reasons.join("; "),
          heuristicVsJev: versusHeuristic("skip", heuristicKept),
        },
        kind,
        confidence,
        heuristicKept,
      ),
      result,
      overlaps,
      confidence,
      heuristicKept,
    );
  }

  if (
    bands.isDurable === "uncertain" ||
    bands.isEphemeral === "uncertain" ||
    bands.inScope === "uncertain"
  ) {
    return finishDecision(
      applyKnowledgeKind(
        {
          ...scored,
          action: "review",
          reason: `confidence below ${formatConfidence(confidence)}`,
          heuristicVsJev: "review",
        },
        kind,
        confidence,
        heuristicKept,
      ),
      result,
      overlaps,
      confidence,
      heuristicKept,
    );
  }

  return finishDecision(
    applyKnowledgeKind(
      {
        ...scored,
        action: "retain",
        reason: "not a high-confidence reject",
        heuristicVsJev: versusHeuristic("retain", heuristicKept),
      },
      kind,
      confidence,
      heuristicKept,
    ),
    result,
    overlaps,
    confidence,
    heuristicKept,
  );
}

export async function judgeSeedRelevance(input: {
  facts: readonly CandidateFact[];
  heuristicSkips?: readonly CandidateFact[];
  judge: Judge;
  confidence: number;
  mission?: string;
  overlapsFor?: (fact: CandidateFact) => Promise<readonly JevOverlap[]>;
  includePriority?: boolean;
}): Promise<RelevanceRow[]> {
  const rows: RelevanceRow[] = [];
  let fellBack = false;

  const judgeFact = async (
    fact: CandidateFact,
    heuristicKept: boolean,
  ): Promise<void> => {
    if (fellBack) {
      rows.push(fallbackRow(fact, heuristicKept));
      return;
    }

    const secret =
      containsInlineSecret(fact.content) ||
      containsInlineSecret(fact.title) ||
      containsInlineSecret(fact.provenance.sourcePath);
    const lookedUp =
      input.overlapsFor !== undefined && !secret
        ? await input.overlapsFor(fact)
        : [];
    const built = buildJevState({
      path: fact.provenance.sourcePath,
      heading: fact.title,
      sectionText: fact.content,
      ...(input.mission !== undefined ? { mission: input.mission } : {}),
      ...(lookedUp.length > 0 ? { overlaps: lookedUp } : {}),
    });
    if (!built.ok) {
      if (built.reason === "inline-secret") {
        rows.push({
          fact,
          heuristicKept,
          action: "skip",
          reason: built.message,
          heuristicVsJev: "unjudged",
          warnSecret: true,
        });
        return;
      }
      rows.push({
        fact,
        heuristicKept,
        action: heuristicKept ? "retain" : "skip",
        reason: built.message,
        heuristicVsJev: "unjudged",
      });
      return;
    }

    const sentOverlaps = built.state.overlaps ?? [];
    const questions = {
      ...relevanceQuestions(),
      ...(input.includePriority ? priorityQuestions() : {}),
      ...relationQuestions(sentOverlaps),
    };
    const state = toRelevanceState(built.state, fact.provenance.commit);
    const result = await input.judge.evaluate({ state, questions });
    if (result.fellBackFromJev) {
      fellBack = true;
    }
    const decision = decideRelevance(result, input.confidence, {
      heuristicKept,
      overlaps: sentOverlaps,
    });
    const signals = readPrioritySignals(result.answers);
    rows.push({ fact, heuristicKept, ...decision, ...signals });
  };

  for (const fact of input.facts) {
    await judgeFact(fact, true);
  }
  for (const fact of input.heuristicSkips ?? []) {
    await judgeFact(fact, false);
  }

  return rows;
}

export function applyRelevanceRows(
  prepared: PreparedSeed,
  rows: readonly RelevanceRow[],
): {
  prepared: PreparedSeed;
  settleEmptyPaths: string[];
  reopenPaths: string[];
} {
  const judgedIds = new Set(rows.map((row) => row.fact.id));
  const retainIds = new Set(
    rows.filter((row) => row.action === "retain").map((row) => row.fact.id),
  );
  const bankKindById = new Map<string, BankKindStamp>();
  const linksById = new Map<string, ObservationLink[]>();
  for (const row of rows) {
    if (row.action !== "retain") {
      continue;
    }
    if (row.bankKind !== undefined) {
      bankKindById.set(row.fact.id, row.bankKind);
    }
    if (row.observationLinks !== undefined && row.observationLinks.length > 0) {
      linksById.set(row.fact.id, row.observationLinks);
    }
  }
  const stamp = (fact: CandidateFact): CandidateFact => {
    const bankKind = bankKindById.get(fact.id);
    const links = linksById.get(fact.id);
    if (bankKind === undefined && links === undefined) {
      return fact;
    }
    return {
      ...fact,
      ...(bankKind !== undefined
        ? { bankKind: { id: bankKind.id, tags: [...bankKind.tags] } }
        : {}),
      ...(links !== undefined
        ? {
            observationLinks: links.map((link) => ({
              relation: link.relation,
              observationId: link.observationId,
            })),
          }
        : {}),
    };
  };
  const heuristicSkipIds = new Set(
    prepared.sources.flatMap((source) =>
      source.heuristicSkips.map((fact) => fact.id),
    ),
  );
  const byPath = new Map<string, RelevanceRow[]>();
  for (const row of rows) {
    const path = row.fact.provenance.sourcePath;
    const group = byPath.get(path) ?? [];
    group.push(row);
    byPath.set(path, group);
  }

  const settleEmptyPaths: string[] = [];
  const reopenPaths: string[] = [];
  const sources = prepared.sources.map((source) => {
    const group = byPath.get(source.relativePath);
    if (group === undefined || source.unchanged) {
      return source;
    }
    const retained = [
      ...source.facts
        .filter((fact) => !judgedIds.has(fact.id) || retainIds.has(fact.id))
        .map(stamp),
      ...source.heuristicSkips.filter((fact) => retainIds.has(fact.id)).map(stamp),
    ];
    const hasReview = group.some((row) => row.action === "review");
    if (hasReview) {
      reopenPaths.push(source.relativePath);
    } else if (retained.length === 0) {
      settleEmptyPaths.push(source.relativePath);
    }
    const next: PreparedSeed["sources"][number] = {
      ...source,
      facts: retained,
      heuristicSkips: [],
      skipped: retained.length === 0,
    };
    if (retained.length === 0) {
      next.skipReason = hasReview
        ? "Jev held every section for review"
        : "Jev skipped every section";
    } else {
      delete next.skipReason;
    }
    return next;
  });

  return {
    prepared: {
      ...prepared,
      sources,
      factsToRetain: [
        ...prepared.factsToRetain
          .filter((fact) => !judgedIds.has(fact.id) || retainIds.has(fact.id))
          .map(stamp),
        ...rows
          .filter(
            (row) =>
              row.action === "retain" && heuristicSkipIds.has(row.fact.id),
          )
          .map((row) => stamp(row.fact)),
      ],
    },
    settleEmptyPaths,
    reopenPaths,
  };
}

export function formatRelevanceLines(input: {
  rows: readonly RelevanceRow[];
  confidence: number;
  dryRun: boolean;
  mission?: string;
}): string[] {
  const prefix = input.dryRun ? "[dry-run] " : "";
  const model = input.rows.find((row) => row.model !== undefined)?.model;
  const confidence = formatConfidence(input.confidence);
  const header =
    model !== undefined
      ? `${prefix}Jev relevance gate (confidence ${confidence}, model ${model}):`
      : `${prefix}Jev relevance gate (confidence ${confidence}):`;
  const lines = [header, ""];
  if (input.mission !== undefined && input.mission.trim() !== "") {
    const mission = input.mission.replace(/\s+/g, " ").trim();
    const shown = mission.length > 160 ? `${mission.slice(0, 157)}...` : mission;
    lines.push(`${prefix}bank mission: ${shown}`);
  } else {
    lines.push(
      `${prefix}bank mission: (none). Run \`orto configure\` so in_scope can use the retain mission.`,
    );
  }
  lines.push("");

    for (const row of input.rows) {
    lines.push(...formatRow(row, prefix, input.confidence));
    lines.push("");
  }

  const retained = input.rows.filter((row) => row.action === "retain").length;
  const skipped = input.rows.filter((row) => row.action === "skip").length;
  const review = input.rows.filter((row) => row.action === "review").length;
  lines.push(
    `${prefix}decision: retain ${retained}, skip ${skipped}, review ${review}`,
  );
  if (skipped > 0) {
    lines.push(
      `${prefix}High-confidence rejects are skipped. Unchanged files stay skipped on the next seed; use --force to judge them again.`,
    );
  }
  if (review > 0) {
    lines.push(
      input.dryRun
        ? `${prefix}Review rows stay in the dry-run queue. They are not auto-skipped or auto-retained.`
        : `${prefix}Review rows were not retained. They will be judged again on the next seed.`,
    );
  }
  const linked = input.rows.filter(
    (row) => (row.observationLinks?.length ?? 0) > 0,
  ).length;
  if (linked > 0) {
    lines.push(
      `${prefix}Supersession metadata points at the old observation id. The old observation is not deleted.`,
    );
  }
  return lines;
}

function formatRow(row: RelevanceRow, prefix: string, confidence: number): string[] {
  const heuristic = row.heuristicKept ? "keep" : "skip";
  const lines = [
    `${prefix}document_id: ${row.fact.id}`,
    `${prefix}path: ${row.fact.provenance.sourcePath}`,
    `${prefix}heading: ${row.fact.title}`,
    `${prefix}heuristic: ${heuristic} knowledge=${row.fact.knowledgeKind} score=${row.fact.score}`,
    `${prefix}jev: ${row.action}`,
    `${prefix}heuristic-vs-jev: ${row.heuristicVsJev}`,
  ];
  if (row.noul !== undefined && row.bands !== undefined) {
    lines.push(
      `${prefix}is_durable: ${row.noul.isDurable.toFixed(2)} ${row.bands.isDurable}`,
      `${prefix}is_ephemeral: ${row.noul.isEphemeral.toFixed(2)} ${row.bands.isEphemeral}`,
      `${prefix}in_scope: ${row.noul.inScope.toFixed(2)} ${row.bands.inScope}`,
    );
  }
  if (row.safety !== undefined) {
    lines.push(
      `${prefix}contains_secret: ${row.safety.containsSecret.toFixed(2)} ${row.safety.secretBand}`,
      `${prefix}contains_pii: ${row.safety.containsPii.toFixed(2)} ${row.safety.piiBand}`,
    );
  }
  if (row.durability !== undefined) {
    lines.push(
      `${prefix}score: durability=${row.durability.score} confidence=${row.durability.confidence.toFixed(2)}`,
    );
  }
  if (row.kind !== undefined) {
    lines.push(
      `${prefix}kind: ${row.kind.choice} confidence=${row.kind.confidence.toFixed(2)}`,
      `${prefix}probabilities: ${formatKindProbabilities(row.kind.probabilities)}`,
    );
  }
  if (row.retainTags !== undefined && row.retainTags.length > 0) {
    lines.push(
      `${prefix}retain-tags: ${row.retainTags
        .map(
          (item) =>
            `${item.tag}(${item.choice} ${item.confidence.toFixed(2)})`,
        )
        .join(" ")}`,
    );
  }
  if (row.bankKind !== undefined) {
    lines.push(`${prefix}bank-tags: ${row.bankKind.tags.join(",")}`);
  }
  if (row.relation !== undefined) {
    const linking =
      row.relation.choice === "supersedes" || row.relation.choice === "contradicts";
    const applied = (row.observationLinks?.length ?? 0) > 0;
    const below = row.relation.confidence + 1e-9 < confidence;
    const label = `${prefix}relation: ${row.relation.choice} confidence=${row.relation.confidence.toFixed(2)}`;
    lines.push(
      linking && !applied && below
        ? `${label} (below ${formatConfidence(confidence)}, no supersession metadata)`
        : label,
    );
    lines.push(
      `${prefix}relation probabilities: ${formatRelationProbabilities(row.relation.probabilities)}`,
    );
    if (row.relation.observationIds.length > 0) {
      lines.push(
        `${prefix}observations: ${row.relation.observationIds.join(" ")}`,
      );
    }
  }
  if (row.conflicts !== undefined) {
    for (const conflict of row.conflicts) {
      lines.push(
        `${prefix}conflicts_with: ${conflict.observationId} ${conflict.noul.toFixed(2)} ${conflict.band}`,
      );
    }
  }
  lines.push(`${prefix}decision: ${row.action} (${row.reason})`);
  return lines;
}

function toRelevanceState(
  state: {
    path: string;
    heading?: string;
    section: string;
    mission?: string;
    overlaps?: JevOverlap[];
  },
  sourceCommit: string | undefined,
): RelevanceState {
  const relevance: RelevanceState = {
    path: state.path,
    text: state.section,
  };
  if (state.heading !== undefined) {
    relevance.heading = state.heading;
  }
  if (state.mission !== undefined) {
    relevance.bankMission = state.mission;
  }
  if (state.overlaps !== undefined && state.overlaps.length > 0) {
    relevance.overlaps = state.overlaps;
  }
  if (sourceCommit === undefined) {
    return relevance;
  }
  const commit = sourceCommit.trim().slice(0, SOURCE_COMMIT_MAX_CHARS);
  if (commit === "" || containsInlineSecret(commit)) {
    return relevance;
  }
  relevance.sourceCommit = commit;
  return relevance;
}

interface KindRead {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

function applyKnowledgeKind(
  decision: Omit<RelevanceRow, "fact" | "heuristicKept">,
  kind: KindRead | undefined,
  confidence: number,
  heuristicKept: boolean,
): Omit<RelevanceRow, "fact" | "heuristicKept"> {
  if (kind === undefined) {
    return decision;
  }
  const withKind: Omit<RelevanceRow, "fact" | "heuristicKept"> = {
    ...decision,
    kind: {
      choice: kind.choice,
      confidence: kind.confidence,
      probabilities: kind.probabilities,
    },
  };
  const spec = knowledgeKindById(kind.choice);
  const confident = kind.confidence + 1e-9 >= confidence;
  if (spec === undefined) {
    if (withKind.action !== "retain") {
      return withKind;
    }
    return {
      ...withKind,
      action: "review",
      reason: "unrecognized knowledge kind",
      heuristicVsJev: "review",
    };
  }
  if (confident && spec.disposition !== "retain") {
    if (withKind.action === "skip") {
      return withKind;
    }
    return {
      ...withKind,
      action: "skip",
      reason:
        spec.disposition === "personal"
          ? "style preference stays out of the company bank"
          : "knowledge kind noise",
      heuristicVsJev: versusHeuristic("skip", heuristicKept),
    };
  }
  if (withKind.action !== "retain") {
    return withKind;
  }
  if (!confident) {
    return {
      ...withKind,
      action: "review",
      reason: `kind confidence below ${formatConfidence(confidence)}`,
      heuristicVsJev: "review",
    };
  }
  return {
    ...withKind,
    bankKind: { id: spec.id, tags: [...spec.tags] },
  };
}

function finishDecision(
  decision: Omit<RelevanceRow, "fact" | "heuristicKept">,
  result: JudgeResult,
  overlaps: readonly JevOverlap[],
  confidence: number,
  heuristicKept: boolean,
): Omit<RelevanceRow, "fact" | "heuristicKept"> {
  return applyRetainTags(
    applySafety(
      withRelation(decision, result, overlaps, confidence),
      result,
      confidence,
      heuristicKept,
    ),
    result.answers,
    confidence,
  );
}

function applyRetainTags(
  decision: Omit<RelevanceRow, "fact" | "heuristicKept">,
  answers: Record<string, JudgeAnswer>,
  confidence: number,
): Omit<RelevanceRow, "fact" | "heuristicKept"> {
  if (decision.action !== "retain" || decision.bankKind === undefined) {
    return decision;
  }
  const composed = composeRetainTags({ answers, confidence });
  if (composed.axes.length === 0 && composed.tags.length === 0) {
    return decision;
  }
  const tags = [...decision.bankKind.tags];
  for (const tag of composed.tags) {
    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return {
    ...decision,
    bankKind: {
      id: decision.bankKind.id,
      tags,
    },
    ...(composed.axes.length > 0 ? { retainTags: composed.axes } : {}),
  };
}

function applySafety(
  decision: Omit<RelevanceRow, "fact" | "heuristicKept">,
  result: JudgeResult,
  confidence: number,
  heuristicKept: boolean,
): Omit<RelevanceRow, "fact" | "heuristicKept"> {
  if (result.fellBackFromJev || result.judgeId !== "jev") {
    return decision;
  }
  const containsSecret = readNoul(result.answers.contains_secret);
  const containsPii = readNoul(result.answers.contains_pii);
  const secretBand =
    containsSecret === undefined ? undefined : noulBand(containsSecret, confidence);
  const piiBand = containsPii === undefined ? undefined : noulBand(containsPii, confidence);
  let next = decision;
  if (
    containsSecret !== undefined &&
    containsPii !== undefined &&
    secretBand !== undefined &&
    piiBand !== undefined
  ) {
    next = {
      ...next,
      safety: { containsSecret, containsPii, secretBand, piiBand },
    };
  }
  if (secretBand === "yes") {
    return blockRetain(next, "skip", "section contains a secret", heuristicKept, true);
  }
  if (piiBand === "yes") {
    return blockRetain(next, "skip", "section contains personal data", heuristicKept, false);
  }
  const uncertain = secretBand === "uncertain" || piiBand === "uncertain";
  const missing = containsSecret === undefined || containsPii === undefined;
  if ((uncertain || missing) && next.action === "retain") {
    return blockRetain(
      next,
      "review",
      missing
        ? "secret check did not return a score"
        : `secret or personal-data check below ${formatConfidence(confidence)}`,
      heuristicKept,
      false,
    );
  }
  return next;
}

function blockRetain(
  decision: Omit<RelevanceRow, "fact" | "heuristicKept">,
  action: "skip" | "review",
  reason: string,
  heuristicKept: boolean,
  warnSecret: boolean,
): Omit<RelevanceRow, "fact" | "heuristicKept"> {
  const next: Omit<RelevanceRow, "fact" | "heuristicKept"> = {
    ...decision,
    action,
    reason,
    heuristicVsJev: action === "skip" ? versusHeuristic("skip", heuristicKept) : "review",
  };
  if (warnSecret) {
    next.warnSecret = true;
  }
  delete next.observationLinks;
  delete next.bankKind;
  delete next.retainTags;
  return next;
}

function withRelation(
  decision: Omit<RelevanceRow, "fact" | "heuristicKept">,
  result: JudgeResult,
  overlaps: readonly JevOverlap[],
  confidence: number,
): Omit<RelevanceRow, "fact" | "heuristicKept"> {
  const interpreted = interpretRelation({
    answers: result.answers,
    overlaps,
    confidence,
    retain: decision.action === "retain",
  });
  return {
    ...decision,
    ...(interpreted.relation !== undefined ? { relation: interpreted.relation } : {}),
    ...(interpreted.conflicts !== undefined ? { conflicts: interpreted.conflicts } : {}),
    ...(interpreted.observationLinks !== undefined
      ? { observationLinks: interpreted.observationLinks }
      : {}),
  };
}

function formatRelationProbabilities(probabilities: Record<string, number>): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const id of OBSERVATION_RELATIONS) {
    const value = probabilities[id];
    if (value === undefined) {
      continue;
    }
    seen.add(id);
    parts.push(`${id}=${value.toFixed(2)}`);
  }
  for (const [id, value] of Object.entries(probabilities)) {
    if (seen.has(id)) {
      continue;
    }
    parts.push(`${id}=${value.toFixed(2)}`);
  }
  return parts.join(" ");
}

function formatKindProbabilities(probabilities: Record<string, number>): string {
  const ordered = listKnowledgeKinds().map((kind) => kind.id);
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const id of ordered) {
    const value = probabilities[id];
    if (value === undefined) {
      continue;
    }
    seen.add(id);
    parts.push(`${id}=${value.toFixed(2)}`);
  }
  for (const [id, value] of Object.entries(probabilities)) {
    if (seen.has(id)) {
      continue;
    }
    parts.push(`${id}=${value.toFixed(2)}`);
  }
  return parts.join(" ");
}

function readKind(answer: JudgeAnswer | undefined): KindRead | undefined {
  if (
    answer === undefined ||
    answer.type !== "choice" ||
    !Number.isFinite(answer.confidence)
  ) {
    return undefined;
  }
  return {
    choice: answer.choice,
    confidence: answer.confidence,
    probabilities: { ...answer.probabilities },
  };
}

function readNoul(answer: JudgeAnswer | undefined): number | undefined {
  if (answer === undefined || answer.type !== "noul" || !Number.isFinite(answer.noul)) {
    return undefined;
  }
  return answer.noul;
}

function readScore(
  answer: JudgeAnswer | undefined,
): { score: number; confidence: number } | undefined {
  if (answer === undefined || answer.type !== "score") {
    return undefined;
  }
  const score = answer as ScoreAnswer;
  if (!Number.isFinite(score.score) || !Number.isFinite(score.confidence)) {
    return undefined;
  }
  return { score: score.score, confidence: score.confidence };
}

function versusHeuristic(
  action: "retain" | "skip",
  heuristicKept: boolean,
): HeuristicVsJev {
  const jevKeeps = action === "retain";
  return jevKeeps === heuristicKept ? "agree" : "disagree";
}

function fallbackRow(fact: CandidateFact, heuristicKept: boolean): RelevanceRow {
  return {
    fact,
    heuristicKept,
    action: heuristicKept ? "retain" : "skip",
    reason: heuristicKept
      ? "TypeSafe unavailable; kept the heuristic candidate"
      : "TypeSafe unavailable; left the heuristic skip in place",
    heuristicVsJev: "fallback",
  };
}

function formatConfidence(confidence: number): string {
  return confidence.toFixed(2);
}
