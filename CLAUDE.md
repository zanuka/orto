# Orto Development Guide for Claude Code

**Orto** is an open-source CLI that turns durable project knowledge into Hindsight memory banks so AI agents inherit shared context.

## Core Principles

### Non-negotiable
- Prefer **durable** knowledge over ephemeral content
- Keep designs **local-first** and self-hostable
- Amplify existing engineering practices (ADRs, standards, architecture docs): do not replace them
- CLI is the primary interface; keep it fast and predictable
- Hindsight is the first-class target. Other providers must not compromise the Hindsight experience
- Stay harness-agnostic: Claude Code, Codex, Cursor, Pi, and other popular agentic workflows are first-class; Firstmate is optional

### Architecture Boundaries

Keep these concerns separated:
1. Project scanning / knowledge discovery
2. Extraction of durable facts & decisions
3. Bank template / configuration generation
4. Seeding (retain) into the memory system
5. Pruning stale bank documents (path-gone / section-gone / explicit; local tombstones)
6. Optional judgment (`src/judge/`: heuristic or opt-in Jev; not a memory provider)
7. Integration emission (MCP, Cursor rules, AGENTS.md snippets, etc.)

Do not collapse these into a single opaque pipeline.

### What to Avoid
- Inventing architecture or patterns that contradict project principles
- Expanding into general multi-agent orchestration or product agent embedding unless explicitly asked
- Making cloud services the default path
- Treating every file in a repo as seed-worthy knowledge

## CLI Architecture

Refer to `docs/cli-architecture.md` as the authoritative map. Update that doc when boundaries or flows change.

### Module Placement

Put logic in the matching layer; do not collapse stages into `commands/` or a single helper:

| Concern | Module |
|---------|--------|
| Flags / UX / orchestration | `src/commands/` |
| Root detection, git commit | `src/project/` |
| `.orto/config.json` schema + IO | `src/config/` |
| Discover durable files | `src/scanner/` |
| Heuristic candidates + provenance | `src/extractor/` |
| Prepare retain + seed manifest | `src/seeder/` |
| Hindsight template + HTTP retain | `src/providers/hindsight/` |
| Opt-in Judge port (heuristic / Jev) | `src/judge/` |
| MCP snippets + AGENTS / Cursor rules | `src/integration/` |
| Local Hindsight Docker helper | `src/docker/` |

Commands may call modules; modules must not depend on Commander. Integration emission must stay separate from scan / extract / seed / prune.

### Happy Path Invariants

- Mutating or network commands support `--dry-run` where practical
- `seed --dry-run` previews candidates and does not retain or write the manifest. It does not call Hindsight unless `--judge jev` is set, in which case it may recall up to 5 observation summaries and may preview extracted facts (both read-only) and still must not retain or delete
- `prune --dry-run` may list documents (read-only) but must not delete or write tombstones
- Live `seed` uses stable `document_id`s and writes incremental state only under `.orto/local/` (gitignored)
- Live `prune` deletes selected documents and writes tombstones under `.orto/local/` (gitignored)
- Version-controlled config stays under `.orto/` (`config.json`, `hindsight/bank-template.json`); never commit API keys
- `init` prompts for bank id + Docker container name in a TTY (flags/`--yes` skip prompts); bank id is not the Docker container name
- Docker container/volume: CLI `--name` → `config.docker` → defaults `hindsight` / `hindsight-data`

### Hindsight Connection

Resolve URL/key in order: CLI flag → config (URL only) → env → default `http://localhost:8888`.

- URL: `--hindsight-url`, `hindsightBaseUrl`, `ORTO_HINDSIGHT_URL` / `HINDSIGHT_URL`
- Key: `--api-key`, `ORTO_HINDSIGHT_API_KEY` / `HINDSIGHT_API_KEY` (Bearer header; not stored in config)

## CLI Design Conventions

- Commands should be composable and predictable (`init`, `configure`, `seed`, `status`, `mcp`, etc.)
- Support both interactive and non-interactive / CI-friendly usage
- Prefer explicit flags over hidden behavior
- Include `--dry-run` for any command that mutates state or talks to external systems
- Help text should be concise and show the happy path first

## TypeScript Conventions

- Strict mode preferred
- Prefer interfaces / types that model the domain clearly (BankTemplate, DurableFact, Provenance, etc.)
- Avoid deep inheritance; favor composition
- Keep modules focused: one primary responsibility per file when practical
- Public CLI surface should be stable; internal modules can evolve faster
- Strong TypeScript typing; avoid `any`

## Error Handling

- Fail fast with clear messages
- Tell the user the next concrete action when possible
- Distinguish between user error (bad config, missing files) and system error
- Errors must be actionable; fail with `OrtoError` (or equivalent) plus a concrete next step

## Testing Mindset

- Core extraction and template generation logic should be unit-testable
- Prefer pure functions for knowledge transformation where possible
- CLI integration tests can come later; focus on the domain logic first

## Knowledge Curation

### What Counts as Durable Knowledge

Prefer:
- Architecture Decision Records (ADRs)
- High-level README sections that describe purpose, constraints, and non-goals
- Explicit coding standards and project conventions
- Domain models / invariants
- Stable API / schema descriptions
- Documented trade-offs and "why we did it this way"

Deprioritize or ignore:
- Generated files
- Lockfiles and dependency noise
- Temporary notes, TODO dumps, or session transcripts
- Implementation details that change frequently without architectural impact
- Secrets and sensitive config: `.env*`, credentials, private keys, `secrets/` / `credentials/` trees, API-key docs

### Extraction Principles

- Be conservative. Missing a fact is better than injecting noise or outdated claims.
- Preserve provenance (source path + optional git commit / line range).
- Prefer structured output that maps cleanly to Hindsight concepts (facts, observations, mental models).
- Do not hallucinate project decisions. Only extract what is present in the source material.
- Skip fenced code blocks when parsing markdown headings
- Never retain secrets: deny `.env*`, keys, credential files, and `secrets/` / `credentials/` paths in the scanner before extract/seed

### Bank Configuration

- Mission statements should be specific to the project, not generic AI filler.
- Directives should encode real constraints and preferences (local control, performance, existing patterns, etc.).
- Extraction mode and chunking should be tuned for technical documentation, not general chat.
- Single-bank is the default and preferred starting point for most repositories.

### Seeding

- Every retained item should be traceable back to a source.
- Support incremental / re-seed flows so banks can stay current without full re-ingestion.
- Make it easy for a human to review what is about to be retained (`--dry-run`).
- Never retain secrets: scanner must deny `.env`, keys, credential files, and sensitive doc paths before extract/seed.

## Hindsight Bank Usage

Use the project memory bank `orto` via Hindsight MCP when answering questions about architecture, decisions, coding standards, or domain rules.

- Prefer `recall` / `reflect` on the project bank before re-deriving facts from README/ADRs alone.
- MCP URL: `http://localhost:8888/mcp/orto/`
- Docs and ADRs remain authoritative; the bank is how agents inherit them across sessions.
- Never retain secrets or credentials into the bank.

## Markdown Style

When creating or editing markdown files, do not use em dashes (—, U+2014). Do not substitute en dashes (–, U+2013) as a stand-in.

Prefer instead:
- a comma or colon
- parentheses for asides
- two short sentences
- hyphen-minus (`-`) only for compound modifiers, ranges written in words, or list markers

```markdown
Bad:  Ack replay is idempotent — same body on repeat.
Good: Ack replay is idempotent: same body on repeat.
Good: Ack replay is idempotent (same body on repeat).
```

Before finishing a markdown edit, scan the file and replace any em or en dashes used as punctuation.

## Working Style

- Prefer small, focused changes
- Update `ROADMAP.md` status when a phase item is completed or significantly changed
- When adding user-facing commands, support `--dry-run` where it makes sense
