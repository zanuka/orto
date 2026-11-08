import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HindsightClient } from "../providers/hindsight/client.js";
import { runPrune } from "./prune.js";

describe("prune audit plan apply", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "orto-prune-audit-"));
    dirs.push(dir);
    await mkdir(join(dir, ".orto", "local"), { recursive: true });
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

  function mockClient(): HindsightClient & {
    deleted: string[];
    refreshed: string[];
  } {
    const deleted: string[] = [];
    const refreshed: string[] = [];
    return {
      deleted,
      refreshed,
      listAllDocuments: vi.fn(async () => [
        { id: "orto:docs/old.md#decision" },
        { id: "orto:docs/keep.md#goal" },
      ]),
      listAllMentalModels: vi.fn(async () => [
        {
          id: "architecture-decisions",
          name: "Architecture Decisions",
          source_query: "What decisions were made?",
        },
      ]),
      deleteDocument: vi.fn(async (_bank: string, id: string) => {
        deleted.push(id);
        return {
          success: true,
          message: "ok",
          document_id: id,
          memory_units_deleted: 1,
        };
      }),
      refreshMentalModel: vi.fn(async (_bank: string, id: string) => {
        refreshed.push(id);
        return { operation_id: "op-1" };
      }),
    } as unknown as HindsightClient & {
      deleted: string[];
      refreshed: string[];
    };
  }

  async function writePlan(
    root: string,
    items: Array<Record<string, unknown>>,
  ): Promise<string> {
    const path = join(root, ".orto", "local", "audit-plan.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        bankId: "fixture",
        createdAt: "2026-11-08T00:00:00.000Z",
        confidence: 0.8,
        items,
      }),
      "utf8",
    );
    return path;
  }

  it("without --apply mutates nothing", async () => {
    const root = await tempProject();
    const planPath = await writePlan(root, [
      {
        id: "architecture-decisions",
        action: "refresh_mental_model",
        confidence: 0.9,
        reason: "action=refresh",
        layer: "mental_model",
      },
      {
        id: "orto:docs/old.md#decision",
        action: "delete_candidate",
        confidence: 0.91,
        reason: "action=delete_candidate",
      },
    ]);
    const client = mockClient();

    const result = await runPrune({
      cwd: root,
      plan: planPath,
      apply: false,
      client,
      interactive: false,
    });

    expect("apply" in result && result.apply).toBe(false);
    expect(client.refreshMentalModel).not.toHaveBeenCalled();
    expect(client.deleteDocument).not.toHaveBeenCalled();
    await expect(
      readFile(join(root, ".orto", "local", "audit-plan-applied.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("without --allow-delete applies refresh and archive but not deletes", async () => {
    const root = await tempProject();
    const planPath = await writePlan(root, [
      {
        id: "architecture-decisions",
        action: "refresh_mental_model",
        confidence: 0.9,
        reason: "action=refresh",
        layer: "mental_model",
      },
      {
        id: "orto:docs/old.md#decision",
        action: "archive",
        confidence: 0.88,
        reason: "action=archive",
      },
      {
        id: "orto:docs/keep.md#goal",
        action: "delete_candidate",
        confidence: 0.95,
        reason: "action=delete_candidate",
      },
    ]);
    const client = mockClient();

    const result = await runPrune({
      cwd: root,
      plan: planPath,
      apply: true,
      allowDelete: false,
      client,
      interactive: false,
    });

    expect("refreshed" in result && result.refreshed).toEqual([
      "architecture-decisions",
    ]);
    expect("archived" in result && result.archived).toEqual([
      "orto:docs/old.md#decision",
    ]);
    expect("deleted" in result && result.deleted).toEqual([]);
    expect(client.deleteDocument).not.toHaveBeenCalled();
    expect(client.refreshMentalModel).toHaveBeenCalledWith(
      "fixture",
      "architecture-decisions",
    );

    const tombs = JSON.parse(
      await readFile(join(root, ".orto", "local", "tombstones.json"), "utf8"),
    ) as { entries: Record<string, unknown> };
    expect(tombs.entries["orto:docs/old.md#decision"]).toBeDefined();
  });

  it("with --allow-delete deletes delete_candidate rows", async () => {
    const root = await tempProject();
    const planPath = await writePlan(root, [
      {
        id: "orto:docs/old.md#decision",
        action: "delete_candidate",
        confidence: 0.95,
        reason: "action=delete_candidate",
      },
    ]);
    const client = mockClient();

    const result = await runPrune({
      cwd: root,
      plan: planPath,
      apply: true,
      allowDelete: true,
      client,
      interactive: false,
    });

    expect("deleted" in result && result.deleted).toEqual([
      "orto:docs/old.md#decision",
    ]);
    expect(client.deleteDocument).toHaveBeenCalledWith(
      "fixture",
      "orto:docs/old.md#decision",
    );
  });

  it("is idempotent on an already-applied plan", async () => {
    const root = await tempProject();
    const planPath = await writePlan(root, [
      {
        id: "architecture-decisions",
        action: "refresh_mental_model",
        confidence: 0.9,
        reason: "action=refresh",
        layer: "mental_model",
      },
    ]);
    const client = mockClient();

    await runPrune({
      cwd: root,
      plan: planPath,
      apply: true,
      client,
      interactive: false,
    });
    expect(client.refreshMentalModel).toHaveBeenCalledTimes(1);

    const second = await runPrune({
      cwd: root,
      plan: planPath,
      apply: true,
      client,
      interactive: false,
    });

    expect(client.refreshMentalModel).toHaveBeenCalledTimes(1);
    expect("refreshed" in second && second.refreshed).toEqual([]);
    expect(
      "selections" in second &&
        second.selections.every((row) => row.disposition === "skip_already_applied"),
    ).toBe(true);
  });

  it("refuses a stale plan vs current bank ids", async () => {
    const root = await tempProject();
    const planPath = await writePlan(root, [
      {
        id: "missing-id",
        action: "archive",
        confidence: 0.9,
        reason: "action=archive",
      },
    ]);
    const client = mockClient();

    await expect(
      runPrune({
        cwd: root,
        plan: planPath,
        apply: true,
        client,
        interactive: false,
      }),
    ).rejects.toThrow(/stale/);
    expect(client.deleteDocument).not.toHaveBeenCalled();
  });
});
