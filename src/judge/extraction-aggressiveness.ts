/*
Extraction aggressiveness chooses how hard retain should dig into durable docs.
Configure --judge jev asks one choice (conservative | standard | greedy) from a
compact repo shape snapshot (counts by kind, ADR presence, docs bytes), not the
full tree. The result maps onto Hindsight retain_extraction_mode and is stored
as bankTemplate.extraction in config so the operator can override it.
*/

import type { RetainExtractionMode } from "../providers/hindsight/types.js";
import { OrtoError } from "../utils/errors.js";
import {
  assertJevStateSendable,
  containsInlineSecret,
  JEV_PATH_MAX_CHARS,
} from "./state.js";
import type { RepoShapeSnapshot } from "./repo-shape.js";
import type {
  ChoiceQuestion,
  Judge,
  JudgeAnswer,
  JudgeQuestion,
} from "./types.js";

export const EXTRACTION_AGGRESSIVENESS = [
  "conservative",
  "standard",
  "greedy",
] as const;

export type ExtractionAggressiveness =
  (typeof EXTRACTION_AGGRESSIVENESS)[number];

export type ExtractionDecisionSource = "override" | "jev" | "heuristic";

export interface ExtractionAggressivenessDecision {
  extraction: ExtractionAggressiveness;
  retainExtractionMode: RetainExtractionMode;
  source: ExtractionDecisionSource;
  confidence?: number;
  snapshot?: RepoShapeSnapshot;
  reason: string;
}

const DOCS_BYTES_GREEDY = 40_000;
const DOCS_COUNT_GREEDY = 8;
const ADR_COUNT_GREEDY = 3;

export function isExtractionAggressiveness(
  value: string,
): value is ExtractionAggressiveness {
  return (EXTRACTION_AGGRESSIVENESS as readonly string[]).includes(value);
}

export function parseExtractionAggressiveness(
  value: string,
): ExtractionAggressiveness {
  const normalized = value.trim().toLowerCase();
  if (!isExtractionAggressiveness(normalized)) {
    throw new OrtoError(
      `Invalid extraction aggressiveness "${value}"`,
      `Use one of: ${EXTRACTION_AGGRESSIVENESS.join(", ")}.`,
    );
  }
  return normalized;
}

export function toRetainExtractionMode(
  extraction: ExtractionAggressiveness,
): RetainExtractionMode {
  switch (extraction) {
    case "conservative":
      return "concise";
    case "standard":
      return "verbose";
    case "greedy":
      return "verbatim";
  }
}

export function suggestExtractionFromSnapshot(
  snapshot: RepoShapeSnapshot,
): ExtractionAggressiveness {
  if (snapshot.hasAdrTree && snapshot.adrCount >= 1) {
    if (
      snapshot.adrCount >= ADR_COUNT_GREEDY ||
      snapshot.docsBytes >= DOCS_BYTES_GREEDY ||
      snapshot.docsCount + snapshot.adrCount >= DOCS_COUNT_GREEDY
    ) {
      return "greedy";
    }
    return "standard";
  }

  if (
    snapshot.readmeCount >= 1 &&
    snapshot.adrCount === 0 &&
    snapshot.docsCount === 0 &&
    snapshot.markdownFileCount <= 2
  ) {
    return "conservative";
  }

  if (
    snapshot.docsCount >= DOCS_COUNT_GREEDY ||
    snapshot.docsBytes >= DOCS_BYTES_GREEDY
  ) {
    return "greedy";
  }

  return "standard";
}

export function extractionAggressivenessQuestions(): Record<
  string,
  JudgeQuestion
> {
  return {
    extraction: extractionQuestion(),
  };
}

export function interpretExtractionAggressiveness(input: {
  answers: Record<string, JudgeAnswer>;
  confidence: number;
  snapshot: RepoShapeSnapshot;
}): ExtractionAggressivenessDecision {
  const choice = readChoice(input.answers.extraction);
  const confident =
    choice !== undefined &&
    isExtractionAggressiveness(choice.choice) &&
    choice.confidence + 1e-9 >= input.confidence;

  if (confident && choice !== undefined) {
    const extraction = choice.choice as ExtractionAggressiveness;
    return {
      extraction,
      retainExtractionMode: toRetainExtractionMode(extraction),
      source: "jev",
      confidence: choice.confidence,
      snapshot: input.snapshot,
      reason: `extraction=${extraction} confidence=${choice.confidence.toFixed(2)}`,
    };
  }

  const suggested = suggestExtractionFromSnapshot(input.snapshot);
  const reason =
    choice !== undefined && isExtractionAggressiveness(choice.choice)
      ? `extraction=${choice.choice} below ${input.confidence.toFixed(2)}; heuristic=${suggested}`
      : `heuristic=${suggested}`;
  return {
    extraction: suggested,
    retainExtractionMode: toRetainExtractionMode(suggested),
    source: "heuristic",
    ...(choice !== undefined ? { confidence: choice.confidence } : {}),
    snapshot: input.snapshot,
    reason,
  };
}

export function overrideExtractionAggressiveness(
  extraction: ExtractionAggressiveness,
): ExtractionAggressivenessDecision {
  return {
    extraction,
    retainExtractionMode: toRetainExtractionMode(extraction),
    source: "override",
    reason: `extraction=${extraction} (operator override)`,
  };
}

export async function judgeExtractionAggressiveness(input: {
  snapshot: RepoShapeSnapshot;
  judge: Judge;
  confidence: number;
  projectName?: string;
}): Promise<ExtractionAggressivenessDecision> {
  const snapshotSummary = summarizeSnapshot(input.snapshot);
  if (containsInlineSecret(snapshotSummary)) {
    const suggested = suggestExtractionFromSnapshot(input.snapshot);
    return {
      extraction: suggested,
      retainExtractionMode: toRetainExtractionMode(suggested),
      source: "heuristic",
      snapshot: input.snapshot,
      reason: "snapshot matched a secret pattern; heuristic used",
    };
  }

  const state = {
    type: "repo_shape",
    ...(input.projectName !== undefined
      ? { projectName: input.projectName.slice(0, JEV_PATH_MAX_CHARS) }
      : {}),
    ...input.snapshot,
    summary: snapshotSummary,
  };

  try {
    assertJevStateSendable(state);
  } catch {
    const suggested = suggestExtractionFromSnapshot(input.snapshot);
    return {
      extraction: suggested,
      retainExtractionMode: toRetainExtractionMode(suggested),
      source: "heuristic",
      snapshot: input.snapshot,
      reason: "snapshot was not sent to Jev; heuristic used",
    };
  }

  const result = await input.judge.evaluate({
    state,
    questions: extractionAggressivenessQuestions(),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    const suggested = suggestExtractionFromSnapshot(input.snapshot);
    return {
      extraction: suggested,
      retainExtractionMode: toRetainExtractionMode(suggested),
      source: "heuristic",
      snapshot: input.snapshot,
      reason: "extraction did not return a Jev choice; heuristic used",
    };
  }

  return interpretExtractionAggressiveness({
    answers: result.answers,
    confidence: input.confidence,
    snapshot: input.snapshot,
  });
}

function extractionQuestion(): ChoiceQuestion {
  return {
    type: "choice",
    instructions:
      "How aggressive should Hindsight retain extraction be for this repository shape?",
    criteria: {
      conservative: {
        what: "Extract sparingly; keep only high-signal durable facts",
        not_for: "Repos with many ADRs or a large docs tree",
        examples: [
          "Tiny library with one README",
          "Package with little durable prose",
        ],
      },
      standard: {
        what: "Balanced extraction for typical project documentation",
        not_for: "Empty repos or ADR-heavy trees that need maximal capture",
        examples: [
          "Moderate docs/ with a few architecture notes",
          "Small docs/adr tree",
        ],
      },
      greedy: {
        what: "Extract thoroughly from dense durable documentation",
        not_for: "Tiny one-README projects",
        examples: [
          "Large docs/adr tree",
          "Many decision records and architecture docs",
        ],
      },
    },
  };
}

function summarizeSnapshot(snapshot: RepoShapeSnapshot): string {
  return [
    `readme=${snapshot.readmeCount}`,
    `docs=${snapshot.docsCount}`,
    `adr=${snapshot.adrCount}`,
    `markdown=${snapshot.markdownFileCount}`,
    `docsBytes=${snapshot.docsBytes}`,
    `hasAdrTree=${snapshot.hasAdrTree}`,
  ].join(" ");
}

function readChoice(
  answer: JudgeAnswer | undefined,
): { choice: string; confidence: number } | undefined {
  if (
    answer === undefined ||
    answer.type !== "choice" ||
    typeof answer.choice !== "string" ||
    !Number.isFinite(answer.confidence)
  ) {
    return undefined;
  }
  return { choice: answer.choice, confidence: answer.confidence };
}
