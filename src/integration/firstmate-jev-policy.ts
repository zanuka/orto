import {
  NEEDS_BANK_DEFAULT_CONFIDENCE,
  NEEDS_BANK_ENV,
} from "../judge/firstmate-needs-bank.js";

export function buildFirstmateNeedsBankPolicyNotes(): string[] {
  const threshold = NEEDS_BANK_DEFAULT_CONFIDENCE.toFixed(1);
  return [
    `Optional Jev reflex (captain-only): before recall/reflect or project-bank, ask Noul needs_project_bank via judgeFirstmateNeedsBank (default --confidence ${threshold}).`,
    `Opt in with ${NEEDS_BANK_ENV}=1. Confident no → skip_bank (pure code, no recall/reflect). Confident yes → use_bank. Below ${threshold} → escalate to the captain.`,
    "Jev is a reflex for the mate, not a crewmate. Do not embed TypeSafe keys in this repo; wire ORTO_TYPESAFE_API_KEY in the captain environment when enabling the gate.",
  ];
}
