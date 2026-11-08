import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ortoDir } from "../config/paths.js";
import { extractFromSource } from "../extractor/extract.js";
import type { AuditDecision, AuditItemState } from "../judge/audit.js";
import type { DocumentSummary } from "../providers/hindsight/client.js";
import type { DurableSource } from "../scanner/durable-sources.js";
import { ensureDir, pathExists, writeJsonFile } from "../utils/fs.js";
import { loadSeedManifest } from "./manifest.js";
import { parseDocumentId } from "./prune-plan.js";
import { loadRetainedSources } from "./retained-sources.js";

export interface AuditPlanFile {
  version: 1;
  bankId: string;
  createdAt: string;
  confidence: number;
  items: AuditPlanItem[];
}

export interface AuditPlanItem {
  id: string;
  action: string;
  confidence: number;
  reason: string;
  stillSupportedByRepo?: number;
  superseded?: number;
  chosenAction?: string;
  actionConfidence?: number;
}

export function auditPlanPath(projectRoot: string): string {
  return join(ortoDir(projectRoot), "local", "audit-plan.json");
}

export async function saveAuditPlan(
  projectRoot: string,
  plan: AuditPlanFile,
): Promise<void> {
  const path = auditPlanPath(projectRoot);
  await ensureDir(join(ortoDir(projectRoot), "local"));
  await writeJsonFile(path, plan, false);
}

export function toAuditPlanFile(input: {
  bankId: string;
  confidence: number;
  decisions: readonly AuditDecision[];
}): AuditPlanFile {
  return {
    version: 1,
    bankId: input.bankId,
    createdAt: new Date().toISOString(),
    confidence: input.confidence,
    items: input.decisions.map((decision) => {
      const item: AuditPlanItem = {
        id: decision.id,
        action: decision.action,
        confidence: decision.confidence,
        reason: decision.reason,
      };
      if (decision.stillSupportedByRepo !== undefined) {
        item.stillSupportedByRepo = decision.stillSupportedByRepo;
      }
      if (decision.superseded !== undefined) {
        item.superseded = decision.superseded;
      }
      if (decision.chosenAction !== undefined) {
        item.chosenAction = decision.chosenAction;
      }
      if (decision.actionConfidence !== undefined) {
        item.actionConfidence = decision.actionConfidence;
      }
      return item;
    }),
  };
}

export async function buildAuditItems(input: {
  projectRoot: string;
  documents: readonly DocumentSummary[];
  bankMission?: string;
  limit?: number;
}): Promise<AuditItemState[]> {
  const manifest = await loadSeedManifest(input.projectRoot);
  const retained = await loadRetainedSources(input.projectRoot);
  const docs =
    input.limit === undefined
      ? input.documents
      : input.documents.slice(0, Math.max(0, input.limit));
  const items: AuditItemState[] = [];

  for (const doc of docs) {
    const parsed = parseDocumentId(doc.id);
    const sourcePath =
      parsed.kind === "other"
        ? typeof doc.document_metadata?.source === "string"
          ? doc.document_metadata.source
          : undefined
        : parsed.sourcePath;
    const sourceStillExists =
      sourcePath !== undefined
        ? await pathExists(join(input.projectRoot, sourcePath))
        : false;

    let text = "";
    let currentFileExcerpt: string | undefined;
    if (sourcePath !== undefined && sourceStillExists) {
      const absolutePath = join(input.projectRoot, sourcePath);
      const content = await readFile(absolutePath, "utf8");
      const source: DurableSource = {
        absolutePath,
        relativePath: sourcePath,
        kind: guessSourceKind(sourcePath),
      };
      const extracted = extractFromSource(source, content);
      if (parsed.kind === "section") {
        const fact =
          extracted.facts.find((item) => item.id === doc.id) ??
          extracted.heuristicSkips.find((item) => item.id === doc.id);
        text = fact?.content ?? content;
        currentFileExcerpt = fact?.content ?? content.slice(0, 2_000);
      } else {
        text = content;
        currentFileExcerpt = content.slice(0, 2_000);
      }
    } else if (sourcePath !== undefined && retained.sources[sourcePath] !== undefined) {
      text = retained.sources[sourcePath].text;
    } else {
      text = `Bank document ${doc.id}`;
    }

    const lastSourceHash =
      sourcePath !== undefined
        ? manifest?.sources[sourcePath]?.contentHash
        : undefined;
    const item: AuditItemState = {
      type: "document",
      id: doc.id,
      text,
      sourceStillExists,
      ...(lastSourceHash !== undefined ? { lastSourceHash } : {}),
      ...(currentFileExcerpt !== undefined ? { currentFileExcerpt } : {}),
      ...(input.bankMission !== undefined ? { bankMission: input.bankMission } : {}),
      ...(doc.updated_at !== undefined ? { lastAccessed: doc.updated_at } : {}),
    };
    items.push(item);
  }

  return items;
}

function guessSourceKind(relativePath: string): DurableSource["kind"] {
  const lower = relativePath.toLowerCase();
  if (
    lower.includes("/adr/") ||
    lower.includes("/adrs/") ||
    lower.includes("/decisions/")
  ) {
    return "adr";
  }
  const base = relativePath.split("/").pop()?.toLowerCase() ?? "";
  if (base === "readme.md" || base === "readme.markdown" || base === "readme.mdx") {
    return "readme";
  }
  return "docs";
}
