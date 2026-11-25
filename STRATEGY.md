# Orto Strategy

## Vision

<!-- vision: author-approved 2026-11-24 -->

`orto` exists so that every coding agent working on a project starts from the same reviewed knowledge instead of rediscovering it each session.
It serves the engineers who maintain a project and the teams they build with, and it turns the durable knowledge they already keep, in the repository or wherever the team writes its decisions, into Hindsight banks those agents can trust.
It owns exactly one thing: the decision of what from a project's durable knowledge is worth giving to memory, with a link from each memory back to its source.

### Durable over complete

A bank holds what the project decided and states today: ADRs, architecture, standards, invariants, and the reasons behind them.
Declared contracts such as OpenAPI, JSON Schema, GraphQL SDL, and protobuf count when the operator opts specific files in, one document per operation or type.
Source code and language types never enter: they change often, agents already read them, and an index of the codebase buries the why.
Changelogs, tables of contents, install steps, badge walls, lockfiles, and generated files are noise that every future recall must dig through.
History is not state: chat, diffs, transcripts, commit messages, and PR bodies belong on the coding-agent bank, and a PR that settles something updates a doc, which is what gets seeded.
Selection works per section, so one file can contribute its architecture and withhold its changelog.
Missing a fact is better than retaining an outdated or invented one.
Orto curates what people stated; it never infers a decision from code or drafts one from the bank, and a thin bank is reported as a gap, not filled with plausible prose.

### Every memory traces home

Every retained item carries its source, section, and revision under a stable `document_id`, and a bank written by more than one repository uses ids that include the repository.
Every source must be able to disappear, so prune and drift stay honest: a gone file, section, or external page leaves the bank, and a tombstone keeps unchanged text from coming back.
Re-seeding is incremental: only content whose hash or revision changed is retained again.
Incremental state and tombstones survive wherever seeding runs, including an ephemeral CI runner.
Bank health is reported as evidence, such as how many sampled memories their sources still support.

### Agents and events propose, people decide

Every command that mutates state or talks to a network has a `--dry-run`, and a dry run never retains, deletes, or writes the manifest.
A coding-agent event, a file watcher, or an agent's own decision may queue a store proposal; none of them retains anything by itself.
A confirmed job runs when Hindsight is quiet, yielding to coding-agent load on a shared server.
A project may opt into auto-yes for changed allowlisted files; that is standing consent, never a default, and it still waits for a quiet window.
In CI the dry run is previewed on the pull request and the merge is the confirmation.
An agent's decision becomes project knowledge only when a person accepts it into a doc, because a tag on a recalled fact does not protect the agent that reads it.
New files and external pages are adopted explicitly, deletion and public sharing need confirmation, and low confidence stays in review.
Secrets and personal data are denied before extraction, before any judge call, and before any retain, by path in the repository and by content scan on the free path for sources without one.
Cloning a repository never starts a listener, and generated agent rules never claim a gate that nothing enforces.

### Local first, Hindsight first

The default path is a self-hosted Hindsight server on the operator's machine, with no account and no cloud dependency.
Cloud, LAN, VPN, and public profiles are explicit opt-ins, and a public or Cloud profile refuses internal material.
Sources outside the repository are opt-in and read through MCP servers the user already runs; Orto never builds or wraps SaaS clients, and their credentials stay in those servers.
Knowledge whose readers are narrower than a bank's readers is refused, so a private page or repository is never recallable from a wider audience.
Hindsight is the first-class memory target; other providers are opt-in destinations that never degrade the Hindsight path.
API keys live in the environment, never in committed config.

### Judgment is optional and earns its place

Orto is complete without any paid service: the heuristic path is the product, not a fallback, and routing to a bank never requires a judge.
Jev runs only when a command asks for it by name; a key in the environment never turns it on, and the same command gives the same result on every machine.
Jev answers narrow typed questions and Orto keeps every side effect; Jev never writes the bank, authors prose, or acts as a memory provider.
Every judge names the test it must pass: answer quality for admission and recall, catch rate for safety, drift for hygiene.
A judge that fails its test across more than one repository loses its Jev path, not just its default, and what it taught moves into the free heuristic.
No judge ships ahead of the thing it judges.

### One owner per bank

A company brain composes banks; it never merges repositories into one.
Each repository keeps its own bank, owner, review, and prune, and a single bank is the default starting point.
Decisions that span repositories live in a repository that owns them, seeded into its own bank, and `orto mcp` wires each project to its own bank plus the shared banks it reads.

### Scope

Orto is not a memory server, not a session-memory plugin, not a docs generator, not a sync script, and not a CI product; it ships forge-neutral commands.
It keeps judgments about what enters, leaves, or is read from a bank; judgments about which agent does the work live in the tools that run agents, which call Orto's judge port and secret sanitizer instead of forking them.
Generated AGENTS.md and rules carry guidance about the bank, never a workflow's vocabulary.
Claude Code, Codex, Cursor, Pi, and other harnesses are first-class, and Firstmate is one optional integration, not the center.
Scanning, extraction, template generation, seeding, pruning, judgment, and integration emission stay separate stages, and the CLI stays fast, composable, and usable without a TTY.
Orto dogfoods itself: this repository seeds its own bank, and field gaps become roadmap items.

A change aligns when it makes a bank more trustworthy per retain spent, strengthens provenance or a refusal path, keeps the default path local, offline, and judge-free, or lets one more harness or team read the same reviewed knowledge.
A change should be resisted when it retains something no person accepted, invents or infers knowledge the source does not state, seeds history or code as if it were a decision, makes a cloud service or a paid judge the default, lets a judge, provider, or agent take over a side effect Orto owns, merges banks that have different owners, collapses the stages into one pipeline, or grows Orto from a knowledge curator into a workflow orchestrator.
