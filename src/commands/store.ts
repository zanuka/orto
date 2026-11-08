import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { loadConfig, loadShareConfig, saveConfig } from "../config/load.js";
import {
  assertApiKeyForConnection,
  resolveProjectConnection,
} from "../config/connection.js";
import { detectProjectRoot } from "../project/detect-root.js";
import { isGitWorktree } from "../project/worktree.js";
import {
  findDurableProjectForWorktree,
  loadCaptainRegistry,
} from "../project/registry.js";
import { hashContent } from "../extractor/hash.js";
import {
  checkStoreDeny,
  relativeToProjectRoot,
} from "../scanner/store-policy.js";
import { findDurableSources } from "../scanner/durable-sources.js";
import type { ScannerPolicy } from "../scanner/policy.js";
import {
  HindsightClient,
  resolveHindsightApiKey,
} from "../providers/hindsight/client.js";
import {
  createEmptyManifest,
  loadSeedManifest,
  saveSeedManifest,
  type SeedManifest,
} from "../seeder/manifest.js";
import { nextManifest, prepareSeed, toRetainItems } from "../seeder/prepare.js";
import { clearTombstonesForIds } from "../seeder/tombstones.js";
import { retainPreparedItems } from "./seed.js";
import {
  createJudge,
  formatAdoptLines,
  formatEditDurabilityLines,
  judgeAllowlistAdoption,
  judgeEditDurability,
  type AdoptProposal,
  type EditDurabilityDecision,
  type ResolvedJudge,
} from "../judge/index.js";
import {
  loadRetainedSources,
  rememberRetainedSource,
} from "../seeder/retained-sources.js";
import { OrtoError } from "../utils/errors.js";
import { isInteractive, promptMultiSelect } from "../utils/prompt.js";

export interface StoreOptions {
  cwd?: string;
  project?: string;
  dryRun?: boolean;
  force?: boolean;
  async?: boolean;
  yes?: boolean;
  files?: string;
  addFiles?: string;
  hindsightUrl?: string;
  apiKey?: string;
  judge?: string;
  confidence?: number;
  strict?: boolean;
  proposeAdopt?: boolean;
  apply?: boolean;
  resolvedJudge?: ResolvedJudge;
  previousByPath?: Record<string, string>;
}

export interface StoreBucketEntry {
  relativePath: string;
  absolutePath: string;
}

export interface StoreBuckets {
  known: StoreBucketEntry[];
  new: StoreBucketEntry[];
  changed: StoreBucketEntry[];
  unchanged: StoreBucketEntry[];
}

export interface StoreResult {
  projectRoot: string;
  bankId: string;
  baseUrl: string;
  dryRun: boolean;
  buckets: StoreBuckets;
  selected: string[];
  skippedNew: string[];
  addedToAllowlist: string[];
  retained: number;
  failed: number;
  async: boolean;
  addFilesOnly: boolean;
  proposals?: AdoptProposal[];
  editDurability?: EditDurabilityDecision[];
}

function parsePathList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

async function resolveStoreProjectRoot(
  options: StoreOptions,
): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const explicitProject = options.project !== undefined;

  const root = explicitProject
    ? isAbsolute(options.project as string)
      ? (options.project as string)
      : resolve(cwd, options.project as string)
    : await detectProjectRoot(cwd);

  if (!(await isGitWorktree(root))) {
    return root;
  }

  if (explicitProject) {
    throw new OrtoError(
      `${root} is a disposable git worktree; Orto never stores from a worktree.`,
      "Pass --project pointing at the durable clone that owns .orto/ (firstmate/projects/orto or a daily checkout), not a Treehouse worktree.",
    );
  }

  const registry = await loadCaptainRegistry();
  const durable = findDurableProjectForWorktree(root, registry);
  if (durable) {
    return durable.path;
  }

  throw new OrtoError(
    `${root} is a disposable git worktree; Orto never stores from a worktree.`,
    "Run `orto store` from the durable clone that owns .orto/, pass --project <durable-clone-path>, or register the durable clone with `orto mcp --harness firstmate --write-firstmate`.",
  );
}

function resolveRelativePath(projectRoot: string, cwd: string, raw: string): string {
  const absolute = isAbsolute(raw) ? raw : resolve(cwd, raw);
  return relativeToProjectRoot(projectRoot, absolute);
}

async function computeBuckets(
  projectRoot: string,
  allowlist: readonly string[],
  manifest: SeedManifest,
  scanner?: ScannerPolicy,
): Promise<StoreBuckets> {
  const sources = await findDurableSources(projectRoot, scanner);
  const allowSet = new Set(allowlist);
  const buckets: StoreBuckets = {
    known: [],
    new: [],
    changed: [],
    unchanged: [],
  };

  for (const source of sources) {
    const deny = checkStoreDeny(source.relativePath, projectRoot);
    if (deny.denied) {
      continue;
    }

    const entry: StoreBucketEntry = {
      relativePath: source.relativePath,
      absolutePath: source.absolutePath,
    };

    if (!allowSet.has(source.relativePath)) {
      buckets.new.push(entry);
      continue;
    }

    buckets.known.push(entry);
    const content = await readFile(source.absolutePath, "utf8");
    const hash = hashContent(content);
    const previousHash = manifest.sources[source.relativePath]?.contentHash;
    if (previousHash === hash) {
      buckets.unchanged.push(entry);
    } else {
      buckets.changed.push(entry);
    }
  }

  return buckets;
}

export async function runStore(options: StoreOptions = {}): Promise<StoreResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;
  const asyncRetain = options.async ?? false;
  const yes = options.yes ?? false;
  const proposeAdopt = options.proposeAdopt === true;
  const applyProposals = options.apply === true;

  const resolved =
    options.resolvedJudge ??
    createJudge({
      ...(options.judge !== undefined ? { judge: options.judge } : {}),
      ...(options.confidence !== undefined
        ? { confidence: options.confidence }
        : {}),
      ...(options.strict !== undefined ? { strict: options.strict } : {}),
    });

  const projectRoot = await resolveStoreProjectRoot(options);
  const config = await loadConfig(projectRoot);
  const share = await loadShareConfig(projectRoot);
  const connection = resolveProjectConnection({
    config,
    share,
    ...(options.hindsightUrl !== undefined
      ? { cliUrl: options.hindsightUrl }
      : {}),
  });
  const baseUrl = connection.baseUrl;
  const apiKey = resolveHindsightApiKey({
    ...(options.apiKey !== undefined ? { cliKey: options.apiKey } : {}),
  });
  if (!dryRun && !proposeAdopt) {
    assertApiKeyForConnection({ connection, ...(apiKey ? { apiKey } : {}) });
  }

  let manifest =
    (await loadSeedManifest(projectRoot)) ?? createEmptyManifest(config.bankId);

  let allowlist = [...(config.store?.allowlist ?? [])];
  if (config.store === undefined && Object.keys(manifest.sources).length > 0) {
    // First store after seed: bootstrap the allowlist from the last seed
    // manifest so already-seeded sources read as "known", not "new".
    allowlist = Object.keys(manifest.sources);
  }

  const explicitFiles = parsePathList(options.files);
  const addFiles = parsePathList(options.addFiles);

  if (proposeAdopt && (explicitFiles.length > 0 || addFiles.length > 0 || yes)) {
    throw new OrtoError(
      "--propose-adopt does not retain, and it does not combine with --files, --add-files, or --yes.",
      "Run orto store --propose-adopt --judge jev. Add confirmed paths with --apply.",
    );
  }
  if (applyProposals && !proposeAdopt) {
    throw new OrtoError(
      "--apply only writes allowlist proposals.",
      "Re-run with orto store --propose-adopt --judge jev --apply.",
    );
  }
  if (proposeAdopt && resolved.judgeId !== "jev") {
    throw new OrtoError(
      "Allowlist proposals require --judge jev.",
      "Re-run: orto store --propose-adopt --judge jev",
    );
  }

  // --add-files: allowlist only, no retain, no scanning of buckets required.
  if (addFiles.length > 0) {
    const toAdd: string[] = [];
    for (const raw of addFiles) {
      const relativePath = resolveRelativePath(projectRoot, cwd, raw);
      const deny = checkStoreDeny(relativePath, projectRoot, { explicit: true });
      if (deny.denied) {
        throw new OrtoError(
          `Refusing to allowlist "${relativePath}": ${deny.reason}`,
          "Pick a durable markdown file inside the project root.",
        );
      }
      if (!allowlist.includes(relativePath)) {
        toAdd.push(relativePath);
      }
    }
    const nextAllowlist = [...new Set([...allowlist, ...toAdd])].sort();
    await saveConfig(
      projectRoot,
      { ...config, store: { allowlist: nextAllowlist } },
      dryRun,
    );

    const buckets = await computeBuckets(
      projectRoot,
      nextAllowlist,
      manifest,
      config.scanner,
    );
    printStorePlan({ projectRoot, bankId: config.bankId, baseUrl, dryRun, buckets });
    console.log("");
    console.log(
      `${dryRun ? "[dry-run] Would add" : "Added"} ${toAdd.length} file(s) to store.allowlist (no retain).`,
    );
    for (const path of toAdd) {
      console.log(`  + ${path}`);
    }

    return {
      projectRoot,
      bankId: config.bankId,
      baseUrl,
      dryRun,
      buckets,
      selected: [],
      skippedNew: [],
      addedToAllowlist: toAdd,
      retained: 0,
      failed: 0,
      async: asyncRetain,
      addFilesOnly: true,
    };
  }

  const buckets = await computeBuckets(
    projectRoot,
    allowlist,
    manifest,
    config.scanner,
  );

  if (proposeAdopt) {
    const proposals: AdoptProposal[] = [];
    for (const entry of buckets.new) {
      let text = "";
      try {
        text = await readFile(entry.absolutePath, "utf8");
      } catch {
        proposals.push({
          path: entry.relativePath,
          verdict: "skip",
          reason: "file could not be read",
        });
        continue;
      }
      proposals.push(
        await judgeAllowlistAdoption({
          path: entry.relativePath,
          text,
          judge: resolved.judge,
          confidence: resolved.confidence,
        }),
      );
    }
    const proposed = proposals.filter((proposal) => proposal.verdict === "propose");
    for (const line of formatAdoptLines({ proposals, dryRun })) {
      console.log(line);
    }
    const added = proposed.map((proposal) => proposal.path);
    if (applyProposals && added.length > 0 && !dryRun) {
      const nextAllowlist = [...new Set([...allowlist, ...added])].sort();
      await saveConfig(
        projectRoot,
        { ...config, store: { allowlist: nextAllowlist } },
        false,
      );
      console.log("");
      console.log(`Added ${added.length} file(s) to store.allowlist (no retain).`);
      for (const path of added) {
        console.log(`  + ${path}`);
      }
    } else if (applyProposals && added.length > 0) {
      console.log("");
      console.log(
        `${dryRun ? "[dry-run] Would add" : "Added"} ${added.length} file(s) to store.allowlist (no retain).`,
      );
    } else {
      console.log("");
      console.log(
        "The allowlist was not changed. Re-run with --propose-adopt --apply to add the proposed paths.",
      );
    }
    console.log("Nothing was retained.");
    return {
      projectRoot,
      bankId: config.bankId,
      baseUrl,
      dryRun,
      buckets,
      selected: [],
      skippedNew: buckets.new.map((entry) => entry.relativePath),
      addedToAllowlist: applyProposals && !dryRun ? added : [],
      retained: 0,
      failed: 0,
      async: false,
      addFilesOnly: false,
      proposals,
    };
  }

  let selected: string[] = [];
  let skippedNew: string[] = [];
  let addedToAllowlist: string[] = [];

  if (explicitFiles.length > 0) {
    const resolved: string[] = [];
    for (const raw of explicitFiles) {
      const relativePath = resolveRelativePath(projectRoot, cwd, raw);
      const deny = checkStoreDeny(relativePath, projectRoot, { explicit: true });
      if (deny.denied) {
        throw new OrtoError(
          `Refusing to store "${relativePath}": ${deny.reason}`,
          "Pass a durable markdown file inside the project root.",
        );
      }
      resolved.push(relativePath);
    }
    selected = resolved;
    addedToAllowlist = resolved.filter((p) => !allowlist.includes(p));
    allowlist = [...new Set([...allowlist, ...resolved])].sort();
  } else if (yes) {
    selected = buckets.changed.map((b) => b.relativePath);
    skippedNew = buckets.new.map((b) => b.relativePath);
  } else if (isInteractive() && !dryRun) {
    selected = buckets.changed.map((b) => b.relativePath);
    if (buckets.new.length > 0) {
      const picked = await promptMultiSelect(
        "New durable markdown found (not yet in store.allowlist):",
        buckets.new.map((b) => b.relativePath),
      );
      selected = [...selected, ...picked];
      addedToAllowlist = picked;
      allowlist = [...new Set([...allowlist, ...picked])].sort();
      skippedNew = buckets.new
        .map((b) => b.relativePath)
        .filter((p) => !picked.includes(p));
    }
  } else {
    // Non-interactive without --yes/--files (dry-run preview, or no TTY):
    // never silently adopt new files.
    selected = buckets.changed.map((b) => b.relativePath);
    skippedNew = buckets.new.map((b) => b.relativePath);
  }

  if (explicitFiles.length > 0) {
    const discovered = await findDurableSources(projectRoot, config.scanner);
    const known = new Set(discovered.map((source) => source.relativePath));
    const missing = selected.filter((path) => !known.has(path));
    if (missing.length > 0) {
      throw new OrtoError(
        `Refusing to store ${missing.map((path) => `"${path}"`).join(", ")}: not in the durable scan.`,
        "Update scanner.include, scanner.exclude, or scanner.extensions so the path is selected, then retry.",
      );
    }
  }

  const finalBuckets =
    addedToAllowlist.length > 0
      ? await computeBuckets(projectRoot, allowlist, manifest, config.scanner)
      : buckets;

  printStorePlan({
    projectRoot,
    bankId: config.bankId,
    baseUrl,
    dryRun,
    buckets: finalBuckets,
  });

  if (skippedNew.length > 0) {
    console.log("");
    console.log(
      `Skipped ${skippedNew.length} new file(s) (not stored): ${skippedNew.join(", ")}`,
    );
    console.log(
      "Next: `orto store --files <path>[,<path>...]` or run interactively to select them.",
    );
  }

  let editDurability: EditDurabilityDecision[] | undefined;
  let retainSelected = selected;
  if (resolved.judgeId === "jev" && selected.length > 0) {
    const gated = await applyEditDurabilityGate({
      projectRoot,
      selected,
      dryRun,
      judge: resolved.judge,
      confidence: resolved.confidence,
      ...(options.previousByPath !== undefined
        ? { previousByPath: options.previousByPath }
        : {}),
      ...(dryRun ? {} : { manifest }),
    });
    editDurability = gated.decisions;
    retainSelected = gated.retainSelected;
    if (!dryRun && gated.manifest !== undefined) {
      manifest = gated.manifest;
    }
    for (const line of formatEditDurabilityLines({
      decisions: gated.decisions,
      dryRun,
    })) {
      console.log(line);
    }
    console.log("");
  }

  if (dryRun) {
    console.log("");
    console.log("No memories were retained. Suggested next commands:");
    if (finalBuckets.new.length > 0) {
      console.log(
        `  orto store --files ${finalBuckets.new.map((b) => b.relativePath).join(",")}`,
      );
    }
    if (finalBuckets.changed.length > 0) {
      console.log("  orto store --yes");
    }
    return {
      projectRoot,
      bankId: config.bankId,
      baseUrl,
      dryRun: true,
      buckets: finalBuckets,
      selected,
      skippedNew,
      addedToAllowlist,
      retained: 0,
      failed: 0,
      async: asyncRetain,
      addFilesOnly: false,
      ...(editDurability !== undefined ? { editDurability } : {}),
    };
  }

  if (addedToAllowlist.length > 0) {
    await saveConfig(projectRoot, { ...config, store: { allowlist } }, false);
  } else if (config.store === undefined) {
    await saveConfig(projectRoot, { ...config, store: { allowlist } }, false);
  }

  if (retainSelected.length === 0) {
    if (editDurability !== undefined && !dryRun) {
      await saveSeedManifest(projectRoot, manifest);
    }
    console.log("");
    console.log(
      editDurability !== undefined && editDurability.length > 0
        ? "Nothing was sent to Hindsight after the edit durability gate."
        : "Nothing selected to store.",
    );
    return {
      projectRoot,
      bankId: config.bankId,
      baseUrl,
      dryRun: false,
      buckets: finalBuckets,
      selected,
      skippedNew,
      addedToAllowlist,
      retained: 0,
      failed: 0,
      async: asyncRetain,
      addFilesOnly: false,
      ...(editDurability !== undefined ? { editDurability } : {}),
    };
  }

  const prepared = await prepareSeed({
    projectRoot,
    bankId: config.bankId,
    force,
    only: new Set(retainSelected),
    ...(config.scanner !== undefined ? { scanner: config.scanner } : {}),
  });

  if (prepared.factsToRetain.length === 0) {
    if (editDurability !== undefined) {
      await saveSeedManifest(projectRoot, manifest);
    }
    console.log("");
    console.log("Nothing was sent to Hindsight (no high-signal candidates).");
    return {
      projectRoot,
      bankId: config.bankId,
      baseUrl,
      dryRun: false,
      buckets: finalBuckets,
      selected,
      skippedNew,
      addedToAllowlist,
      retained: 0,
      failed: 0,
      async: asyncRetain,
      addFilesOnly: false,
      ...(editDurability !== undefined ? { editDurability } : {}),
    };
  }

  if (!apiKey) {
    console.log(
      "Warning: no API key resolved (ORTO_HINDSIGHT_API_KEY / HINDSIGHT_API_KEY / --api-key).",
    );
  }

  const client = new HindsightClient({
    baseUrl,
    ...(apiKey !== undefined ? { apiKey } : {}),
  });
  const { retainedIds, failed } = await retainPreparedItems({
    client,
    bankId: config.bankId,
    items: toRetainItems(prepared.factsToRetain),
    asyncRetain,
    retryHint: "ORTO_HINDSIGHT_API_KEY='your-key' pnpm orto store --yes",
  });

  manifest = nextManifest(manifest, config.bankId, prepared, retainedIds);
  await saveSeedManifest(projectRoot, manifest);
  if (retainedIds.size > 0) {
    await clearTombstonesForIds(projectRoot, retainedIds);
    for (const source of prepared.sources) {
      if (source.unchanged) {
        continue;
      }
      const retainedHere = source.facts.some((fact) => retainedIds.has(fact.id));
      if (!retainedHere) {
        continue;
      }
      const text = await readFile(
        join(projectRoot, source.relativePath),
        "utf8",
      ).catch(() => undefined);
      if (text === undefined) {
        continue;
      }
      await rememberRetainedSource({
        projectRoot,
        relativePath: source.relativePath,
        contentHash: source.contentHash,
        text,
      });
    }
  }

  console.log("");
  if (retainedIds.size > 0) {
    console.log(
      `Stored ${retainedIds.size} item(s)${asyncRetain ? " (async)" : ""}${failed > 0 ? `, ${failed} failed` : ""}.`,
    );
    console.log(
      "Incremental state saved under .orto/local/seed-manifest.json",
    );
  } else {
    console.log("Nothing was successfully stored.");
  }

  return {
    projectRoot,
    bankId: config.bankId,
    baseUrl,
    dryRun: false,
    buckets: finalBuckets,
    selected,
    skippedNew,
    addedToAllowlist,
    retained: retainedIds.size,
    failed,
    async: asyncRetain,
    addFilesOnly: false,
    ...(editDurability !== undefined ? { editDurability } : {}),
  };
}

async function applyEditDurabilityGate(input: {
  projectRoot: string;
  selected: readonly string[];
  dryRun: boolean;
  judge: import("../judge/types.js").Judge;
  confidence: number;
  previousByPath?: Record<string, string>;
  manifest?: SeedManifest;
}): Promise<{
  decisions: EditDurabilityDecision[];
  retainSelected: string[];
  manifest?: SeedManifest;
}> {
  const snapshots = await loadRetainedSources(input.projectRoot);
  const decisions: EditDurabilityDecision[] = [];
  const retainSelected: string[] = [];
  let nextManifestState = input.manifest;

  for (const relativePath of input.selected) {
    const absolutePath = join(input.projectRoot, relativePath);
    let currentText = "";
    try {
      currentText = await readFile(absolutePath, "utf8");
    } catch {
      decisions.push({
        path: relativePath,
        action: "review",
        reason: "file could not be read",
      });
      continue;
    }
    const previousText =
      input.previousByPath?.[relativePath] ??
      snapshots.sources[relativePath]?.text;
    if (previousText === undefined) {
      retainSelected.push(relativePath);
      continue;
    }

    const decision = await judgeEditDurability({
      path: relativePath,
      previousText,
      currentText,
      judge: input.judge,
      confidence: input.confidence,
    });
    decisions.push(decision);

    if (decision.action === "re_retain") {
      retainSelected.push(relativePath);
      continue;
    }
    if (decision.action === "review") {
      continue;
    }

    if (!input.dryRun && nextManifestState !== undefined) {
      const hash = hashContent(currentText);
      const previous = nextManifestState.sources[relativePath];
      nextManifestState = {
        ...nextManifestState,
        updatedAt: new Date().toISOString(),
        sources: {
          ...nextManifestState.sources,
          [relativePath]: {
            contentHash: hash,
            factIds: previous?.factIds ?? [],
            seededAt: previous?.seededAt ?? new Date().toISOString(),
            ...(previous?.pendingFactIds !== undefined
              ? { pendingFactIds: previous.pendingFactIds }
              : {}),
          },
        },
      };
      await rememberRetainedSource({
        projectRoot: input.projectRoot,
        relativePath,
        contentHash: hash,
        text: currentText,
      });
    }
  }

  return {
    decisions,
    retainSelected,
    ...(nextManifestState !== undefined ? { manifest: nextManifestState } : {}),
  };
}

function printStorePlan(input: {
  projectRoot: string;
  bankId: string;
  baseUrl: string;
  dryRun: boolean;
  buckets: StoreBuckets;
}): void {
  const prefix = input.dryRun ? "[dry-run] " : "";
  console.log(`${prefix}Store for bank "${input.bankId}"`);
  console.log(`${prefix}Hindsight: ${input.baseUrl}`);
  console.log(`${prefix}Project root: ${input.projectRoot}`);
  console.log("");
  console.log(`${prefix}known: ${input.buckets.known.length}`);
  console.log(`${prefix}new: ${input.buckets.new.length}`);
  console.log(`${prefix}changed: ${input.buckets.changed.length}`);
  console.log(`${prefix}unchanged: ${input.buckets.unchanged.length}`);

  if (input.buckets.new.length > 0) {
    console.log("");
    console.log("New (not in store.allowlist):");
    for (const entry of input.buckets.new) {
      console.log(`  ${entry.relativePath}`);
    }
  }
  if (input.buckets.changed.length > 0) {
    console.log("");
    console.log("Changed (allowlisted, content hash differs):");
    for (const entry of input.buckets.changed) {
      console.log(`  ${entry.relativePath}`);
    }
  }
  if (input.buckets.unchanged.length > 0) {
    console.log("");
    console.log("Unchanged (allowlisted, hash matches; skipped):");
    for (const entry of input.buckets.unchanged) {
      console.log(`  ${entry.relativePath}`);
    }
  }
}

export async function runStoreCommand(options: StoreOptions = {}): Promise<void> {
  const result = await runStore(options);
  if (result.failed > 0) {
    process.exitCode = 1;
  }
}
