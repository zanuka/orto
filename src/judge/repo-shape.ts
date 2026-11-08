import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  findDurableSources,
  type DurableSource,
} from "../scanner/durable-sources.js";
import { pathExists } from "../utils/fs.js";

export interface RepoShapeSnapshot {
  readmeCount: number;
  docsCount: number;
  adrCount: number;
  markdownFileCount: number;
  docsBytes: number;
  hasAdrTree: boolean;
}

export async function buildRepoShapeSnapshot(
  projectRoot: string,
): Promise<RepoShapeSnapshot> {
  const sources = await findDurableSources(projectRoot);
  let readmeCount = 0;
  let docsCount = 0;
  let adrCount = 0;
  let docsBytes = 0;

  for (const source of sources) {
    const kind = shapeKind(source);
    if (kind === "readme") {
      readmeCount += 1;
    } else if (kind === "docs") {
      docsCount += 1;
    } else if (kind === "adr") {
      adrCount += 1;
    }

    if (kind === "docs" || kind === "adr") {
      try {
        const info = await stat(source.absolutePath);
        if (info.isFile()) {
          docsBytes += info.size;
        }
      } catch {
        continue;
      }
    }
  }

  const hasAdrTree =
    adrCount > 0 ||
    (await pathExists(join(projectRoot, "docs", "adr"))) ||
    (await pathExists(join(projectRoot, "docs", "adrs"))) ||
    (await pathExists(join(projectRoot, "docs", "decisions")));

  return {
    readmeCount,
    docsCount,
    adrCount,
    markdownFileCount: sources.length,
    docsBytes,
    hasAdrTree,
  };
}

export function shapeKind(source: DurableSource): DurableSource["kind"] {
  const normalized = source.relativePath.replace(/\\/g, "/").toLowerCase();
  if (
    normalized.includes("/adr/") ||
    normalized.includes("/adrs/") ||
    normalized.includes("/decisions/") ||
    normalized.startsWith("adr/") ||
    normalized.startsWith("adrs/") ||
    normalized.startsWith("docs/decisions/")
  ) {
    return "adr";
  }
  return source.kind;
}
