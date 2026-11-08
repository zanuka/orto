import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRepoShapeSnapshot } from "./repo-shape.js";

describe("buildRepoShapeSnapshot", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempRoot(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "orto-repo-shape-"));
    dirs.push(dir);
    return dir;
  }

  it("counts a tiny one-README library", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "README.md"), "# Tiny\n\nOne page.\n", "utf8");

    const snapshot = await buildRepoShapeSnapshot(root);
    expect(snapshot.readmeCount).toBe(1);
    expect(snapshot.docsCount).toBe(0);
    expect(snapshot.adrCount).toBe(0);
    expect(snapshot.markdownFileCount).toBe(1);
    expect(snapshot.hasAdrTree).toBe(false);
  });

  it("detects a docs/adr tree with sizes", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "README.md"), "# App\n", "utf8");
    await mkdir(join(root, "docs", "adr"), { recursive: true });
    const adrBody = `# ADR 1\n\n${"decision ".repeat(200)}\n`;
    await writeFile(join(root, "docs", "adr", "0001-record.md"), adrBody, "utf8");
    await writeFile(
      join(root, "docs", "architecture.md"),
      "# Architecture\n\nBoundaries.\n",
      "utf8",
    );

    const snapshot = await buildRepoShapeSnapshot(root);
    expect(snapshot.readmeCount).toBe(1);
    expect(snapshot.docsCount).toBe(1);
    expect(snapshot.adrCount).toBe(1);
    expect(snapshot.hasAdrTree).toBe(true);
    expect(snapshot.docsBytes).toBeGreaterThan(0);
    expect(snapshot.markdownFileCount).toBe(3);
  });
});
