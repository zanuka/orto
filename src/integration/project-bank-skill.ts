import { dirname, join } from "node:path";
import { ensureDir, pathExists, writeTextFile } from "../utils/fs.js";
import { OrtoError } from "../utils/errors.js";
import { captainHomeDir, saveCaptainRegistryEntry } from "../project/registry.js";

export const PROJECT_BANK_SKILL_NAME = "project-bank";

/**
 * On-demand Firstmate skill: before a crewmate spawn, resolve project -> bank
 * from the captain registry and append a bank card (bank id, captain MCP URL,
 * a few recall queries) to the ship brief. Crewmates recall only; they are
 * never told to enable Hindsight MCP themselves, and this skill never mines
 * transcripts or retains anything on its own.
 */
export const PROJECT_BANK_SKILL_CONTENT = `# project-bank

On-demand Firstmate skill, not an always-on persona. First mate does not write product code.

## When to use

Before spawning a crewmate on a project that has a Hindsight bank registered
in \`$FM_HOME/.orto/projects.json\` (or \`~/.orto/projects.json\`).

## What it does

1. Resolve the project's absolute path against the captain registry to find
   its \`bankId\` and \`hindsightBaseUrl\`.
2. Append a bank card to the ship brief:
   - Bank id
   - Captain MCP URL: \`<hindsightBaseUrl>/mcp/<bankId>/\`
   - Three suggested \`recall\` queries seeded from the project's durable docs
3. Nothing else. The crewmate recalls from the bank; it does not seed or
   store, and this skill does not tell it to enable Hindsight MCP.

## What it must never do

- Never retain from chat. Never mine transcripts.
- Never MCP-retain session fluff; durable claims go through \`orto seed\` / \`orto store\`.
- Never call this "promote": it is a recall-only bank card.
- Never treat \`/stow\` as "run store" (those are unrelated: disk prefs vs.
  bank writes).
- Never write fleet MCP config into the product repo.

## When durable project markdown changes

The captain runs \`orto store --dry-run\` in the durable clone (never in a
worktree), reviews the known/new/changed/unchanged buckets, then retains only
after picking files. This skill does not do that step; it only reads the
registry to build the bank card.
`;

export function projectBankSkillDir(fmHome: string): string {
  return join(fmHome, ".agents", "skills", PROJECT_BANK_SKILL_NAME);
}

export function projectBankSkillPath(fmHome: string): string {
  return join(projectBankSkillDir(fmHome), "SKILL.md");
}

export interface InstallProjectBankSkillResult {
  installed: boolean;
  dryRun: boolean;
  skillPath?: string;
  registryPath?: string;
  printOnly: boolean;
}

export async function installFirstmateProjectBank(input: {
  projectRoot: string;
  bankId: string;
  hindsightBaseUrl: string;
  dryRun: boolean;
  force: boolean;
}): Promise<InstallProjectBankSkillResult> {
  const fmHome = captainHomeDir();

  if (!fmHome) {
    return { installed: false, dryRun: input.dryRun, printOnly: true };
  }

  const skillPath = projectBankSkillPath(fmHome);
  const exists = await pathExists(skillPath);
  if (exists && !input.force && !input.dryRun) {
    throw new OrtoError(
      `project-bank skill already exists at ${skillPath}`,
      "Use --force to overwrite, or `orto mcp --harness firstmate --write-firstmate --dry-run` to preview.",
    );
  }

  if (!input.dryRun) {
    await ensureDir(dirname(skillPath));
  }
  await writeTextFile(skillPath, PROJECT_BANK_SKILL_CONTENT, input.dryRun);

  const { path: registryPath } = await saveCaptainRegistryEntry(
    input.projectRoot,
    { bankId: input.bankId, hindsightBaseUrl: input.hindsightBaseUrl },
    input.dryRun,
  );

  return {
    installed: !input.dryRun,
    dryRun: input.dryRun,
    skillPath,
    registryPath,
    printOnly: false,
  };
}
