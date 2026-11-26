import type { BankOperationSummary } from "../providers/hindsight/client.js";

export interface QuietPolicyConfig {
  maxPendingOps: number;
  stuckStageAgeSeconds: number;
  cooldownSeconds: number;
}

export function defaultQuietPolicyConfig(): QuietPolicyConfig {
  return {
    maxPendingOps: 0,
    stuckStageAgeSeconds: 300,
    cooldownSeconds: 60,
  };
}

export interface BankOperationsSnapshot {
  bankId: string;
  operations: readonly BankOperationSummary[];
}

export interface QuietPolicyResult {
  quiet: boolean;
  reasons: string[];
  pendingOps: number;
  stuckOps: number;
  checkedBanks: string[];
}

const ACTIVE_STATUSES = new Set([
  "pending",
  "processing",
  "running",
  "in_progress",
  "queued",
]);

function isActiveOperation(op: BankOperationSummary): boolean {
  const status = (op.status ?? "").toLowerCase();
  return ACTIVE_STATUSES.has(status);
}

export function evaluateQuietPolicy(input: {
  snapshots: readonly BankOperationsSnapshot[];
  config?: Partial<QuietPolicyConfig>;
  nowMs?: number;
}): QuietPolicyResult {
  const defaults = defaultQuietPolicyConfig();
  const config: QuietPolicyConfig = {
    maxPendingOps: input.config?.maxPendingOps ?? defaults.maxPendingOps,
    stuckStageAgeSeconds:
      input.config?.stuckStageAgeSeconds ?? defaults.stuckStageAgeSeconds,
    cooldownSeconds: input.config?.cooldownSeconds ?? defaults.cooldownSeconds,
  };
  const nowMs = input.nowMs ?? Date.now();

  const reasons: string[] = [];
  const checkedBanks: string[] = [];
  let totalPending = 0;
  let totalStuck = 0;

  for (const snapshot of input.snapshots) {
    checkedBanks.push(snapshot.bankId);
    let bankPending = 0;
    let bankStuck = 0;
    let recentActivityMs: number | undefined;

    for (const op of snapshot.operations) {
      if (isActiveOperation(op)) {
        bankPending += 1;
        if (
          typeof op.stage_age === "number" &&
          Number.isFinite(op.stage_age) &&
          op.stage_age >= config.stuckStageAgeSeconds
        ) {
          bankStuck += 1;
        }
      }
      if (op.updated_at) {
        const parsed = Date.parse(op.updated_at);
        if (Number.isFinite(parsed)) {
          if (recentActivityMs === undefined || parsed > recentActivityMs) {
            recentActivityMs = parsed;
          }
        }
      }
    }

    totalPending += bankPending;
    totalStuck += bankStuck;

    if (bankPending > config.maxPendingOps) {
      reasons.push(
        `bank "${snapshot.bankId}" has ${bankPending} pending operation(s) (max ${config.maxPendingOps})`,
      );
    }
    if (bankStuck > 0) {
      reasons.push(
        `bank "${snapshot.bankId}" has ${bankStuck} stuck operation(s) (stage_age >= ${config.stuckStageAgeSeconds}s)`,
      );
    }
    if (
      bankPending === 0 &&
      recentActivityMs !== undefined &&
      config.cooldownSeconds > 0
    ) {
      const elapsedSeconds = (nowMs - recentActivityMs) / 1000;
      if (elapsedSeconds >= 0 && elapsedSeconds < config.cooldownSeconds) {
        const remaining = Math.ceil(config.cooldownSeconds - elapsedSeconds);
        reasons.push(
          `bank "${snapshot.bankId}" is in cooldown (${remaining}s remaining)`,
        );
      }
    }
  }

  return {
    quiet: reasons.length === 0,
    reasons,
    pendingOps: totalPending,
    stuckOps: totalStuck,
    checkedBanks,
  };
}
