# AGENTS.md: Orto

This file is the primary source of truth for any AI agent working on Orto.

## Project Identity

Orto is a **company brain config** utility.

It helps developers turn durable project knowledge (docs, ADRs, decisions, domain references) into structured memory banks: starting with Hindsight, so AI agents inherit shared context instead of rediscovering it every session.

We are building this in public as open source.

## Core Principles (non-negotiable)

1. **Durable over ephemeral**  
   Prefer knowledge that should outlive a single session, model, or tool. Do not treat chat history or temporary notes as first-class sources.

2. **Local control first**  
   Favor self-hostable, version-controlled, offline-capable designs. Avoid forced cloud dependencies.

3. **Amplify existing craft**  
   Orto does not replace ADRs, architecture docs, or coding standards. It makes them usable by agents.

4. **CLI-first, progressive enhancement**  
   The primary interface is a fast, predictable CLI. UIs and advanced features come later.

5. **Hindsight-native initially**  
   First-class support is for Hindsight banks (mission, directives, retain/recall/reflect). Other providers come later and must not break the Hindsight path.

6. **Clear boundaries**  
   Keep knowledge curation, bank configuration, and agent integration concerns separated. Do not create a monolithic "do everything" agent system.

## Architecture Expectations

- TypeScript CLI (Node.js)
- Clean separation: scanner → extractor → bank template → seeder → prune → integration emitters
- Config lives in `.orto/` (or equivalent) and is version-controlled
- Prefer explicit configuration over magic
- Every retained fact should carry provenance (source file + optional commit)

## Coding Standards

- Prefer small, composable functions and clear module boundaries
- Strong typing: avoid `any` unless there is a documented reason
- CLI commands should be idempotent where practical and support `--dry-run`
- Errors should be actionable (tell the user what to do next)
- No silent failures on knowledge extraction

## When Working on Knowledge / Bank Features

- Treat project documentation as the source of truth
- Extraction should be conservative: better to miss something than to inject noise
- Bank missions and directives should reflect real project values, not generic AI filler
- Always consider how an agent will actually use the bank in a coding session

## Documentation & Public Development

- Keep the README and ROADMAP accurate
- Prefer updating living docs over leaving stale comments
- When adding a major capability, update the roadmap status

## What Agents Should Not Do

- Do not invent new architecture patterns without justification against existing ADRs/standards
- Do not expand scope into general agent orchestration, multi-agent frameworks, or product surfaces unless explicitly requested
- Do not add cloud-only or vendor-locked paths as the default
- Do not treat the bank as a dumping ground for every file in the repo

## Current Focus

See `ROADMAP.md`. Phase 3 added `orto store` and the Firstmate `project-bank` skill.
Phase 4 shipped `orto prune` v1 (path-gone / section-gone / explicit + tombstones).
Phase 5 (team sharing) shipped: bank-scoped MCP names, `bank apply` / `configure --apply`, `orto share` deployment profiles (local/LAN/VPN/public/hindsight-cloud), profile-aware MCP emission, and `orto docs list`.
Phase 6 (mental models) shipped: seed-aligned tags, differentiated refresh presets, interactive `configure` wizard, `orto mental-model` lifecycle CLI, opt-in `seed --refresh-mental-models`, and agent snippets preferring `reflect` for playbook questions.
Phase 7 (current): optional Jev judgment layer. `seed --judge jev` runs the relevance gate, a knowledge-kind choice, a contradiction check against overlapping observations, a secret / personal-data check, and a citation check on Hindsight's extracted facts before retain, one decision per section. `seed --budget N --judge jev` ranks that retain queue and keeps the top N. The rest stay pending. `store --propose-adopt --judge jev` can propose new allowlist files; the operator confirms with `--apply`. `store --judge jev` gates changed allowlisted files for wording-only skips and workaround review. The watcher high-signal gate helper (`judgeWatcherGate`) ships without a default `watch` CLI. Prune annotation is still open, then reliability and DX.

<!-- orto:hindsight-bank -->

## Project memory bank (Hindsight)

Prefer the project Hindsight bank `orto` for durable orto context (architecture, decisions, standards, domain invariants).

- Prefer `reflect` (or read mental models) for architecture, standards, and "how we work" / playbook questions.
- Prefer `recall` for narrow fact lookup and provenance hunting.
- Use Hindsight MCP before rediscovering the same facts from scattered docs.
- MCP endpoint (single-bank): `http://localhost:8888/mcp/orto/`
- Treat repo docs and ADRs as source of truth; use the bank as the agent-facing memory of those sources.
- Do not dump secrets, credentials, or ephemeral chat into the bank.

<!-- /orto:hindsight-bank -->
