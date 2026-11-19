import {
  BANK_ROUTE_DEFAULT_CONFIDENCE,
  BANK_ROUTE_ENV,
} from "../judge/bank-route.js";

export function buildBankRoutePolicyNotes(): string[] {
  const threshold = BANK_ROUTE_DEFAULT_CONFIDENCE.toFixed(1);
  return [
    `Optional Jev gate when two or more company-brain banks are configured: Choice bank via judgeBankRoute (default --confidence ${threshold}) from those bank ids plus current and ask.`,
    `Opt in with ${BANK_ROUTE_ENV}=1. A single configured bank never sees this prompt and keeps using in_scope. A design-token section routes to the design-system bank and does not seed the billing bank. Uncertain → ask. Do not invent bank ids.`,
    "Multi-bank retain stays on the later seed CLI. This helper only decides the route. Orto targets Claude Code, Codex, Cursor, Pi, and other popular agentic workflows. Do not embed TypeSafe keys in this repo.",
  ];
}
