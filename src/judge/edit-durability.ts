/*
Store edit durability decides whether a changed allowlisted file should be
re-retained. Store calls this once per changed path when --judge jev is set,
with the previous retained text and the current file body. One Jev call asks
whether the durable claim changed (claim_changed), whether the edit looks like
a temporary workaround (looks_like_workaround), and which action to take
(re_retain, skip, or review).

A confident wording-only answer skips retain and the caller still updates the
content hash so the same edit does not loop. A confident workaround stays in
review and is not retained. A confident claim change that is not a workaround
re-retains. Mid-range or missing answers stay in review. A secret match is
skipped and is not sent to Jev. Without --judge jev, store is unchanged.
*/

import { noulBand, type NoulBand } from "./relevance.js";
import {
  assertJevStateSendable,
  containsInlineSecret,
  JEV_PATH_MAX_CHARS,
  JEV_SECTION_MAX_CHARS,
} from "./state.js";
import type {
  ChoiceQuestion,
  Judge,
  JudgeAnswer,
  JudgeQuestion,
  NoulQuestion,
} from "./types.js";

export type EditDurabilityAction = "re_retain" | "skip" | "review";

export interface EditDurabilityDecision {
  path: string;
  action: EditDurabilityAction;
  reason: string;
  claimChanged?: number;
  claimChangedBand?: NoulBand;
  looksLikeWorkaround?: number;
  looksLikeWorkaroundBand?: NoulBand;
  chosenAction?: string;
  actionConfidence?: number;
}

const ACTIONS = ["re_retain", "skip", "review"] as const;

export function editDurabilityQuestions(): Record<string, JudgeQuestion> {
  return {
    claim_changed: claimChangedQuestion(),
    looks_like_workaround: looksLikeWorkaroundQuestion(),
    action: actionQuestion(),
  };
}

export function interpretEditDurability(input: {
  path: string;
  answers: Record<string, JudgeAnswer>;
  confidence: number;
}): EditDurabilityDecision {
  const claimChanged = readNoul(input.answers.claim_changed);
  const workaround = readNoul(input.answers.looks_like_workaround);
  const chosen = readChoice(input.answers.action);
  const claimBand =
    claimChanged === undefined ? undefined : noulBand(claimChanged, input.confidence);
  const workaroundBand =
    workaround === undefined ? undefined : noulBand(workaround, input.confidence);
  const actionConfident =
    chosen !== undefined &&
    ACTIONS.includes(chosen.choice as EditDurabilityAction) &&
    chosen.confidence + 1e-9 >= input.confidence;

  const base = {
    path: input.path,
    ...(claimChanged !== undefined ? { claimChanged } : {}),
    ...(claimBand !== undefined ? { claimChangedBand: claimBand } : {}),
    ...(workaround !== undefined ? { looksLikeWorkaround: workaround } : {}),
    ...(workaroundBand !== undefined
      ? { looksLikeWorkaroundBand: workaroundBand }
      : {}),
    ...(chosen !== undefined
      ? { chosenAction: chosen.choice, actionConfidence: chosen.confidence }
      : {}),
  };

  if (workaroundBand === "yes") {
    return {
      ...base,
      action: "review",
      reason: "looks like a temporary workaround",
    };
  }

  if (claimBand === "no") {
    return {
      ...base,
      action: "skip",
      reason: "wording or formatting only",
    };
  }

  if (actionConfident && chosen !== undefined) {
    return {
      ...base,
      action: chosen.choice as EditDurabilityAction,
      reason: `action ${chosen.choice}`,
    };
  }

  if (claimBand === "yes" && workaroundBand === "no") {
    return {
      ...base,
      action: "re_retain",
      reason: "durable claim changed",
    };
  }

  return {
    ...base,
    action: "review",
    reason: `edit durability below ${input.confidence.toFixed(2)}`,
  };
}

export async function judgeEditDurability(input: {
  path: string;
  previousText: string;
  currentText: string;
  judge: Judge;
  confidence: number;
}): Promise<EditDurabilityDecision> {
  if (
    containsInlineSecret(input.path) ||
    containsInlineSecret(input.previousText) ||
    containsInlineSecret(input.currentText)
  ) {
    return {
      path: input.path,
      action: "skip",
      reason: "file matched a secret pattern",
    };
  }

  if (normalizeForCompare(input.previousText) === normalizeForCompare(input.currentText)) {
    return {
      path: input.path,
      action: "skip",
      reason: "wording or formatting only",
    };
  }

  const half = Math.floor(JEV_SECTION_MAX_CHARS / 2);
  const state = {
    path: input.path.slice(0, JEV_PATH_MAX_CHARS),
    previous: input.previousText.slice(0, half),
    current: input.currentText.slice(0, half),
  };
  try {
    assertJevStateSendable(state);
  } catch {
    return {
      path: input.path,
      action: "skip",
      reason: "file was not sent to Jev",
    };
  }

  const result = await input.judge.evaluate({
    state,
    questions: editDurabilityQuestions(),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    return {
      path: input.path,
      action: "review",
      reason: "edit durability did not return a Jev score",
    };
  }
  return interpretEditDurability({
    path: input.path,
    answers: result.answers,
    confidence: input.confidence,
  });
}

export function formatEditDurabilityLines(input: {
  decisions: readonly EditDurabilityDecision[];
  dryRun: boolean;
}): string[] {
  const prefix = input.dryRun ? "[dry-run] " : "";
  if (input.decisions.length === 0) {
    return [`${prefix}No edit durability decisions.`];
  }
  const lines = [`${prefix}Store edit durability gate:`];
  for (const decision of input.decisions) {
    const claim =
      decision.claimChanged !== undefined && decision.claimChangedBand !== undefined
        ? `claim_changed ${decision.claimChanged.toFixed(2)} ${decision.claimChangedBand}`
        : "claim_changed unknown";
    const workaround =
      decision.looksLikeWorkaround !== undefined &&
      decision.looksLikeWorkaroundBand !== undefined
        ? `looks_like_workaround ${decision.looksLikeWorkaround.toFixed(2)} ${decision.looksLikeWorkaroundBand}`
        : "looks_like_workaround unknown";
    lines.push(
      `${prefix}${decision.action} ${decision.path}: ${claim}; ${workaround} (${decision.reason})`,
    );
  }
  return lines;
}

function claimChangedQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions:
      "Did the durable claim in this file change, or is the edit only wording or formatting?",
    criteria: {
      true: "The durable decision, invariant, architecture note, or standard changed.",
      false:
        "A typo fix, whitespace, wording, or formatting change that leaves the durable claim the same.",
    },
  };
}

function looksLikeWorkaroundQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions:
      "Does this edit look like a temporary workaround that should not enter the company bank?",
    criteria: {
      true: 'A temporary hack, "revert this", "TODO undo", or other short-lived workaround.',
      false: "A durable decision or a wording change that is not a temporary workaround.",
    },
  };
}

function actionQuestion(): ChoiceQuestion {
  return {
    type: "choice",
    instructions: "What should Orto do with this changed file?",
    criteria: {
      re_retain: {
        what: "Re-retain the file because the durable claim changed.",
        not_for: "Wording-only edits or temporary workarounds.",
        examples: [
          "We no longer use Redis; use SQLite",
          "The bank must stay local-first",
        ],
      },
      skip: {
        what: "Skip retain because the durable claim is unchanged.",
        not_for: "Real claim changes or temporary workarounds that need review.",
        examples: ["Typo fix", "Whitespace or formatting only"],
      },
      review: {
        what: "Hold for review; do not retain yet.",
        not_for: "Clear durable claim changes or clear wording-only edits.",
        examples: ["Temporary hack", "TODO undo", "Uncertain edit"],
      },
    },
  };
}

function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function readNoul(answer: JudgeAnswer | undefined): number | undefined {
  if (answer === undefined || answer.type !== "noul" || !Number.isFinite(answer.noul)) {
    return undefined;
  }
  return answer.noul;
}

function readChoice(
  answer: JudgeAnswer | undefined,
): { choice: string; confidence: number } | undefined {
  if (
    answer === undefined ||
    answer.type !== "choice" ||
    !Number.isFinite(answer.confidence)
  ) {
    return undefined;
  }
  return { choice: answer.choice, confidence: answer.confidence };
}
