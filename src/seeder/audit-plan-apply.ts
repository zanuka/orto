import { join } from "node:path";
import { ortoDir } from "../config/paths.js";
import { OrtoError } from "../utils/errors.js";
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from "../utils/fs.js";
import {
  type AuditPlanFile,
  type AuditPlanItem,
  auditPlanPath,
} from "./audit-plan.js";

export type AuditApplyDisposition =
  | "apply"
  | "skip_keep"
  | "skip_low_confidence"
  | "skip_review_only"
  | "skip_already_applied"
  | "skip_delete_not_allowed"
  | "skip_unsupported";

export interface AuditApplySelection {
  item: AuditPlanItem;
  disposition: AuditApplyDisposition;
  effect:
    | "none"
    | "refresh_mental_model"
    | "archive"
    | "supersede"
    | "delete";
}

export interface AuditAppliedEntry {
  action: string;
  appliedAt: string;
  effect: string;
}

export interface AuditAppliedState {
  version: 1;
  bankId: string;
  planCreatedAt: string;
  planPath: string;
  appliedAt: string;
  items: Record<string, AuditAppliedEntry>;
}

export function auditAppliedPath(projectRoot: string): string {
  return join(ortoDir(projectRoot), "local", "audit-plan-applied.json");
}

export async function loadAuditPlanFile(path: string): Promise<AuditPlanFile> {
  if (!(await pathExists(path))) {
    throw new OrtoError(
      `Audit plan not found at ${path}`,
      "Run `orto audit --judge jev` first, or pass --plan <path>.",
    );
  }
  const raw = await readJsonFile<unknown>(path);
  if (
    raw === null ||
    typeof raw !== "object" ||
    (raw as { version?: unknown }).version !== 1 ||
    typeof (raw as { bankId?: unknown }).bankId !== "string" ||
    !Array.isArray((raw as { items?: unknown }).items)
  ) {
    throw new OrtoError(
      `Invalid audit plan at ${path}`,
      "Re-run `orto audit --judge jev` to regenerate `.orto/local/audit-plan.json`.",
    );
  }
  return raw as AuditPlanFile;
}

export async function loadAuditAppliedState(
  projectRoot: string,
): Promise<AuditAppliedState | null> {
  const path = auditAppliedPath(projectRoot);
  if (!(await pathExists(path))) {
    return null;
  }
  const raw = await readJsonFile<unknown>(path);
  if (
    raw === null ||
    typeof raw !== "object" ||
    (raw as { version?: unknown }).version !== 1
  ) {
    return null;
  }
  return raw as AuditAppliedState;
}

export async function saveAuditAppliedState(
  projectRoot: string,
  state: AuditAppliedState,
): Promise<void> {
  await ensureDir(join(ortoDir(projectRoot), "local"));
  await writeJsonFile(auditAppliedPath(projectRoot), state, false);
}

export function resolveAuditPlanPath(
  projectRoot: string,
  planOption?: string,
): string {
  if (planOption === undefined || planOption.trim() === "") {
    return auditPlanPath(projectRoot);
  }
  return planOption.startsWith("/")
    ? planOption
    : join(projectRoot, planOption);
}

export function assertAuditPlanBank(
  plan: AuditPlanFile,
  bankId: string,
): void {
  if (plan.bankId !== bankId) {
    throw new OrtoError(
      `Audit plan bank "${plan.bankId}" does not match config bank "${bankId}"`,
      "Re-run `orto audit --judge jev` for this project, or pass the matching --plan.",
    );
  }
}

export function assertAuditPlanNotStale(input: {
  plan: AuditPlanFile;
  knownIds: ReadonlySet<string>;
  applied: AuditAppliedState | null;
}): void {
  const missing: string[] = [];
  for (const item of input.plan.items) {
    if (input.knownIds.has(item.id)) {
      continue;
    }
    const prior = input.applied?.items[item.id];
    if (prior !== undefined && prior.action === item.action) {
      continue;
    }
    missing.push(item.id);
  }
  if (missing.length > 0) {
    throw new OrtoError(
      `Audit plan is stale vs current bank ids (${missing.length} missing)`,
      `Missing: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""}. Re-run \`orto audit --judge jev\`.`,
    );
  }
}

export function selectAuditPlanActions(input: {
  plan: AuditPlanFile;
  allowDelete: boolean;
  applied: AuditAppliedState | null;
}): AuditApplySelection[] {
  const threshold = input.plan.confidence;
  return input.plan.items.map((item) => {
    const prior = input.applied?.items[item.id];
    if (
      prior !== undefined &&
      prior.action === item.action &&
      input.applied?.planCreatedAt === input.plan.createdAt
    ) {
      return {
        item,
        disposition: "skip_already_applied" as const,
        effect: "none" as const,
      };
    }
    if (item.reviewOnly === true) {
      return {
        item,
        disposition: "skip_review_only" as const,
        effect: "none" as const,
      };
    }
    if (item.confidence + 1e-9 < threshold) {
      return {
        item,
        disposition: "skip_low_confidence" as const,
        effect: "none" as const,
      };
    }
    if (item.action === "keep") {
      return {
        item,
        disposition: "skip_keep" as const,
        effect: "none" as const,
      };
    }
    if (item.action === "refresh_mental_model") {
      return {
        item,
        disposition: "apply" as const,
        effect: "refresh_mental_model" as const,
      };
    }
    if (item.action === "archive") {
      return {
        item,
        disposition: "apply" as const,
        effect: "archive" as const,
      };
    }
    if (item.action === "supersede") {
      return {
        item,
        disposition: "apply" as const,
        effect: "supersede" as const,
      };
    }
    if (item.action === "delete_candidate") {
      if (!input.allowDelete) {
        return {
          item,
          disposition: "skip_delete_not_allowed" as const,
          effect: "none" as const,
        };
      }
      return {
        item,
        disposition: "apply" as const,
        effect: "delete" as const,
      };
    }
    return {
      item,
      disposition: "skip_unsupported" as const,
      effect: "none" as const,
    };
  });
}

export function formatAuditApplySummary(input: {
  selections: readonly AuditApplySelection[];
  apply: boolean;
  allowDelete: boolean;
}): string[] {
  const prefix = input.apply ? "" : "[preview] ";
  const counts = {
    apply: 0,
    refresh: 0,
    archive: 0,
    supersede: 0,
    delete: 0,
    skipped: 0,
    blockedDelete: 0,
  };
  for (const row of input.selections) {
    if (row.disposition === "apply") {
      counts.apply += 1;
      if (row.effect === "refresh_mental_model") counts.refresh += 1;
      if (row.effect === "archive") counts.archive += 1;
      if (row.effect === "supersede") counts.supersede += 1;
      if (row.effect === "delete") counts.delete += 1;
    } else if (row.disposition === "skip_delete_not_allowed") {
      counts.blockedDelete += 1;
      counts.skipped += 1;
    } else {
      counts.skipped += 1;
    }
  }
  const lines = [
    `${prefix}Audit plan apply summary:`,
    `${prefix}would_apply=${counts.apply} refresh=${counts.refresh} archive=${counts.archive} supersede=${counts.supersede} delete=${counts.delete} skipped=${counts.skipped}`,
  ];
  if (counts.blockedDelete > 0 && !input.allowDelete) {
    lines.push(
      `${prefix}${counts.blockedDelete} delete_candidate row(s) skipped (pass --allow-delete to delete).`,
    );
  }
  if (!input.apply) {
    lines.push(
      `${prefix}Nothing mutated. Re-run with --apply to execute high-confidence allowed actions.`,
    );
  }
  return lines;
}
