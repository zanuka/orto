import { join } from "node:path";
import { z } from "zod";
import { ortoDir } from "../config/paths.js";
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from "../utils/fs.js";

export const RetainedSourcesSchema = z.object({
  version: z.literal(1),
  sources: z.record(
    z.object({
      contentHash: z.string(),
      text: z.string(),
      updatedAt: z.string(),
    }),
  ),
});

export type RetainedSources = z.infer<typeof RetainedSourcesSchema>;

export function retainedSourcesPath(projectRoot: string): string {
  return join(ortoDir(projectRoot), "local", "retained-sources.json");
}

export async function loadRetainedSources(
  projectRoot: string,
): Promise<RetainedSources> {
  const path = retainedSourcesPath(projectRoot);
  if (!(await pathExists(path))) {
    return { version: 1, sources: {} };
  }
  const raw = await readJsonFile<unknown>(path);
  const parsed = RetainedSourcesSchema.safeParse(raw);
  return parsed.success ? parsed.data : { version: 1, sources: {} };
}

export async function saveRetainedSources(
  projectRoot: string,
  sources: RetainedSources,
): Promise<void> {
  const path = retainedSourcesPath(projectRoot);
  await ensureDir(join(ortoDir(projectRoot), "local"));
  await writeJsonFile(path, sources, false);
}

export async function rememberRetainedSource(input: {
  projectRoot: string;
  relativePath: string;
  contentHash: string;
  text: string;
}): Promise<void> {
  const current = await loadRetainedSources(input.projectRoot);
  current.sources[input.relativePath] = {
    contentHash: input.contentHash,
    text: input.text,
    updatedAt: new Date().toISOString(),
  };
  await saveRetainedSources(input.projectRoot, current);
}
