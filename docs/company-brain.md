# Company brain config

Orto is a configuration utility for Hindsight-powered codebases.

It is a CLI that sets up, seeds, syncs, and maintains a [Hindsight](https://hindsight.vectorize.io/) memory bank from the durable knowledge already in a repository: READMEs, ADRs, standards, architecture notes, and domain docs.

Agents then `recall` and `reflect` against that bank instead of re-learning the same decisions every session.

Docs in git stay the source of truth.
The bank is the agent-facing memory of those docs.
`.orto/` is how the repo records which bank, which template, and which files belong in it.

This page is for people who already want Hindsight on a codebase.
It explains what the CLI adds compared with setting that bank up by hand, and compared with [Hindsight's coding-agent integration](https://hindsight.vectorize.io/sdks/integrations/coding-agents).

Command flags live in the [CLI reference](./orto-cli-commands.md).
The retain model is in the [sync strategy](./orto-sync-strategy.md).
File layout is in [knowledge-base configs](./orto-configs.md).
Sharing a bank across a team (deployment profiles, apply, multi-repo MCP) is in [team sharing](./team-sharing.md).

---

## What the CLI covers

There is no separate `orto sync` command.
Syncing the bank means running `seed` or `store` again after the docs change.

| Job | Command | What you get |
|-----|---------|----------------|
| Set up the project | `init` | `.orto/config.json` with a project bank id and the Docker container that hosts it. Bank id and container name are different: one Hindsight server can hold many banks. |
| Set up the bank profile | `configure` then `bank apply` | `.orto/hindsight/bank-template.json`: mission, directives, mental models, and extraction settings. `configure` writes the template; `bank apply` (or `configure --apply`) creates/updates the bank in Hindsight. |
| Choose how teammates reach it | `share` | `.orto/share.json` deployment profile: local, LAN, VPN, public, or [Hindsight Cloud](./hindsight-cloud.md). See [team sharing](./team-sharing.md). |
| Set up the server | `docker print` / `docker up` | A local Hindsight container when you self-host. Skip under Cloud profile, or point `seed` and `mcp` at an existing host. |
| Set up agent wiring | `mcp` | Snippets, or written files, so Cursor, Claude Code, Roo, Codex, Kiro, and Firstmate call this bank (bank-scoped server names). API keys stay in the environment. |
| Seed the bank | `seed --dry-run`, then `seed` | A first retain of high-signal sections. Dry-run lists candidates and skips. It does not retain. With `--judge jev` it may recall observation summaries. |
| Sync after edits | `seed` again, or `store` | Unchanged sources are skipped by content hash. Changed sections upsert on a stable `document_id`. |
| Maintain the selection | `store` | Ongoing retain of files you have allowlisted in `.orto/config.json`. New markdown is never stored unless you pick it. |

`seed` is the bootstrap.
It scans the default durable set (README, ADRs, `docs/**`) and retains what passes a conservative extract.

`store` is what you run after that, when durable markdown is already on disk and you want to choose the next retain.
It uses the same retain path as `seed`: same ids, same manifest, same auth.
It does not ingest chat, diffs, worktrees, or transcripts.

A normal first pass:

```bash
orto init
orto configure
orto seed --dry-run
orto seed
orto mcp --write --write-agents --write-cursor-rules --include-auth
```

Import the generated template into Hindsight before or alongside the first live `seed`, so mission and directives match the project.
Keys are `ORTO_HINDSIGHT_API_KEY` (or `HINDSIGHT_API_KEY`), passed only on live `seed` and `store`.

---

## Compared with setting up Hindsight yourself

You can run Hindsight, create a bank in the Control Plane, write a mission by hand, upload markdown, and paste an MCP URL into each editor. That works. It is also a fresh design for every repository, and the "how we keep this current" steps usually live in one person's shell history.

Orto keeps those steps in the repo and makes the retain path the same every time.

| By hand | With Orto |
|---------|----------------|
| Create a bank and fill mission, directives, and mental models in the Control Plane. | `configure` writes a reviewable template next to the code. You still import it once. Teammates see the same file in git. |
| Drop raw `.md` files in, or re-run an upload script over the tree. | `seed` retains high-signal sections through Hindsight's memories API. The bank holds structured memories (facts, entities, links), then consolidates into observations and mental models. |
| A re-upload often re-processes everything and can duplicate documents. | Content hashes in `.orto/local/seed-manifest.json` skip unchanged files. Stable ids (`orto:<path>#<section>`) upsert the same section when it changes. |
| Provenance is whatever the upload happened to store. | Each retained item carries source path, kind, and optional git commit. |
| Changelogs, TOCs, license boilerplate, and `.env` files are easy to include. | The scanner denies secrets and credential paths before extract. The extractor skips low-signal sections. `--dry-run` shows the keep/skip list with no API calls. |
| MCP JSON is copied per IDE, often with a literal key or a localhost URL nobody else can reproduce. | `mcp` prints or writes harness config. Written files use an env placeholder for the key. |
| Docker flags are assembled from Hindsight's docs. | `docker print` / `docker up` use the container and volume names from `.orto/config.json`. `docker upgrade` plans a pinned image move. |
| The next clone does not know the bank id, the template, or which files are in scope. | `.orto/config.json`, the bank template, and `store.allowlist` are the shareable setup. The seed manifest and API keys stay off git. |

Two limits are part of the current CLI, so they belong in the comparison.

Applying the template is still an import.
`configure` does not call Hindsight.
A bank you seed before that import runs with whatever mission is already on the server.

`seed` and `store` are additive.
Editing a file in place and re-running updates that section.
Renaming or deleting a source retains the new path and leaves the old `document_id`s in the bank until you run `orto prune` (path-gone / section-gone / explicit selection).
See the [CLI reference](./orto-cli-commands.md#orto-prune).
Optional `--judge jev` for “still on disk but no longer true” is planned later ([Jev integration](./jev-integration.md)).
Orto deletes only after you confirm (or after `--yes` with an explicit selection).

The same `seed` / `mcp` flow targets a local server or Hindsight Cloud.
Cloud is opt-in.
The default is a server you run.

Detail on retain versus file upload: [sync strategy](./orto-sync-strategy.md).
Detail on what must never be retained: [sensitive data](./sensitive-data.md).

---

## Compared with Hindsight's coding-agent integration

[Hindsight Coding Agents](https://hindsight.vectorize.io/sdks/integrations/coding-agents) (`@vectorize-io/hindsight-coding-agents`) is long-term memory for coding sessions.

You install it once per machine.
After that, ingestion is automatic.
A repo's git history and conversations flow into a per-repo bank in the background.
The default bank id is `coding-agent::{gitProject}`.
On a cold repo it can also survey the codebase and keep a small set of knowledge pages current.
At session end the transcript is retained.
Config for that behavior lives in `~/.hindsight/coding-agent.json` on the machine.
A cloned repository cannot turn that memory on.
That is intentional: the plugin is tied to the developer and the harness, not checked in with the project.

That is the right tool when you want this machine to remember recent commits and recent sessions without a command to run.

Orto is the right tool when the memory should come from documents the team already reviews, and when the setup should travel with the repo.

| | Coding-agent integration | Orto |
|--|--------------------------|----------|
| Corpus | Commit history, session transcripts, an optional codebase survey, and documents an agent ingests mid-session. | Durable project docs you would merge: README sections, ADRs, standards, architecture, domain references. |
| When it writes | Session start and session end, in the background. There is no ingest command. | When you run `seed` or `store`. `--dry-run` shows the plan first. |
| Bank | `coding-agent::<repo>` by default, resolved on the machine. | The bank id in `.orto/config.json`, shared by whoever seeds and wires that repo. |
| Config | `~/.hindsight/coding-agent.json`. Per-repo overrides stay in that file. | `.orto/` in the repo. The seed manifest and API keys stay local. |
| Who decides | The plugin retains git and chat by default. | You do. `store` never adopts a new file on its own, including with `--yes`. |
| What the agent receives | A reflect injected into the session, plus the plugin's memory tools, aimed at the coding-agent bank. | MCP wiring (`recall`, `reflect`, `retain`) aimed at the project bank, plus an `AGENTS.md` or Cursor rule that says to prefer that bank. |
| Chat and diffs | Session transcripts are the product. Git ingest can include commit messages or full diffs. | Chat, diffs, worktrees, and transcripts are out of scope. `store` refuses that path on purpose. |

Use both when you want both, on different banks.

Point the coding-agent plugin at session memory for the person at the keyboard.
Point Orto at the project bank built from reviewed docs.
They can share one Hindsight server (the container from `orto docker`, or Cloud) without sharing one bank.
Mixing them into a single bank folds unreviewed chat into the same memories agents cite as architecture.

Orto does not install, configure, or replace the coding-agent plugin.
If you want automatic session memory, install that package.
If you want a maintained project bank, run this CLI.

---

## How a team uses it

**First bank on a repo.**
Run `init`, `configure`, and import the template.
Run `seed --dry-run` and read the candidates.
Run `seed`.
Run `mcp` for the harnesses you actually use.
The first coding session can recall a decision from the bank, with a source path, without anyone pasting the ADR into the prompt.

**A doc change after that.**
Re-run `seed` for the default scan, or `store` for the allowlist.
Unchanged files are skipped.
The edited section keeps its `document_id` and is upserted.
`--force` re-retains current candidates on purpose.

**A file you do not want in the broad scan.**
Leave it out of `seed`'s results by keeping it off the durable set, or adopt it explicitly with `store --files`.
`store --add-files` records the path on the allowlist and does not retain it yet.

**Another machine or teammate.**
They clone the repo, so they get the bank id, the template, and the allowlist.
The seed manifest is gitignored, so the first live `seed` on that machine retains the current candidates and then writes local incremental state.
They point `ORTO_HINDSIGHT_URL` at the shared server (or Cloud) and run `mcp` with that URL.
Keys are distributed out of band, never committed.

**A local server move.**
`docker status` checks the container name in config.
`docker upgrade --to <version> --dry-run` plans a pinned upgrade.
Backup steps are in [Hindsight upgrade](./hindsight-upgrade.md).

---

## What this CLI leaves in place

Hindsight remains the memory system: retain, recall, reflect, and background consolidation.
Orto does not replace the Control Plane, and it does not wrap Hindsight's installer as a product of its own.

The coding-agent integration remains the automatic session memory.
Orto remains the explicit project-bank path.

ADRs, standards, and architecture docs remain the writing.
The CLI does not author a wiki, interview you into a `CLAUDE.md`, or treat chat history as the corpus.

An optional [Graphiti](./graphiti-integration.md) seed destination is on the [roadmap](../ROADMAP.md).
A Hindsight bank today is set up, seeded, and maintained without it.

---

## How Jev sharpens the bank

[Jev](https://docs.typesafe.ai/introduction) (TypeSafe System One) is an optional judgment layer for this config.
The seed relevance gate is available.
The rest of the layer is still [Phase 7](../ROADMAP.md).
Product rule: [jev.md](./jev.md).
It is optional.
Hindsight stays the memory bank.
The CLI keeps today's heuristics when `ORTO_TYPESAFE_API_KEY` is unset and `--judge jev` is absent.

A company brain is only as good as the decisions that fill it: which section is durable, which memory is stale, which file belongs on the allowlist, and when a person should confirm.
Those calls are conservative heuristics today.
Jev scores them.
Orto still scans, retains, and applies.
Jev returns a typed choice and a confidence score.
A low score stays a preview until someone confirms.

| Decision | Today | With Jev |
|----------|-------|----------|
| What to retain | `seed --dry-run` lists a heuristic keep/skip. | `seed --dry-run --judge jev` adds a relevance decision, a durability score, a knowledge kind with probabilities, a relation to overlapping observations, and confidence for each section. One file can mix retain and skip. A confident `noise` or `style_pref` is not retained. A confident `supersedes` or `contradicts` answer records the old observation id on that retain. A confident secret or personal-data answer is skipped, and the warning names the path without printing the secret. Extracted facts are checked against the source section, and a high-confidence unsupported fact is not retained. |
| What to spend retain on | Every candidate that passes is eligible. | `seed --budget N --judge jev` ranks sections and retains the top N. A changed ADR outranks a wording-only changelog. The rest stay pending until a later seed. |
| What `store` adopts | You pick every new file. The command never adopts one on its own. | `store --propose-adopt --judge jev` can propose a new durable file. You confirm with `--apply` before the allowlist changes. Nothing is retained until you store it. |
| Whether a known-file edit is worth retaining | Every changed allowlisted file is eligible. | `store --judge jev` skips wording-only edits (hash still updates) and holds temporary workarounds for review. A real claim change re-retains. |
| Whether the template fits the repo | `configure` writes mission, directives, and starter mental models for you to review in git. | Jev scores that draft, suggests how aggressive extraction should be, proposes mental-model questions, and assigns tags the same way across sections. The prose stays in the template you commit. |
| Whether the bank is still current | `seed` and `store` are additive. `orto prune` lists path-gone / section-gone candidates (and explicit selections) and deletes after you confirm. | Optional `--judge jev` also scores what is outdated, irrelevant, or contradicted when the file is still on disk. Low confidence stays unchecked. A mental-model refresh is a separate confirmation. |
| What an agent should trust | MCP exposes `recall`, `reflect`, and `retain` on the project bank. | An unsafe `retain` from the agent is refused. Recalled passages can be reranked before they fill a prompt. A still-true check can flag a memory the docs no longer support. The route picks `reflect`, `recall`, or a mental model for the question. |
| When Firstmate should use the bank | The `project-bank` skill is recall-only. Crewmates do not seed or store. | Jev can say whether the task needs this bank, which bank, and whether the outcome is a doc update, a pull request, or both. Low confidence goes to the captain. A scout report is judged for seedability before anyone retains it. |
| Before the bank is shared | You choose local, LAN, VPN, public self-host, or Hindsight Cloud. | A safety check runs before a public or Cloud share. The destination stays a Orto choice, with Hindsight first. |

Teams that never call Jev still get a sharper default.
A golden-set judge scores the offline heuristics, so keep/skip improves without a TypeSafe key at runtime.

What Jev sees is small on purpose: the section, the mission, and a short list of overlapping memories.
Secrets and denylisted paths stay on the machine.
Retain, prune, and share stay in this CLI, behind the confidence gate.

Product rule: [jev.md](./jev.md).
Issue groups and the phase checklist are in [Phase 7](../ROADMAP.md).
