# Coding-Agent Bridge and Deferred Store Queue

This document records the exploration recommendation for [issue #105](https://github.com/zanuka/orto/issues/105) and documents the opt-in prompt-only handoff and quiet-window store queue.

## Recommendation Summary

Start with a **prompt-only handoff** backed by a **deferred store queue** under `.orto/local/store-queue.json`, and defer any background daemon or OS listener until upstream `coding-agents` exposes a stable event callback.

- **Event source**: Option D first (agent-facing CLI/skill calling `orto store --propose-from-paths <paths>`), followed by Option C (Orto-owned filesystem watcher converging on the same queue). Do not scrape private `~/.hindsight/coding-agents-logs/` internals as a product dependency.
- **Banks stay separate**: `coding-agent::<repo>` continues to hold session transcripts, git history, and surveys. The Orto project bank continues to hold curated ADRs, standards, architecture docs, and allowlisted paths.
- **Confirm before mutate**: `orto store --propose-from-paths` never silently adopts unlisted files and never retains without explicit confirmation (`--enqueue` or `--now`).
- **Queue until quiet by default**: On shared local Hindsight + Ollama setups, confirmed syncs enqueue under `.orto/local/store-queue.json` and drain when Hindsight operations settle, rather than competing with coding-agent `batch_retain` storms.

## Non-Goals Preserved

- Never auto-retain session transcripts or git diffs into the Orto project bank.
- Never make coding-agent banks the source of truth for architecture.
- Never silently adopt new files onto `store.allowlist` (keep `--propose-adopt` -> `--apply` or explicit `--add-files`).
- Stay harness-agnostic (Claude Code, Codex, Cursor, Pi, Firstmate).
- Never enable a background daemon by default.
- Never store API keys in `.orto/local/store-queue.json`.

## Harness-Agnostic Confirmation UX

When an agent or developer edits durable docs during a session, run:

```bash
orto store --propose-from-paths docs/adr/0042-foo.md,AGENTS.md --dry-run
```

Orto classifies the paths against `store.allowlist` and scanner deny rules (`.env*`, secrets, credentials are always rejected), then prints a concrete table and two confirmation commands:

- **Queue until quiet (recommended)**: `orto store --propose-from-paths <paths> --enqueue`
- **Run immediately (escape hatch)**: `orto store --propose-from-paths <paths> --now`

Any harness (Claude Code, Cursor, Codex, Pi, Firstmate) can present this proposal to the operator as a yes/no/queue choice without needing a custom daemon.

## Quiet-Policy Recommendation

When draining `.orto/local/store-queue.json` via `orto store --drain-queue`, Orto checks Hindsight's operations API for both the project bank and `coding-agent::<repo>` (overridable via `--coding-agent-bank <id>`):

1. **Pending operations**: active (`pending`, `processing`, `running`, `in_progress`, `queued`) count must be at or below `maxPendingOps` (default `0`).
2. **Stuck operations**: no active operation with `stage_age >= 300` seconds.
3. **Cooldown**: at least `60` seconds since the most recent completed operation timestamp on checked banks.
4. **Manual override**: `orto store --drain-queue --now` bypasses quiet checks when the operator knows the LLM slot is free.
5. **Max-wait nudge**: jobs waiting longer than `45` minutes are flagged as `AGED` in `orto store --queue` and `orto status` with a concrete nudge to run `--drain-queue --now` or keep waiting.
6. **Deferred Jev**: `--judge jev` flags saved on a queued job run at drain time rather than at enqueue time, avoiding extra LLM load during coding-agent bursts.

## Relationship to Filesystem Watcher and JEV-13

Both event-driven triggers converge on the same queue:

- **Coding-agent / prompt-only**: `orto store --propose-from-paths <paths> --enqueue` -> `.orto/local/store-queue.json`
- **Filesystem watcher (future)**: `judgeWatcherGate` -> `collectSeedEnqueue` -> `enqueueWatcherDecisions` -> `.orto/local/store-queue.json`

Both are drained by `orto store --drain-queue` and surfaced in `orto status`.

## Follow-Up Work

- Optional upstream ask to Vectorize for a stable `coding-agents` "durable path changed" callback.
- Optional `orto watch` / `orto listen` CLI once the prompt-only + quiet-drain loop is proven in daily use.
