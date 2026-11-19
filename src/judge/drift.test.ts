import { describe, expect, it } from "vitest";
import {
  DRIFT_SAMPLE_DEFAULT,
  DRIFT_SAMPLE_MAX,
  clampDriftSample,
  driftFromAuditDecisions,
  formatDriftLine,
  summarizeDrift,
} from "./drift.js";
import type { AuditDecision } from "./audit.js";

describe("bank drift", () => {
  it("bounds the sample", () => {
    expect(clampDriftSample(undefined)).toBe(DRIFT_SAMPLE_DEFAULT);
    expect(clampDriftSample(0)).toBe(1);
    expect(clampDriftSample(100)).toBe(DRIFT_SAMPLE_MAX);
    const samples = Array.from({ length: 80 }, (_, index) => ({
      id: `doc-${index}`,
      supported: index % 2 === 0,
    }));
    const summary = summarizeDrift({
      samples,
      sampledAt: "2026-11-19T05:00:00.000Z",
      mode: "hash",
    });
    expect(summary.sampled).toBe(DRIFT_SAMPLE_DEFAULT);
    expect(summary.samples).toHaveLength(DRIFT_SAMPLE_DEFAULT);
  });

  it("formats supported / sampled and a date", () => {
    const summary = summarizeDrift({
      samples: [
        { id: "a", supported: true },
        { id: "b", supported: true },
        { id: "c", supported: false },
      ],
      sampledAt: "2026-11-19T05:00:00.000Z",
      mode: "hash",
      limit: 10,
    });
    expect(formatDriftLine(summary)).toBe("Drift: 2/3 supported (67%) as of 2026-11-19");
    expect(summarizeDrift({
      samples: [],
      sampledAt: "2026-11-19T05:00:00.000Z",
      mode: "hash",
      limit: 10,
    }).percentSupported).toBeNull();
  });

  it("counts only a confident still-supported answer", () => {
    const decisions: AuditDecision[] = [
      {
        id: "kept",
        action: "keep",
        confidence: 0.9,
        reason: "supported",
        layer: "document",
        stillSupportedBand: "yes",
      },
      {
        id: "review",
        action: "keep",
        confidence: 0.4,
        reason: "review",
        layer: "document",
        stillSupportedBand: "uncertain",
      },
      {
        id: "model",
        action: "refresh_mental_model",
        confidence: 0.9,
        reason: "freshness",
        layer: "mental_model",
      },
    ];
    const summary = driftFromAuditDecisions({
      decisions,
      sampledAt: "2026-11-19T05:00:00.000Z",
      limit: 20,
    });
    expect(summary.mode).toBe("jev");
    expect(summary.supported).toBe(1);
    expect(summary.sampled).toBe(2);
    expect(summary.samples.map((sample) => sample.id)).toEqual(["kept", "review"]);
  });
});
