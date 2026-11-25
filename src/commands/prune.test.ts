import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DeleteDocumentResponse,
  DocumentSummary,
  HindsightClient,
} from "../providers/hindsight/client.js";
import { runPrune } from "./prune.js";

describe("runPrune", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "orto-prune-cmd-"));
    dirs.push(dir);
    await mkdir(join(dir, ".orto"), { recursive: true });
    await mkdir(join(dir, "docs"), { recursive: true });
    await writeFile(
      join(dir, ".orto", "config.json"),
      JSON.stringify({
        version: 1,
        name: "fixture",
        provider: "hindsight",
        bankId: "fixture",
        root: ".",
        createdAt: new Date().toISOString(),
        hindsightBaseUrl: "http://localhost:8888",
      }),
      "utf8",
    );
    return dir;
  }

  function mockClient(docs: DocumentSummary[]): HindsightClient {
    const deleted: string[] = [];
    return {
      listAllDocuments: vi.fn(async () => docs),
      listDocuments: vi.fn(),
      deleteDocument: vi.fn(async (_bank, id: string) => {
        deleted.push(id);
        const response: DeleteDocumentResponse = {
          success: true,
          message: "ok",
          document_id: id,
          memory_units_deleted: 1,
        };
        return response;
      }),
      retain: vi.fn(),
      getOperationStatus: vi.fn(),
      __deleted: deleted,
    } as unknown as HindsightClient & { __deleted: string[] };
  }

  it("dry-run lists candidates and does not delete", async () => {
    const root = await tempProject();
    const client = mockClient([
      { id: "orto:docs/missing.md#gone" },
      { id: "docs/also-missing.md" },
    ]);

    const result = await runPrune({
      cwd: root,
      dryRun: true,
      client,
      interactive: false,
    });

    if (!("plan" in result)) {
      throw new Error("expected a prune plan result");
    }
    expect(result.plan.pathGone).toHaveLength(2);
    expect(result.deleted).toEqual([]);
    expect(client.deleteDocument).not.toHaveBeenCalled();
  });

  it("refuses non-interactive mutate without selection and --yes", async () => {
    const root = await tempProject();
    const client = mockClient([{ id: "orto:docs/missing.md#gone" }]);

    await expect(
      runPrune({
        cwd: root,
        client,
        interactive: false,
      }),
    ).rejects.toThrow(/Non-interactive prune requires/);
  });

  it("refuses --yes without explicit selection", async () => {
    const root = await tempProject();
    const client = mockClient([{ id: "orto:docs/missing.md#gone" }]);

    await expect(
      runPrune({
        cwd: root,
        yes: true,
        client,
        interactive: false,
      }),
    ).rejects.toThrow(/Refuse to prune with --yes/);
  });

  it("deletes explicit document-id with --yes and writes tombstones", async () => {
    const root = await tempProject();
    await writeFile(
      join(root, "docs", "live.md"),
      "# Goal\n\nThis section stays durable and meaningful enough for extraction.\n",
      "utf8",
    );
    const client = mockClient([
      { id: "orto:docs/live.md#goal" },
      { id: "docs/live.md" },
    ]);

    const result = await runPrune({
      cwd: root,
      yes: true,
      documentId: "docs/live.md",
      client,
      interactive: false,
    });

    expect(result.deleted).toEqual(["docs/live.md"]);
    expect(client.deleteDocument).toHaveBeenCalledWith("fixture", "docs/live.md");

    const { loadTombstones } = await import("../seeder/tombstones.js");
    const tombs = await loadTombstones(root);
    expect(tombs?.entries["docs/live.md"]).toBeDefined();
  });
});
