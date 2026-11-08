/*
Mission / directives fitness scores a generated bank template against the repo.
Configure --judge jev calls this once after template generation with the mission,
directive texts, and a short README excerpt. One Jev call asks mission_fit
(0 generic or wrong through 3 specific and true) and whether directives
conflict with the docs (directives_conflict_with_docs).

Jev does not author mission or directive prose. A low mission_fit score at or
above --confidence means the operator should review before write; configure
skips the template write unless --yes.
*/

import { noulBand, type NoulBand } from "./relevance.js";
import {
  assertJevStateSendable,
  containsInlineSecret,
  JEV_MISSION_MAX_CHARS,
  JEV_PATH_MAX_CHARS,
  JEV_SECTION_MAX_CHARS,
} from "./state.js";
import type {
  Judge,
  JudgeAnswer,
  JudgeQuestion,
  NoulQuestion,
  ScoreQuestion,
} from "./types.js";

export const MISSION_FIT_MAX = 3;
export const LOW_MISSION_FIT_MAX = 1;

export interface MissionFitState {
  projectName: string;
  mission: string;
  directives: readonly string[];
  repoExcerpt?: string;
}

export interface MissionFitDecision {
  missionFit?: { score: number; confidence: number };
  directivesConflict?: number;
  directivesConflictBand?: NoulBand;
  needsReview: boolean;
  reason: string;
}

export function missionFitQuestions(): Record<string, JudgeQuestion> {
  return {
    mission_fit: missionFitQuestion(),
    directives_conflict_with_docs: directivesConflictQuestion(),
  };
}

export function interpretMissionFit(input: {
  answers: Record<string, JudgeAnswer>;
  confidence: number;
}): MissionFitDecision {
  const missionFit = readScore(input.answers.mission_fit, MISSION_FIT_MAX);
  const conflict = readNoul(input.answers.directives_conflict_with_docs);
  const conflictBand =
    conflict === undefined ? undefined : noulBand(conflict, input.confidence);

  const missionFitConfident =
    missionFit !== undefined &&
    missionFit.confidence + 1e-9 >= input.confidence;
  const lowMissionFit =
    missionFitConfident &&
    missionFit !== undefined &&
    missionFit.score <= LOW_MISSION_FIT_MAX + 1e-9;

  const needsReview = lowMissionFit;
  const parts: string[] = [];
  if (missionFit !== undefined) {
    parts.push(
      `mission_fit=${missionFit.score.toFixed(0)} confidence=${missionFit.confidence.toFixed(2)}`,
    );
  }
  if (conflict !== undefined && conflictBand !== undefined) {
    parts.push(
      `directives_conflict_with_docs=${conflict.toFixed(2)}(${conflictBand})`,
    );
  }
  if (needsReview) {
    parts.push("review mission before applying");
  }

  return {
    ...(missionFit !== undefined ? { missionFit } : {}),
    ...(conflict !== undefined ? { directivesConflict: conflict } : {}),
    ...(conflictBand !== undefined
      ? { directivesConflictBand: conflictBand }
      : {}),
    needsReview,
    reason: parts.length > 0 ? parts.join(" ") : "no mission-fit answers",
  };
}

export async function judgeMissionFit(input: {
  state: MissionFitState;
  judge: Judge;
  confidence: number;
}): Promise<MissionFitDecision> {
  if (
    containsInlineSecret(input.state.mission) ||
    input.state.directives.some((item) => containsInlineSecret(item)) ||
    (input.state.repoExcerpt !== undefined &&
      containsInlineSecret(input.state.repoExcerpt))
  ) {
    return {
      needsReview: false,
      reason: "item matched a secret pattern; not sent to Jev",
    };
  }

  const state = {
    type: "bank_template",
    projectName: input.state.projectName.slice(0, JEV_PATH_MAX_CHARS),
    mission: input.state.mission.slice(0, JEV_MISSION_MAX_CHARS),
    directives: input.state.directives
      .slice(0, 8)
      .map((item) => item.slice(0, Math.floor(JEV_SECTION_MAX_CHARS / 4))),
    ...(input.state.repoExcerpt !== undefined
      ? {
          repoExcerpt: input.state.repoExcerpt.slice(
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
      needsReview: false,
      reason: "item was not sent to Jev",
    };
  }

  const result = await input.judge.evaluate({
    state,
    questions: missionFitQuestions(),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    return {
      needsReview: false,
      reason: "mission fit did not return a Jev score",
    };
  }
  return interpretMissionFit({
    answers: result.answers,
    confidence: input.confidence,
  });
}

function missionFitQuestion(): ScoreQuestion {
  return {
    type: "score",
    instructions:
      "How well does this retain mission match the repository (0 generic or wrong, 3 specific and true)?",
    criteria: [
      "Generic AI filler or wrong for this repo",
      "Weak or mostly generic; little that is project-specific",
      "Mostly accurate; some project-specific detail",
      "Specific and true to this repository's durable knowledge",
    ],
  };
}

function directivesConflictQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions:
      "Do any generated directives conflict with what the repository docs say?",
    criteria: {
      true: "A directive contradicts an ADR, standard, or architecture note in the excerpt.",
      false: "Directives align with or are silent relative to the docs.",
    },
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
  max: number,
): { score: number; confidence: number } | undefined {
  if (
    answer === undefined ||
    answer.type !== "score" ||
    !Number.isFinite(answer.score) ||
    !Number.isFinite(answer.confidence)
  ) {
    return undefined;
  }
  if (answer.score < 0 || answer.score > max + 1e-9) {
    return undefined;
  }
  return { score: answer.score, confidence: answer.confidence };
}
