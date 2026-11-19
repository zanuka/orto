import { noulBand, type NoulBand } from "./relevance.js";
import {
  assertJevStateSendable,
  containsInlineSecret,
  JEV_SECTION_MAX_CHARS,
} from "./state.js";
import type {
  ChoiceQuestion,
  Judge,
  JudgeAnswer,
  JudgeQuestion,
  NoulQuestion,
  ScoreQuestion,
} from "./types.js";

export const SHARE_PROFILE_OK = ["local_only", "vpn", "public_ok"] as const;
export type ShareProfileOk = (typeof SHARE_PROFILE_OK)[number];

export const SHARE_SAFETY_SENSITIVITY_MAX = 3;
export const SHARE_SAFETY_HIGH_SENSITIVITY = 2;
export const SHARE_SAFETY_TEXT_MAX_CHARS = JEV_SECTION_MAX_CHARS;

export type ShareSafetySource = "jev" | "heuristic";

export interface ShareSafetyDecision {
  profileOk: ShareProfileOk;
  allowPublic: boolean;
  reason: string;
  source: ShareSafetySource;
  safeOutside?: number;
  safeOutsideBand?: NoulBand;
  leaksInternal?: number;
  leaksInternalBand?: NoulBand;
  sensitivity?: number;
  sensitivityConfidence?: number;
  chosenProfile?: string;
  profileConfidence?: number;
  agentMessage: string;
}

export const SHARE_SAFETY_PUBLIC_MESSAGE =
  "Orto may apply a public or Cloud profile. Jev does not publish.";

export const SHARE_SAFETY_BLOCK_MESSAGE =
  "Orto is refusing the public profile. Jev does not publish. Use local or vpn, or remove private hostnames and customer identifiers.";

export function shareSafetyQuestions(): Record<string, JudgeQuestion> {
  return {
    safe_outside_trusted_network: safeOutsideQuestion(),
    leaks_internal_urls_or_customers: leaksQuestion(),
    sensitivity: sensitivityQuestion(),
    profile_ok: profileOkQuestion(),
  };
}

export function containsPrivateHostname(text: string): boolean {
  return (
    /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){2,3}\b/.test(text) ||
    /\b[a-z0-9-]+\.internal(?:\.[a-z0-9-]+)+\b/i.test(text) ||
    /\b[a-z0-9-]+\.corp(?:\.[a-z0-9-]+)?\b/i.test(text) ||
    /\b[a-z0-9-]+\.local\b/i.test(text)
  );
}

export function heuristicShareSafety(text: string): ShareSafetyDecision {
  const trimmed = text.trim();
  if (trimmed.length === 0 || containsInlineSecret(trimmed) || containsPrivateHostname(trimmed)) {
    return blockDecision({
      profileOk: "local_only",
      reason:
        trimmed.length === 0
          ? "empty share text; refuse public"
          : containsInlineSecret(trimmed)
            ? "secret pattern; refuse public"
            : "private hostname; cannot pass public_ok",
      source: "heuristic",
    });
  }

  const publicSignals = [
    /\bpublic by design\b/i,
    /\bopen standard\b/i,
    /\bmay be shared publicly\b/i,
    /\bpublic coding standard\b/i,
  ];
  let publicHits = 0;
  for (const pattern of publicSignals) {
    if (pattern.test(trimmed)) {
      publicHits += 1;
    }
  }
  if (publicHits >= 1) {
    return {
      profileOk: "public_ok",
      allowPublic: true,
      reason: "heuristic public-by-design standards",
      source: "heuristic",
      agentMessage: SHARE_SAFETY_PUBLIC_MESSAGE,
    };
  }

  return blockDecision({
    profileOk: "vpn",
    reason: "heuristic uncertain; do not apply public",
    source: "heuristic",
  });
}

export function interpretShareSafety(input: {
  text: string;
  answers: Record<string, JudgeAnswer>;
  confidence: number;
}): ShareSafetyDecision {
  const safe = readNoul(input.answers.safe_outside_trusted_network);
  const leaks = readNoul(input.answers.leaks_internal_urls_or_customers);
  const sensitivity = readScore(input.answers.sensitivity, SHARE_SAFETY_SENSITIVITY_MAX);
  const chosen = readChoice(input.answers.profile_ok);
  const safeBand = safe === undefined ? undefined : noulBand(safe, input.confidence);
  const leaksBand = leaks === undefined ? undefined : noulBand(leaks, input.confidence);
  const privateHosts = containsPrivateHostname(input.text);
  const sensitive =
    sensitivity !== undefined &&
    sensitivity.confidence + 1e-9 >= input.confidence &&
    sensitivity.score + 1e-9 >= SHARE_SAFETY_HIGH_SENSITIVITY;
  const choiceConfident =
    chosen !== undefined &&
    SHARE_PROFILE_OK.includes(chosen.choice as ShareProfileOk) &&
    chosen.confidence + 1e-9 >= input.confidence;

  const base = {
    source: "jev" as const,
    ...(safe !== undefined ? { safeOutside: safe } : {}),
    ...(safeBand !== undefined ? { safeOutsideBand: safeBand } : {}),
    ...(leaks !== undefined ? { leaksInternal: leaks } : {}),
    ...(leaksBand !== undefined ? { leaksInternalBand: leaksBand } : {}),
    ...(sensitivity !== undefined
      ? {
          sensitivity: sensitivity.score,
          sensitivityConfidence: sensitivity.confidence,
        }
      : {}),
    ...(chosen !== undefined
      ? { chosenProfile: chosen.choice, profileConfidence: chosen.confidence }
      : {}),
  };

  const blocked =
    privateHosts ||
    leaksBand === "yes" ||
    safeBand === "no" ||
    sensitive ||
    containsInlineSecret(input.text);

  if (blocked || !choiceConfident || chosen?.choice !== "public_ok" || safeBand !== "yes" || leaksBand !== "no") {
    const profileOk: ShareProfileOk =
      choiceConfident && chosen?.choice === "vpn" && !privateHosts && leaksBand !== "yes"
        ? "vpn"
        : "local_only";
    return {
      ...base,
      profileOk,
      allowPublic: false,
      reason: privateHosts
        ? "private hostname; cannot pass public_ok"
        : leaksBand === "yes"
          ? "leaks internal urls or customers; cannot pass public_ok"
          : safeBand === "no"
            ? "not safe outside the trusted network"
            : sensitive
              ? "sensitivity too high for public_ok"
              : `profile_ok below ${input.confidence.toFixed(2)} or not public_ok`,
      agentMessage: SHARE_SAFETY_BLOCK_MESSAGE,
    };
  }

  return {
    ...base,
    profileOk: "public_ok",
    allowPublic: true,
    reason: "confident public_ok with no leak",
    agentMessage: SHARE_SAFETY_PUBLIC_MESSAGE,
  };
}

export async function judgeShareSafety(input: {
  text: string;
  judge?: Judge;
  confidence: number;
}): Promise<ShareSafetyDecision> {
  if (
    containsInlineSecret(input.text) ||
    containsPrivateHostname(input.text) ||
    input.judge === undefined ||
    input.judge.id === "off" ||
    input.judge.id !== "jev"
  ) {
    return heuristicShareSafety(input.text);
  }

  const state = {
    type: "share_safety",
    text: input.text.slice(0, SHARE_SAFETY_TEXT_MAX_CHARS),
  };

  try {
    assertJevStateSendable(state);
  } catch {
    return heuristicShareSafety(input.text);
  }

  const result = await input.judge.evaluate({
    state,
    questions: shareSafetyQuestions(),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    return heuristicShareSafety(input.text);
  }

  return interpretShareSafety({
    text: input.text,
    answers: result.answers,
    confidence: input.confidence,
  });
}

export function formatShareSafetyLines(input: {
  decision: ShareSafetyDecision;
  dryRun?: boolean;
}): string[] {
  const prefix = input.dryRun === true ? "[dry-run] " : "";
  const lines = [
    `${prefix}Share safety: ${input.decision.profileOk} (${input.decision.source})`,
    `${prefix}allow public: ${input.decision.allowPublic ? "yes" : "no"}`,
    `${prefix}reason: ${input.decision.reason}`,
    `${prefix}agent: ${input.decision.agentMessage}`,
  ];
  if (input.decision.safeOutside !== undefined && input.decision.safeOutsideBand !== undefined) {
    lines.push(
      `${prefix}safe_outside_trusted_network: ${input.decision.safeOutside.toFixed(2)} ${input.decision.safeOutsideBand}`,
    );
  }
  if (input.decision.leaksInternal !== undefined && input.decision.leaksInternalBand !== undefined) {
    lines.push(
      `${prefix}leaks_internal_urls_or_customers: ${input.decision.leaksInternal.toFixed(2)} ${input.decision.leaksInternalBand}`,
    );
  }
  if (input.decision.sensitivity !== undefined) {
    lines.push(`${prefix}sensitivity: ${input.decision.sensitivity.toFixed(0)}`);
  }
  return lines;
}

function blockDecision(input: {
  profileOk: ShareProfileOk;
  reason: string;
  source: ShareSafetySource;
}): ShareSafetyDecision {
  return {
    profileOk: input.profileOk,
    allowPublic: false,
    reason: input.reason,
    source: input.source,
    agentMessage: SHARE_SAFETY_BLOCK_MESSAGE,
  };
}

function safeOutsideQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions:
      "Is this knowledge safe to expose outside the trusted network (public self-host or Cloud)?",
    criteria: {
      true: "Public-by-design standards or docs with no private hosts, customers, or internal URLs.",
      false: "Internal runbooks, private hostnames, customer names, or trusted-network-only steps.",
    },
  };
}

function leaksQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions:
      "Does this text leak internal URLs, private hostnames, or customer identifiers?",
    criteria: {
      true: "Contains private hostnames, RFC1918 addresses, customer names, or internal service URLs.",
      false: "No internal URLs, private hosts, or customer identifiers.",
    },
  };
}

function sensitivityQuestion(): ScoreQuestion {
  return {
    type: "score",
    instructions:
      "How sensitive is this text if the bank is reachable outside the trusted network? 0 is public-by-design. 3 is internal-only.",
    criteria: [
      "0 public-by-design standards",
      "1 low",
      "2 internal operational detail",
      "3 private hosts, customers, or secrets",
    ],
  };
}

function profileOkQuestion(): ChoiceQuestion {
  return {
    type: "choice",
    instructions:
      "Which deployment profile may Orto apply? Choose public_ok only when the text is safe outside the trusted network and does not leak internal URLs or customers. Jev does not publish. Orto applies the profile.",
    criteria: {
      local_only: {
        what: "Keep the bank on localhost. Do not apply public or Cloud.",
        not_for: "A public-by-design standards document.",
        examples: ["Runbook that SSHes to db.internal.corp and 10.0.4.12."],
      },
      vpn: {
        what: "VPN or trusted-network reachability only.",
        not_for: "Text that names private hosts or customers.",
        examples: ["Team architecture notes with no public audience."],
      },
      public_ok: {
        what: "Public self-host or Cloud is acceptable. Orto may apply that profile.",
        not_for: "Internal runbooks, private hostnames, or customer leaks.",
        examples: ["Coding standards that are public by design."],
      },
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

function readChoice(
  answer: JudgeAnswer | undefined,
): { choice: string; confidence: number } | undefined {
  if (answer === undefined || answer.type !== "choice") {
    return undefined;
  }
  if (!Number.isFinite(answer.confidence) || answer.choice.trim() === "") {
    return undefined;
  }
  return { choice: answer.choice, confidence: answer.confidence };
}
