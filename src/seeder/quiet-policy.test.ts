import { describe, expect, it } from "vitest";
import { evaluateQuietPolicy } from "./quiet-policy.js";

describe("evaluateQuietPolicy", () => {
  it("returns quiet when no operations are active and cooldown elapsed", () => {
    const nowMs = Date.parse("2026-11-26T12:00:00.000Z");
    const result = evaluateQuietPolicy({
      snapshots: [
        {
          bankId: "orto",
          operations: [
            {
              id: "op-1",
              status: "completed",
              updated_at: "2026-11-26T11:50:00.000Z",
            },
          ],
        },
        {
          bankId: "coding-agent::orto",
          operations: [],
        },
      ],
      nowMs,
    });
    expect(result.quiet).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.pendingOps).toBe(0);
    expect(result.stuckOps).toBe(0);
  });

  it("blocks when coding-agent bank has pending batch_retain operations", () => {
    const result = evaluateQuietPolicy({
      snapshots: [
        { bankId: "orto", operations: [] },
        {
          bankId: "coding-agent::orto",
          operations: [
            { id: "op-1", status: "pending", operation_type: "batch_retain" },
            { id: "op-2", status: "processing", stage_age: 420 },
          ],
        },
      ],
    });
    expect(result.quiet).toBe(false);
    expect(result.pendingOps).toBe(2);
    expect(result.stuckOps).toBe(1);
    expect(result.reasons.some((r) => r.includes("coding-agent::orto"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("stuck"))).toBe(true);
  });

  it("blocks during cooldown right after recent coding-agent activity", () => {
    const nowMs = Date.parse("2026-11-26T12:00:30.000Z");
    const result = evaluateQuietPolicy({
      snapshots: [
        {
          bankId: "coding-agent::orto",
          operations: [
            {
              id: "op-1",
              status: "completed",
              updated_at: "2026-11-26T12:00:00.000Z",
            },
          ],
        },
      ],
      nowMs,
    });
    expect(result.quiet).toBe(false);
    expect(result.reasons.some((r) => r.includes("cooldown"))).toBe(true);
  });
});
