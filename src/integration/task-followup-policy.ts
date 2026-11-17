import {
  TASK_FOLLOWUP_DEFAULT_CONFIDENCE,
  TASK_FOLLOWUP_ENV,
} from "../judge/task-followup.js";

export function buildTaskFollowupPolicyNotes(): string[] {
  const threshold = TASK_FOLLOWUP_DEFAULT_CONFIDENCE.toFixed(1);
  return [
    `Optional Jev gate for any agent workflow: after a PR/merge/task summary, ask Choice followup via judgeTaskFollowup (default --confidence ${threshold}): retain_to_bank | pr_only | both.`,
    `Opt in with ${TASK_FOLLOWUP_ENV}=1. ADR/standards merges → retain_to_bank or both (queue orto store/seed; never MCP-retain). Pure bugfix PRs → pr_only. Below ${threshold} → escalate to the operator.`,
    "Orto targets Claude Code, Codex, Cursor, Pi, and other popular agentic workflows. Firstmate and custom orchestrators use the same helper. Do not embed TypeSafe keys in this repo; wire ORTO_TYPESAFE_API_KEY in the harness environment when enabling the gate.",
  ];
}
