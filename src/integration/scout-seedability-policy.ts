import {
  SCOUT_SEEDABILITY_DEFAULT_CONFIDENCE,
  SCOUT_SEEDABILITY_ENV,
} from "../judge/scout-seedability.js";

export const TYPESAFE_AGENT_SKILL_URL =
  "https://docs.typesafe.ai/agent-skill.md";

export function buildScoutSeedabilityPolicyNotes(): string[] {
  const threshold = SCOUT_SEEDABILITY_DEFAULT_CONFIDENCE.toFixed(1);
  return [
    `Optional Jev gate for scout/investigation reports (typically data/<id>/report.md): ask Noul is_durable_scout_report + is_scratch_pad and Choice action via judgeScoutSeedability (default --confidence ${threshold}): seed | skip | review.`,
    `Opt in with ${SCOUT_SEEDABILITY_ENV}=1. Durable findings → queue orto store/seed (never MCP-retain). Scratch pads → skip. Uncertain → review with the captain/operator.`,
    `Captains may install TypeSafe's official agent skill for Claude Code / Codex from ${TYPESAFE_AGENT_SKILL_URL}. Orto does not wrap TypeSafe's marketplace or installer.`,
    "Orto targets Claude Code, Codex, Cursor, Pi, and other popular agentic workflows. Firstmate and custom orchestrators use the same helper. Do not embed TypeSafe keys in this repo; wire ORTO_TYPESAFE_API_KEY in the harness environment when enabling the gate.",
  ];
}
