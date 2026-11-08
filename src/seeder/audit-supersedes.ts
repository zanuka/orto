import { join } from "node:path";
import { ortoDir } from "../config/paths.js";
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from "../utils/fs.js";

export interface AuditSupersedeEntry {
  id: string;
  reason: string;
  recordedAt: string;
  deleted?: boolean;
}

export interface AuditSupersedesFile {
  version: 1;
  bankId: string;
  updatedAt: string;
  entries: Record<string, AuditSupersedeEntry>;
}

export function auditSupersedesPath(projectRoot: string): string {
  return join(ortoDir(projectRoot), "local", "audit-supersedes.json");
}

export async function loadAuditSupersedes(
  projectRoot: string,
): Promise<AuditSupersedesFile> {
  const path = auditSupersedesPath(projectRoot);
  if (!(await pathExists(path))) {
    return {
      version: 1,
      bankId: "",
      updatedAt: new Date().toISOString(),
      entries: {},
    };
  }
  const raw = await readJsonFile<unknown>(path);
  if (
    raw === null ||
    typeof raw !== "object" ||
    (raw as { version?: unknown }).version !== 1
  ) {
    return {
      version: 1,
      bankId: "",
      updatedAt: new Date().toISOString(),
      entries: {},
    };
  }
  return raw as AuditSupersedesFile;
}

export async function recordAuditSupersede(input: {
  projectRoot: string;
  bankId: string;
  id: string;
  reason: string;
  deleted?: boolean;
}): Promise<void> {
  const current = await loadAuditSupersedes(input.projectRoot);
  current.bankId = input.bankId;
  current.updatedAt = new Date().toISOString();
  current.entries[input.id] = {
    id: input.id,
    reason: input.reason,
    recordedAt: new Date().toISOString(),
    ...(input.deleted === true ? { deleted: true } : {}),
  };
  await ensureDir(join(ortoDir(input.projectRoot), "local"));
  await writeJsonFile(auditSupersedesPath(input.projectRoot), current, false);
}
