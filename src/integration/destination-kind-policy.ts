import {
  DESTINATION_KIND_DEFAULT_CONFIDENCE,
  DESTINATION_KIND_ENV,
} from "../judge/destination-kind.js";

export function buildDestinationKindPolicyNotes(): string[] {
  const threshold = DESTINATION_KIND_DEFAULT_CONFIDENCE.toFixed(1);
  return [
    `Optional Jev gate: Choice destination_kind via judgeDestinationKind (default --confidence ${threshold}): institutional | personal_preference | temporal_episode.`,
    `Opt in with ${DESTINATION_KIND_ENV}=1. Route on the kind of knowledge. institutional stays on Hindsight. personal_preference uses Mem0 only when that provider is configured. temporal_episode uses Graphiti only when that provider is configured. An unconfigured kind defaults to Hindsight and warns. It does not crash.`,
    "judgeBankRoute (JEV-32) still chooses which Hindsight bank, and only when this route stays on Hindsight. Mem0 and Graphiti adapters are not a second default. Do not embed TypeSafe keys in this repo.",
  ];
}
