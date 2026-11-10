/*
Retain-tag axes enrich seed --judge jev retain stamps for Reflect filters.
Each axis is one Choice question in the same relevance call. Orto composes
the confident tags in code. The vocabulary is versioned in retain-tags.json.
*/

import rawCatalog from "./retain-tags.json";
import { OrtoError } from "../utils/errors.js";
import type {
  ChoiceCriterion,
  ChoiceQuestion,
  JudgeAnswer,
  JudgeQuestion,
} from "./types.js";

export const RETAIN_TAG_AXIS_IDS = ["layer", "domain", "stability"] as const;

export type RetainTagAxisId = (typeof RETAIN_TAG_AXIS_IDS)[number];

export interface RetainTagChoice {
  id: string;
  tag: string;
  criteria: {
    what: string;
    not_for: string;
    examples: string[];
  };
}

export interface RetainTagAxis {
  id: RetainTagAxisId;
  question: string;
  choices: RetainTagChoice[];
}

export interface RetainTagCatalog {
  version: number;
  axes: RetainTagAxis[];
}

export interface RetainTagAxisRead {
  axis: RetainTagAxisId;
  choice: string;
  tag: string;
  confidence: number;
}

export interface ComposedRetainTags {
  tags: string[];
  axes: RetainTagAxisRead[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(detail: string): never {
  throw new OrtoError(
    `Retain-tag catalog is invalid: ${detail}`,
    "Fix src/judge/retain-tags.json. Each axis needs a question and choice tags.",
  );
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function parseCatalog(value: unknown): RetainTagCatalog {
  if (!isRecord(value)) {
    fail("catalog must be an object");
  }
  const version = value.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    fail("version must be a positive integer");
  }
  if (!Array.isArray(value.axes)) {
    fail("axes must be an array");
  }
  if (value.axes.length !== RETAIN_TAG_AXIS_IDS.length) {
    fail(`expected ${RETAIN_TAG_AXIS_IDS.length} axes`);
  }

  const axes: RetainTagAxis[] = [];
  for (const [index, entry] of value.axes.entries()) {
    const expected = RETAIN_TAG_AXIS_IDS[index];
    if (!isRecord(entry) || expected === undefined) {
      fail(`axes[${index}] must be an object`);
    }
    const id = readString(entry.id, `axes[${index}].id`);
    if (id !== expected) {
      fail(`axes[${index}].id must be ${expected}`);
    }
    const question = readString(entry.question, `${id}.question`);
    if (!isRecord(entry.choices)) {
      fail(`${id}.choices must be an object`);
    }
    const choices: RetainTagChoice[] = [];
    for (const [choiceId, choiceValue] of Object.entries(entry.choices)) {
      if (!isRecord(choiceValue)) {
        fail(`${id}.choices.${choiceId} must be an object`);
      }
      const criteriaSource = isRecord(choiceValue.criteria)
        ? choiceValue.criteria
        : choiceValue;
      const examplesRaw = criteriaSource.examples;
      if (!Array.isArray(examplesRaw) || examplesRaw.length === 0) {
        fail(`${id}.choices.${choiceId}.examples must be a non-empty array`);
      }
      choices.push({
        id: choiceId,
        tag: readString(choiceValue.tag, `${id}.choices.${choiceId}.tag`),
        criteria: {
          what: readString(criteriaSource.what, `${id}.${choiceId}.what`),
          not_for: readString(criteriaSource.not_for, `${id}.${choiceId}.not_for`),
          examples: examplesRaw.map((example, exampleIndex) =>
            readString(example, `${id}.${choiceId}.examples[${exampleIndex}]`),
          ),
        },
      });
    }
    if (choices.length === 0) {
      fail(`${id} needs at least one choice`);
    }
    axes.push({ id: expected, question, choices });
  }

  return { version, axes };
}

const CATALOG = parseCatalog(rawCatalog);

export function retainTagCatalog(): RetainTagCatalog {
  return {
    version: CATALOG.version,
    axes: CATALOG.axes.map((axis) => ({
      id: axis.id,
      question: axis.question,
      choices: axis.choices.map((choice) => ({
        id: choice.id,
        tag: choice.tag,
        criteria: {
          what: choice.criteria.what,
          not_for: choice.criteria.not_for,
          examples: [...choice.criteria.examples],
        },
      })),
    })),
  };
}

export function retainTagQuestions(): Record<string, JudgeQuestion> {
  const questions: Record<string, JudgeQuestion> = {};
  for (const axis of CATALOG.axes) {
    questions[axis.id] = axisQuestion(axis);
  }
  return questions;
}

export function composeRetainTags(input: {
  answers: Record<string, JudgeAnswer>;
  confidence: number;
}): ComposedRetainTags {
  const axes: RetainTagAxisRead[] = [];
  const tags: string[] = [];
  for (const axis of CATALOG.axes) {
    const answer = readChoice(input.answers[axis.id]);
    if (answer === undefined) {
      continue;
    }
    if (answer.confidence + 1e-9 < input.confidence) {
      continue;
    }
    const choice = axis.choices.find((item) => item.id === answer.choice);
    if (choice === undefined) {
      continue;
    }
    axes.push({
      axis: axis.id,
      choice: choice.id,
      tag: choice.tag,
      confidence: answer.confidence,
    });
    if (!tags.includes(choice.tag)) {
      tags.push(choice.tag);
    }
  }
  return { tags, axes };
}

function axisQuestion(axis: RetainTagAxis): ChoiceQuestion {
  const criteria: Record<string, ChoiceCriterion> = {};
  for (const choice of axis.choices) {
    criteria[choice.id] = {
      what: choice.criteria.what,
      not_for: choice.criteria.not_for,
      examples: [...choice.criteria.examples],
    };
  }
  return {
    type: "choice",
    instructions: axis.question,
    criteria,
  };
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
