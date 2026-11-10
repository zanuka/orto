/*
Mental-model catalog proposals pick which standing questions to pin.
`orto mental-model propose --judge jev` walks a curated catalog (titles and
source queries live in Orto, not Jev), skips ids already in the bank template,
and asks one should_propose noul per remaining entry with a compact repo
snapshot. Confident yes becomes a proposal. Nothing is created in Hindsight.
*/

import { noulBand, type NoulBand } from "./relevance.js";
import {
  assertJevStateSendable,
  containsInlineSecret,
  JEV_PATH_MAX_CHARS,
  JEV_SECTION_MAX_CHARS,
} from "./state.js";
import type { RepoShapeSnapshot } from "./repo-shape.js";
import type {
  Judge,
  JudgeAnswer,
  JudgeQuestion,
  NoulQuestion,
} from "./types.js";
import type {
  MentalModelCatalogEntry,
  MentalModelCatalogKind,
} from "./mental-model-catalog.js";
import { renderCatalogSourceQuery } from "./mental-model-catalog.js";

export type MentalModelProposeVerdict = "propose" | "skip" | "review";

export interface MentalModelCatalogProposal {
  id: string;
  title: string;
  sourceQuery: string;
  kind: MentalModelCatalogKind;
  verdict: MentalModelProposeVerdict;
  reason: string;
  confidence?: number;
  shouldPropose?: number;
  shouldProposeBand?: NoulBand;
}

export function mentalModelProposeQuestions(): Record<string, JudgeQuestion> {
  return {
    should_propose: shouldProposeQuestion(),
  };
}

export function interpretMentalModelPropose(input: {
  entry: MentalModelCatalogEntry;
  sourceQuery: string;
  answers: Record<string, JudgeAnswer>;
  confidence: number;
}): MentalModelCatalogProposal {
  const shouldPropose = readNoul(input.answers.should_propose);
  const shouldProposeBand =
    shouldPropose === undefined
      ? undefined
      : noulBand(shouldPropose, input.confidence);
  const base = {
    id: input.entry.id,
    title: input.entry.title,
    sourceQuery: input.sourceQuery,
    kind: input.entry.kind,
    ...(shouldPropose !== undefined ? { shouldPropose } : {}),
    ...(shouldProposeBand !== undefined ? { shouldProposeBand } : {}),
  };

  if (shouldProposeBand === "yes") {
    return {
      ...base,
      verdict: "propose",
      reason: input.entry.kind,
      ...(shouldPropose !== undefined ? { confidence: shouldPropose } : {}),
    };
  }
  if (shouldProposeBand === "no") {
    return {
      ...base,
      verdict: "skip",
      reason: "not a standing question for this repo",
      ...(shouldPropose !== undefined ? { confidence: 1 - shouldPropose } : {}),
    };
  }
  return {
    ...base,
    verdict: "review",
    reason: `proposal below ${input.confidence.toFixed(2)}`,
    ...(shouldPropose !== undefined ? { confidence: shouldPropose } : {}),
  };
}

export async function judgeMentalModelCatalogEntry(input: {
  entry: MentalModelCatalogEntry;
  projectName: string;
  snapshot: RepoShapeSnapshot;
  repoExcerpt?: string;
  judge: Judge;
  confidence: number;
}): Promise<MentalModelCatalogProposal> {
  const sourceQuery = renderCatalogSourceQuery(
    input.entry,
    input.projectName,
  );
  if (
    containsInlineSecret(input.entry.title) ||
    containsInlineSecret(sourceQuery) ||
    (input.repoExcerpt !== undefined &&
      containsInlineSecret(input.repoExcerpt))
  ) {
    return {
      id: input.entry.id,
      title: input.entry.title,
      sourceQuery,
      kind: input.entry.kind,
      verdict: "skip",
      reason: "item matched a secret pattern",
    };
  }

  const state = {
    type: "mental_model_catalog",
    projectName: input.projectName.slice(0, JEV_PATH_MAX_CHARS),
    id: input.entry.id.slice(0, JEV_PATH_MAX_CHARS),
    title: input.entry.title.slice(0, JEV_PATH_MAX_CHARS),
    kind: input.entry.kind,
    sourceQuery: sourceQuery.slice(0, JEV_SECTION_MAX_CHARS),
    snapshot: {
      readmeCount: input.snapshot.readmeCount,
      docsCount: input.snapshot.docsCount,
      adrCount: input.snapshot.adrCount,
      markdownFileCount: input.snapshot.markdownFileCount,
      docsBytes: input.snapshot.docsBytes,
      hasAdrTree: input.snapshot.hasAdrTree,
    },
    ...(input.repoExcerpt !== undefined
      ? {
          repoExcerpt: input.repoExcerpt.slice(
            0,
            Math.floor(JEV_SECTION_MAX_CHARS / 2),
          ),
        }
      : {}),
  };

  try {
    assertJevStateSendable(state);
  } catch {
    return {
      id: input.entry.id,
      title: input.entry.title,
      sourceQuery,
      kind: input.entry.kind,
      verdict: "skip",
      reason: "item was not sent to Jev",
    };
  }

  const result = await input.judge.evaluate({
    state,
    questions: mentalModelProposeQuestions(),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    return {
      id: input.entry.id,
      title: input.entry.title,
      sourceQuery,
      kind: input.entry.kind,
      verdict: "skip",
      reason: "proposal did not return a Jev score",
    };
  }

  return interpretMentalModelPropose({
    entry: input.entry,
    sourceQuery,
    answers: result.answers,
    confidence: input.confidence,
  });
}

export function formatMentalModelProposeLines(input: {
  proposals: readonly MentalModelCatalogProposal[];
  dryRun: boolean;
}): string[] {
  const prefix = input.dryRun ? "[dry-run] " : "";
  if (input.proposals.length === 0) {
    return [
      `${prefix}No catalog questions left to propose (template may already cover them).`,
    ];
  }

  const lines = [`${prefix}Mental model catalog proposals:`];
  for (const proposal of input.proposals) {
    const confidence =
      proposal.confidence !== undefined
        ? ` confidence=${proposal.confidence.toFixed(2)}`
        : "";
    const should =
      proposal.shouldPropose !== undefined &&
      proposal.shouldProposeBand !== undefined
        ? ` should_propose=${proposal.shouldPropose.toFixed(2)}(${proposal.shouldProposeBand})`
        : "";
    lines.push(
      `${prefix}${proposal.verdict} ${proposal.id}: title=${JSON.stringify(proposal.title)} source_query=${JSON.stringify(proposal.sourceQuery)} kind=${proposal.kind}${confidence}${should}`,
    );
  }
  return lines;
}

function shouldProposeQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions:
      "Should this standing mental-model question be pinned for this repository?",
    criteria: {
      true: "The repo has durable knowledge this question would usefully summarize for agents (docs, ADRs, standards, ops notes).",
      false: "The question is irrelevant, redundant, or not supported by durable sources in this repo.",
    },
  };
}

function readNoul(answer: JudgeAnswer | undefined): number | undefined {
  if (
    answer === undefined ||
    answer.type !== "noul" ||
    !Number.isFinite(answer.noul)
  ) {
    return undefined;
  }
  return answer.noul;
}
