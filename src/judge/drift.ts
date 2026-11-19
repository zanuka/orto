import type { AuditDecision } from "./audit.js";

export const DRIFT_SAMPLE_DEFAULT = 20;
export const DRIFT_SAMPLE_MAX = 50;

export type DriftMode = "hash" | "jev";

export interface DriftSample {
  id: string;
  supported: boolean;
}

export interface DriftSummary {
  supported: number;
  sampled: number;
  sampledAt: string;
  percentSupported: number | null;
  mode: DriftMode;
  samples: DriftSample[];
}

export function clampDriftSample(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DRIFT_SAMPLE_DEFAULT;
  }
  const floored = Math.floor(value);
  if (floored < 1) {
    return 1;
  }
  return Math.min(floored, DRIFT_SAMPLE_MAX);
}

export function summarizeDrift(input: {
  samples: readonly DriftSample[];
  sampledAt: string;
  mode: DriftMode;
  limit?: number;
}): DriftSummary {
  const cap = clampDriftSample(input.limit);
  const samples = input.samples.slice(0, cap);
  const supported = samples.filter((sample) => sample.supported).length;
  const sampled = samples.length;
  return {
    supported,
    sampled,
    sampledAt: input.sampledAt,
    percentSupported: sampled === 0 ? null : Math.round((supported / sampled) * 100),
    mode: input.mode,
    samples,
  };
}

export function driftFromAuditDecisions(input: {
  decisions: readonly AuditDecision[];
  sampledAt: string;
  limit?: number;
}): DriftSummary {
  const samples = input.decisions
    .filter((decision) => decision.layer === "document" || decision.stillSupportedBand !== undefined)
    .map((decision) => ({
      id: decision.id,
      supported: decision.stillSupportedBand === "yes",
    }));
  return summarizeDrift({
    samples,
    sampledAt: input.sampledAt,
    mode: "jev",
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  });
}

export function formatDriftLine(summary: DriftSummary): string {
  const percent =
    summary.percentSupported === null ? "n/a" : `${summary.percentSupported}%`;
  const date = summary.sampledAt.slice(0, 10);
  return `Drift: ${summary.supported}/${summary.sampled} supported (${percent}) as of ${date}`;
}
