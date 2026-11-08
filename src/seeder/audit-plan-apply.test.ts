import { describe, expect, it } from "vitest";
import type { AuditPlanFile } from "./audit-plan.js";
import {
  assertAuditPlanNotStale,
  selectAuditPlanActions,
} from "./audit-plan-apply.js";

function plan(items: AuditPlanFile["items"]): AuditPlanFile {
  return {
    version: 1,
    bankId: "fixture",
    createdAt: "2026-11-08T00:00:00.000Z",
    confidence: 0.8,
    items,
  };
}

describe("selectAuditPlanActions", () => {
  it("does not select deletes without allowDelete", () => {
    const selections = selectAuditPlanActions({
      plan: plan([
        {
          id: "orto:docs/a.md#x",
          action: "delete_candidate",
          confidence: 0.9,
          reason: "action=delete_candidate",
        },
        {
          id: "architecture-decisions",
          action: "refresh_mental_model",
          confidence: 0.91,
          reason: "action=refresh",
          layer: "mental_model",
        },
      ]),
      allowDelete: false,
      applied: null,
    });
    expect(selections.find((row) => row.item.id === "orto:docs/a.md#x")).toMatchObject({
      disposition: "skip_delete_not_allowed",
      effect: "none",
    });
    expect(
      selections.find((row) => row.item.id === "architecture-decisions"),
    ).toMatchObject({
      disposition: "apply",
      effect: "refresh_mental_model",
    });
  });

  it("applies delete_candidate only when allowDelete is set", () => {
    const selections = selectAuditPlanActions({
      plan: plan([
        {
          id: "orto:docs/a.md#x",
          action: "delete_candidate",
          confidence: 0.9,
          reason: "action=delete_candidate",
        },
      ]),
      allowDelete: true,
      applied: null,
    });
    expect(selections[0]).toMatchObject({
      disposition: "apply",
      effect: "delete",
    });
  });

  it("skips low confidence and review-only rows", () => {
    const selections = selectAuditPlanActions({
      plan: plan([
        {
          id: "low",
          action: "archive",
          confidence: 0.4,
          reason: "below",
        },
        {
          id: "retarget",
          action: "keep",
          confidence: 0.9,
          reason: "retarget",
          reviewOnly: true,
          freshnessAction: "retarget_query",
        },
      ]),
      allowDelete: false,
      applied: null,
    });
    expect(selections[0]?.disposition).toBe("skip_low_confidence");
    expect(selections[1]?.disposition).toBe("skip_review_only");
  });

  it("skips already-applied rows for idempotency", () => {
    const selections = selectAuditPlanActions({
      plan: plan([
        {
          id: "architecture-decisions",
          action: "refresh_mental_model",
          confidence: 0.9,
          reason: "action=refresh",
        },
      ]),
      allowDelete: false,
      applied: {
        version: 1,
        bankId: "fixture",
        planCreatedAt: "2026-11-08T00:00:00.000Z",
        planPath: "/tmp/plan.json",
        appliedAt: "2026-11-08T01:00:00.000Z",
        items: {
          "architecture-decisions": {
            action: "refresh_mental_model",
            appliedAt: "2026-11-08T01:00:00.000Z",
            effect: "refresh_mental_model",
          },
        },
      },
    });
    expect(selections[0]?.disposition).toBe("skip_already_applied");
  });
});

describe("assertAuditPlanNotStale", () => {
  it("refuses when plan ids are missing from the bank", () => {
    expect(() =>
      assertAuditPlanNotStale({
        plan: plan([
          {
            id: "missing-doc",
            action: "archive",
            confidence: 0.9,
            reason: "gone",
          },
        ]),
        knownIds: new Set(["present"]),
        applied: null,
      }),
    ).toThrow(/stale/);
  });

  it("allows missing ids that were already applied", () => {
    expect(() =>
      assertAuditPlanNotStale({
        plan: plan([
          {
            id: "deleted-doc",
            action: "delete_candidate",
            confidence: 0.9,
            reason: "delete",
          },
        ]),
        knownIds: new Set(),
        applied: {
          version: 1,
          bankId: "fixture",
          planCreatedAt: "2026-11-08T00:00:00.000Z",
          planPath: "/tmp/plan.json",
          appliedAt: "2026-11-08T01:00:00.000Z",
          items: {
            "deleted-doc": {
              action: "delete_candidate",
              appliedAt: "2026-11-08T01:00:00.000Z",
              effect: "delete",
            },
          },
        },
      }),
    ).not.toThrow();
  });
});
