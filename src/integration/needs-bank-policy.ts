import {
  NEEDS_BANK_DEFAULT_CONFIDENCE,
  NEEDS_BANK_ENV,
} from "../judge/needs-bank.js";

export function buildNeedsBankPolicyNotes(): string[] {
  const threshold = NEEDS_BANK_DEFAULT_CONFIDENCE.toFixed(1);
  return [
    `Optional Jev gate for any agent workflow: before recall/reflect or attaching bank context, ask Noul needs_project_bank via judgeNeedsBank (default --confidence ${threshold}).`,
    `Opt in with ${NEEDS_BANK_ENV}=1. Confident no → skip_bank (pure code, no recall/reflect). Confident yes → use_bank. Below ${threshold} → escalate to the operator.`,
    "Orto targets Claude Code, Codex, Cursor, Pi, and other popular agentic workflows. Firstmate and custom orchestrators use the same helper. Do not embed TypeSafe keys in this repo; wire ORTO_TYPESAFE_API_KEY in the harness environment when enabling the gate.",
  ];
}
