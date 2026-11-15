import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { extractFromSource } from "../extractor/extract.js";
import type { DurableSource } from "../scanner/durable-sources.js";
import { pathExists } from "../utils/fs.js";
import { parseDocumentId } from "./prune-plan.js";

export interface SourceExcerptResult {
  documentId: string;
  sourcePath?: string;
  sourceStillExists: boolean;
  excerpt?: string;
}

export async function loadCurrentExcerptForDocumentId(input: {
  projectRoot: string;
  documentId: string;
  maxChars?: number;
}): Promise<SourceExcerptResult> {
  const maxChars = input.maxChars ?? 2_000;
  const parsed = parseDocumentId(input.documentId);
  if (parsed.kind === "other") {
    return {
      documentId: input.documentId,
      sourceStillExists: false,
    };
  }

  const sourcePath = parsed.sourcePath;
  const absolutePath = join(input.projectRoot, sourcePath);
  const sourceStillExists = await pathExists(absolutePath);
  if (!sourceStillExists) {
    return {
      documentId: input.documentId,
      sourcePath,
      sourceStillExists: false,
    };
  }

  const content = await readFile(absolutePath, "utf8");
  if (parsed.kind === "section") {
    const source: DurableSource = {
      absolutePath,
      relativePath: sourcePath,
      kind: guessSourceKind(sourcePath),
    };
    const extracted = extractFromSource(source, content);
    const fact =
      extracted.facts.find((item) => item.id === input.documentId) ??
      extracted.heuristicSkips.find((item) => item.id === input.documentId);
    const excerpt = (fact?.content ?? content).slice(0, maxChars);
    return {
      documentId: input.documentId,
      sourcePath,
      sourceStillExists: true,
      excerpt,
    };
  }

  return {
    documentId: input.documentId,
    sourcePath,
    sourceStillExists: true,
    excerpt: content.slice(0, maxChars),
  };
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
  if (lower.endsWith("readme.md") || lower.endsWith("readme")) {
    return "readme";
  }
  return "docs";
}
