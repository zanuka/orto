import { readdir, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { pathExists } from "../utils/fs.js";
import {
  isSensitiveRelativePath,
  isSkippableTraversalDirectory,
} from "./sensitive.js";
import {
  activeExclude,
  activeInclude,
  effectiveExtensions,
  extensionAllowed,
  isExcludedPath,
  matchesInclude,
  type ScannerPolicy,
} from "./policy.js";

export interface DurableSource {
  absolutePath: string;
  relativePath: string;
  kind: "readme" | "docs" | "adr";
}

// STRATEGY.md and VISION.md hold a project's vision (an acceptance policy), so
// they are durable by definition and scanned next to the root README.
const ROOT_FILES: Array<{ name: string; kind: DurableSource["kind"] }> = [
  { name: "README.md", kind: "readme" },
  { name: "STRATEGY.md", kind: "docs" },
  { name: "VISION.md", kind: "docs" },
];

const DOC_DIRS = ["docs", "doc", "documentation"];
const ADR_DIRS = ["adr", "adrs", "docs/adr", "docs/adrs", "docs/decisions"];

export async function findDurableSources(
  projectRoot: string,
  policy?: ScannerPolicy,
): Promise<DurableSource[]> {
  const include = activeInclude(policy);
  const exclude = activeExclude(policy);
  const extensions = effectiveExtensions(policy);
  if (include.length > 0) {
    return findIncludedSources(projectRoot, include, exclude, extensions);
  }
  return findDefaultSources(projectRoot, exclude, extensions);
}

async function findDefaultSources(
  projectRoot: string,
  exclude: readonly string[],
  extensions: readonly string[],
): Promise<DurableSource[]> {
  const found: DurableSource[] = [];
  const seen = new Set<string>();

  const add = async (
    absolutePath: string,
    kind: DurableSource["kind"],
  ): Promise<void> => {
    if (!(await pathExists(absolutePath))) {
      return;
    }
    const info = await stat(absolutePath);
    if (!info.isFile()) {
      return;
    }
    const relativePath = toProjectRelative(projectRoot, absolutePath);
    if (!relativePath || !acceptRelativePath(relativePath, exclude, extensions)) {
      return;
    }
    if (seen.has(relativePath)) {
      return;
    }
    seen.add(relativePath);
    found.push({ absolutePath, relativePath, kind });
  };

  for (const file of ROOT_FILES) {
    await add(join(projectRoot, file.name), file.kind);
  }

  for (const dir of DOC_DIRS) {
    await collectMarkdown(
      join(projectRoot, dir),
      projectRoot,
      "docs",
      found,
      seen,
      exclude,
      extensions,
    );
  }

  for (const dir of ADR_DIRS) {
    await collectMarkdown(
      join(projectRoot, dir),
      projectRoot,
      "adr",
      found,
      seen,
      exclude,
      extensions,
    );
  }

  const rootEntries = await safeReaddir(projectRoot);
  for (const entry of rootEntries) {
    const lower = entry.toLowerCase();
    if (
      lower.startsWith("adr") &&
      extensionAllowed(lower, extensions)
    ) {
      await add(join(projectRoot, entry), "adr");
    }
  }

  found.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return found;
}

async function findIncludedSources(
  projectRoot: string,
  include: readonly string[],
  exclude: readonly string[],
  extensions: readonly string[],
): Promise<DurableSource[]> {
  const found: DurableSource[] = [];
  await walkIncluded(projectRoot, projectRoot, include, exclude, extensions, found);
  found.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return found;
}

async function walkIncluded(
  dir: string,
  projectRoot: string,
  include: readonly string[],
  exclude: readonly string[],
  extensions: readonly string[],
  found: DurableSource[],
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (isSkippableTraversalDirectory(entry.name)) {
        continue;
      }
      await walkIncluded(
        join(dir, entry.name),
        projectRoot,
        include,
        exclude,
        extensions,
        found,
      );
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const absolutePath = join(dir, entry.name);
    const relativePath = toProjectRelative(projectRoot, absolutePath);
    if (!relativePath || !extensionAllowed(entry.name, extensions)) {
      continue;
    }
    if (!matchesInclude(relativePath, include)) {
      continue;
    }
    if (!acceptRelativePath(relativePath, exclude, extensions)) {
      continue;
    }
    found.push({
      absolutePath,
      relativePath,
      kind: sourceKind(relativePath),
    });
  }
}

function acceptRelativePath(
  relativePath: string,
  exclude: readonly string[],
  extensions: readonly string[],
): boolean {
  const filename = relativePath.split("/").pop() ?? relativePath;
  if (!extensionAllowed(filename, extensions)) {
    return false;
  }
  if (isExcludedPath(relativePath, exclude)) {
    return false;
  }
  if (isSensitiveRelativePath(relativePath)) {
    return false;
  }
  return true;
}

function sourceKind(relativePath: string): DurableSource["kind"] {
  if (/^readme\.md$/i.test(relativePath)) {
    return "readme";
  }
  if (/(^|\/)(adr|adrs|decisions)\//i.test(relativePath)) {
    return "adr";
  }
  const filename = relativePath.split("/").pop() ?? relativePath;
  if (!relativePath.includes("/") && /^adr.*\.(md|markdown|mdx)$/i.test(filename)) {
    return "adr";
  }
  return "docs";
}

function toProjectRelative(projectRoot: string, absolutePath: string): string | undefined {
  const relativePath = relative(projectRoot, absolutePath).split(/[/\\]/).join("/");
  if (!relativePath || relativePath.startsWith("..") || relativePath.startsWith("/")) {
    return undefined;
  }
  return relativePath;
}

async function collectMarkdown(
  dir: string,
  projectRoot: string,
  kind: DurableSource["kind"],
  found: DurableSource[],
  seen: Set<string>,
  exclude: readonly string[],
  extensions: readonly string[],
): Promise<void> {
  if (!(await pathExists(dir))) {
    return;
  }
  const info = await stat(dir);
  if (!info.isDirectory()) {
    return;
  }

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isSkippableTraversalDirectory(entry.name)) {
        continue;
      }
      await collectMarkdown(
        absolutePath,
        projectRoot,
        kind,
        found,
        seen,
        exclude,
        extensions,
      );
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const relativePath = toProjectRelative(projectRoot, absolutePath);
    if (!relativePath || !acceptRelativePath(relativePath, exclude, extensions)) {
      continue;
    }
    if (seen.has(relativePath)) {
      continue;
    }
    seen.add(relativePath);
    found.push({ absolutePath, relativePath, kind });
  }
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

export function summarizeSource(source: DurableSource): string {
  switch (source.kind) {
    case "readme":
      return "Project overview and goals";
    case "adr":
      return `Decision record (${basename(source.relativePath)})`;
    case "docs":
      return `Documentation (${basename(source.relativePath)})`;
  }
}
