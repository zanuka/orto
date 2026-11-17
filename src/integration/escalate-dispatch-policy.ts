import {
  ESCALATE_DISPATCH_DEFAULT_CONFIDENCE,
  ESCALATE_DISPATCH_ENV,
} from "../judge/escalate-dispatch.js";

export function buildEscalateDispatchPolicyNotes(): string[] {
  const threshold = ESCALATE_DISPATCH_DEFAULT_CONFIDENCE.toFixed(1);
  return [
    `Optional Jev gate for multi-agent workflows: before dispatching work, ask Noul needs_captain + Choice crewmate via judgeEscalateDispatch (default --confidence ${threshold}).`,
    `Opt in with ${ESCALATE_DISPATCH_ENV}=1. Pass the distro's charter list (never invent crewmates). Empty list → ask_captain only. Confident needs_captain → escalate. Routine typo/test-fix with a listed implementer → dispatch.`,
    "Orto targets Claude Code, Codex, Cursor, Pi, and other popular agentic workflows. Firstmate and custom orchestrators use the same helper. Do not embed TypeSafe keys in this repo; wire ORTO_TYPESAFE_API_KEY in the harness environment when enabling the gate.",
  ];
}
