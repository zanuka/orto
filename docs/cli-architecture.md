# Orto CLI Architecture

Contributor guide to how the CLI is structured and how the main commands work. Read this alongside [AGENTS.md](../AGENTS.md) and [ROADMAP.md](../ROADMAP.md).

## Mental model

Orto turns **durable project knowledge** already in a repo into a configured [Hindsight](https://hindsight.vectorize.io) memory bank so coding agents inherit shared context.

It is **not** a general multi-agent orchestrator. It is a local-first config + curation CLI with clear stage boundaries:

1. Discover durable sources (scanner)
2. Extract high-signal candidates (extractor)
3. Generate bank templates (provider template)
4. Retain into the memory system (seeder), driven by `seed` (bootstrap scan) or `store` (ongoing operator-selected subset; same retain path)
5. Prune stale bank documents (`prune`: path-gone / section-gone / explicit; local tombstones)
6. Emit agent integration snippets (MCP configs, optional AGENTS.md / Cursor rules, Firstmate `project-bank` skill)

Prefer missing a weak fact over injecting noise.

## Architecture overview

```mermaid
flowchart LR
  subgraph cli [CLI commands]
    initCmd[init]
    configureCmd[configure]
    seedCmd[seed]
    storeCmd[store]
    pruneCmd[prune]
    dockerCmd[docker]
    mcpCmd[mcp]
  end

  subgraph core [Domain modules]
    project[project root detect]
    config[config Zod schema]
    scanner[scanner]
    extractor[extractor]
    template[Hindsight template]
    seeder[seeder manifest prune tombstones]
    client[Hindsight HTTP client]
    integration[integration snippets]
    dockerHelper[docker helper]
  end

  subgraph disk [Project files]
    ortoDir[".orto/"]
    sources[README docs ADRs AGENTS]
    agentFiles[".cursor mcp AGENTS rules"]
  end

  subgraph remote [Hindsight]
    bank[Memory bank]
  end

  initCmd --> project --> config --> ortoDir
  configureCmd --> config
  configureCmd --> template --> ortoDir
  seedCmd --> scanner --> sources
  storeCmd --> scanner
  scanner --> extractor
  extractor --> seeder
  seeder -->|dry-run| seedCmd
  seeder -->|live retain| client --> bank
  seeder --> ortoDir
  pruneCmd --> seeder
  pruneCmd -->|list delete docs| client
  dockerCmd --> dockerHelper
  dockerHelper -->|local instance| bank
  mcpCmd --> config
  mcpCmd --> integration --> agentFiles
  integration -->|MCP URL| bank
```

### Seed pipeline detail

```mermaid
flowchart TD
  start[orto seed] --> loadCfg[Load .orto/config.json]
  loadCfg --> findSources[Scan durable sources]
  findSources --> extract[Extract candidate facts]
  extract --> hashCheck{Content hash unchanged?}
  hashCheck -->|yes and not --force| skip[Skip source]
  hashCheck -->|no or --force| candidates[Candidates to retain]
  candidates --> judge{--judge jev?}
  judge -->|no| dry{--dry-run?}
  judge -->|yes| recallObs[Recall up to 5 observations]
  recallObs --> relevance[Relevance, kind, and relation]
  relevance --> dry
  dry -->|yes| preview[Print candidates plus provenance]
  dry -->|no| retain[POST /v1/default/banks/id/memories]
  retain --> manifest[Write .orto/local/seed-manifest.json]
```

## Source layout

| Path | Responsibility |
|------|----------------|
| `src/cli.ts` | Commander entry: wires commands and flags |
| `src/commands/` | Command orchestration + user-facing output |
| `src/project/` | Project root detection, git commit lookup, worktree detection, captain-home registry |
| `src/config/` | Paths, Zod schema, load/save `.orto/config.json` + `share.json`, deployment profiles, connection resolution |
| `src/scanner/` | Find durable docs (default README, docs/**, ADRs, or `scanner.include` / `exclude` / `extensions`); skip `AGENTS.md`; `store`'s stricter denylist |
| `src/extractor/` | Conservative heuristics → candidate facts + provenance |
| `src/providers/hindsight/` | Bank template, mental-model helpers, HTTP retain / list / delete / bank-apply / mental-model client |
| `src/judge/` | Opt-in `Judge` port (`off` / `heuristic` / `jev`); `buildJevState` skips denylisted paths and inline secrets and caps state before the TypeSafe HTTP call; `seed --judge jev` runs the relevance gate, the knowledge-kind choice, a contradiction check, and `contains_secret` / `contains_pii` once per `document_id` (kind criteria in `knowledge-kinds.json`; up to 5 observation summaries). Confident supersedes or contradicts stamps observation metadata and does not delete the old item. A confident secret or personal-data answer is not retained. Citation then previews Hindsight's extracted facts (read-only) and asks once per section whether each fact is in the source. A high-confidence unsupported fact is not retained. `judgeWatcherGate` answers `durable_claim_changed` and `behavior_delta` for a future watch loop; there is no default `watch` CLI. Hindsight code must not import TypeSafe |
| `src/watcher/` | Seed enqueue helper for the high-signal gate (`collectSeedEnqueue`). No filesystem watcher and no CLI command yet |
| `src/seeder/` | Prepare retain payload, incremental manifest, prune planner, tombstones (shared by `seed`, `store`, `prune`) |
| `src/integration/` | MCP URL + harness snippets + AGENTS/Cursor rule emitters + Firstmate `project-bank` skill |
| `src/docker/` | Local Hindsight Docker run/stop/status plans |
| `src/utils/` | Shared FS helpers and actionable errors |

Keep these boundaries. Do not collapse scan → extract → retain into one opaque function. Integration emission stays separate from seeding.

## Happy path commands

```bash
pnpm install && pnpm build
node dist/cli.js init
node dist/cli.js configure
node dist/cli.js bank apply --dry-run
node dist/cli.js docker print
node dist/cli.js seed --dry-run
node dist/cli.js seed
node dist/cli.js store --dry-run
node dist/cli.js store --yes
node dist/cli.js prune --dry-run
node dist/cli.js share --profile local
node dist/cli.js mcp
node dist/cli.js mcp --write --dry-run
```

| Command | What it does |
|---------|----------------|
| `init` | Detect project root; prompt (or flags) for bank id + Docker container; write `.orto/config.json` |
| `configure` | Generate Hindsight bank template under `.orto/hindsight/`; optional `--apply` |
| `bank apply` | Create/update bank + directives + mental models from the template (`--dry-run`) |
| `share` | Write/validate `.orto/share.json` deployment profile (local/LAN/VPN/public/cloud) |
| `docs list` | Flat bank document inventory for scripts |
| `docker` | Print or run a local Hindsight container (`up` / `down` / `status` / `print` / `upgrade`); skipped under Cloud profile |
| `seed --dry-run` | Scan + extract; print candidates; no retain. `--judge jev` prints the relevance gate, calls TypeSafe, and may recall up to 5 observation summaries and preview extracted facts (both read-only). `--budget N` prints the ranked queue and a cutoff |
| `seed` | Retain candidates into Hindsight; update local seed manifest |
| `store --dry-run` | Print known/new/changed/unchanged buckets for allowlisted + discovered markdown; **no** API calls |
| `store` | Retain an operator-selected subset (allowlist, `--files`, or interactive pick) via the same seed retain path. `--propose-adopt --judge jev` prints new files to consider; `--apply` writes those paths and does not retain. `--judge jev` on changed files runs the edit durability gate before retain |
| `prune --dry-run` | List path-gone / section-gone / explicit candidates (read-only document list); no deletes |
| `prune` | Delete selected bank documents; write local tombstones under `.orto/local/` |
| `mcp` | Print ready-to-paste MCP snippets (bank-scoped server names); optional `--write` / `--check` / AGENTS / Cursor rules / Firstmate |

Common flags:

- `--dry-run`: preview without mutating (`seed --dry-run` does not retain; with `--judge jev` it may recall observation summaries and preview extracted facts, both read-only; prune may list documents read-only)
- `--force`: overwrite config/template/MCP entry, or re-seed unchanged / tombstoned sources
- `--yes` / `-y`: on `init`, accept defaults; on `prune`, apply an explicit `--source` / `--document-id` selection
- `--bank-id <id>`: Hindsight bank id on `init` (project-specific; many banks can share one server)
- `--container-name <name>`: local Docker container on `init` (shared Hindsight server)
- `--hindsight-url <url>`: override Hindsight base URL for this run
- `--api-key <key>`: override API key for this run (seed / store / prune) or enable tenant auth (docker) / print auth snippets (mcp)
- `--async`: submit retain asynchronously to Hindsight
- `--judge <id>`: `off`, `heuristic` (default), or `jev` (hosted TypeSafe, optional; needs `ORTO_TYPESAFE_API_KEY`) on seed / store / prune
- `--confidence <n>`: minimum confidence to apply a Jev decision (default `0.8`; see [jev.md](./jev.md))
- `--strict`: with `--judge jev`, fail on TypeSafe network/API errors instead of falling back to heuristics

## Config and generated files

Version-controlled (commit these):

```text
.orto/
  config.json                 # project name, bankId, provider, optional deploymentProfile + hindsightBaseUrl + docker
  share.json                  # deployment profile + non-secret base URL (commit)
  hindsight/
    bank-template.json        # importable Hindsight bank template (version "1")
```

Local / gitignored state (do **not** commit secrets or machine-local seed state):

```text
.orto/
  local/
    seed-manifest.json        # content hashes + fact ids for incremental seed
    tombstones.json           # pruned document ids so seed/store skip unchanged re-retain
  cache/
```

`config.json` keeps `root: "."` (portable). Bank id defaults to a slug of the project name (directory name), never hardcoded to `orto`.

Optional config fields:

- `deploymentProfile`: `local` / `lan` / `vpn` / `public` / `hindsight-cloud` (also in `share.json`)
- `hindsightBaseUrl`: default Hindsight server for this project (still overridable by env/CLI/share)
- `docker.containerName` / `docker.volumeName`: local Docker helper defaults (shared server; not 1:1 with `bankId`)

**Never** put API keys in version-controlled config. Use env vars or `--api-key`.

## Environment variables and shell one-liners

### Resolution order

**Base URL**

1. `--hindsight-url`
2. `hindsightBaseUrl` in `.orto/config.json`
3. `ORTO_HINDSIGHT_URL` or `HINDSIGHT_URL`
4. Default: `http://localhost:8888`

**API key**

1. `--api-key`
2. `ORTO_HINDSIGHT_API_KEY` or `HINDSIGHT_API_KEY`
3. Omit header if unset (fine for unauthenticated local servers)

Live retain sends `Authorization: Bearer <key>` when a key is present.

### Prefixed env assignment

```bash
ORTO_HINDSIGHT_API_KEY=your-real-key node dist/cli.js seed
```

This is **shell** syntax, not a Node-specific feature:

1. The shell sets `ORTO_HINDSIGHT_API_KEY` only for the following process.
2. `node dist/cli.js seed` inherits that environment.
3. When the process exits, your interactive shell is unchanged (unless you previously `export`ed the variable).

Equivalents:

```bash
# persistent for the current shell session
export ORTO_HINDSIGHT_API_KEY=your-real-key
node dist/cli.js seed

# flag instead of env
node dist/cli.js seed --api-key your-real-key

# dry-run never needs a key
node dist/cli.js seed --dry-run
```

If Hindsight returns `401`/`403`, the CLI hints that an API key may be required.

## Scanner: what counts as durable

Conservative first pass looks for:

- `README.md`
- Markdown under `docs/`, `doc/`, `documentation/`
- ADR paths (`adr/`, `docs/adr/`, `docs/decisions/`, root `ADR*.md`, etc.)

`AGENTS.md` is **not** scanned for seed or store. It is agent harness wiring (integration emission via `orto mcp --write-agents`), not bank seed material.

Optional `.orto/config.json` `scanner` policy:

- `include`: when non-empty, replaces the default walk. `seed` bootstraps from that set. `store` discovers the same set, and `store.allowlist` still gates which new files are retained.
- `exclude`: globs removed from either the default walk or `include` (directory trees, or draft names such as `**/_*.mdx`).
- `extensions`: suffixes to accept. Default `.md` and `.markdown`. List `.mdx` to treat MDX as a durable source. The extractor drops leading YAML frontmatter before section scoring.

The secrets denylist still wins over `include`.

Ephemeral chat logs, lockfiles, and generated noise are out of scope for seeding.

Sensitive paths are denied before extract/seed (`src/scanner/sensitive.ts`). Full policy and roadmap for ignore files / wizards: [sensitive-data.md](./sensitive-data.md).

Summary:

- `.env`, `.env.*`, credential/secret JSON/YAML, `*.pem` / `*.key`, SSH/AWS/kube dirs
- `secrets/` / `credentials/` trees
- Docs named like `credentials.md`, `api-keys.md`, `secrets.md`

Defense in depth: even if a future scanner widens file types, these paths stay excluded.

## Extractor: how candidates are chosen

The extractor is **heuristic**, not an LLM:

- Splits markdown on `#` / `##` / `###` headings (skips fenced code blocks so shell comments are not treated as headings)
- Drops a leading YAML frontmatter block (`---` ... `---`) before scoring, so MDX collection fields are not retained
- Scores sections with keyword signals (decision, architecture, standard, domain, overview, …)
- Drops noisy headings (install, quick start, contributing, license, changelog, …)
- Keeps **whole** ADR files as single high-value documents
- Attaches provenance: source path, source kind, optional git commit (`git rev-parse HEAD`)

Each candidate gets a stable id used as Hindsight `document_id`, e.g. `orto:README.md#core-principles`. Re-retaining the same id upserts in Hindsight.

## Seeder and incremental re-seed

1. Hash each source file (`sha256`).
2. Compare to `.orto/local/seed-manifest.json`.
3. Unchanged sources are skipped unless `--force`.
4. Live seed maps candidates → retain items (`content`, `context`, `document_id`, `timestamp: "unset"`, metadata, tags).
5. On success, rewrite the manifest with new hashes and fact ids.

Synchronous retain (default) prints a clear warning not to close the terminal or press Ctrl+C, then retains **one item at a time** with `[i/N] percent` progress. Hindsight LLM extraction often takes several seconds per item, so a full first seed can take minutes: that is expected, not a hang.

Use `--async` to submit the batch and have Orto **poll** `GET /v1/default/banks/{bank}/operations/{id}` for Hindsight’s own `progress.processed` / `progress.total` (when the server reports them). Do **not** scrape Docker container logs for progress: that is fragile and environment-specific; the operations API is the supported channel.

`--dry-run` still shows what **would** be retained (and what would be skipped as unchanged).

## Store: ongoing selected retain

`seed` bootstraps from a default scan. `store` (`src/commands/store.ts`) is the ongoing follow-up once durable project `.md` already exists on disk: an operator picks which files to retain, previewed first. It never reimplements retain: it filters `prepareSeed`'s discovered sources down to a selected subset (`only: Set<relativePath>`) and calls the same `retainPreparedItems` loop `seed` uses (extracted into `src/commands/seed.ts` and shared), then writes the same `.orto/local/seed-manifest.json`.

Flow: `store` resolves the project root (refusing a disposable git worktree via `src/project/worktree.ts`, walking out to the durable clone via `src/project/registry.ts` when possible), reads `store.allowlist` from `.orto/config.json`, scans with `src/scanner/durable-sources.ts`, and classifies each result into four buckets against the allowlist and the seed manifest's content hashes:

- **known**: allowlisted and found on disk (changed + unchanged)
- **new**: found on disk but not yet allowlisted (never stored implicitly)
- **changed**: known, content hash differs from the manifest
- **unchanged**: known, content hash matches (skipped)

`--files` and `--add-files` both persist onto `store.allowlist`; `--add-files` never retains. `--yes` stores changed known files only and prints skipped new files. Interactively (TTY, no `--yes`/`--files`), `store` multi-selects new files via `src/utils/prompt.ts`'s `promptMultiSelect`, and always includes changed known files by default. `src/scanner/store-policy.ts` adds a stricter denylist on top of `sensitive.ts`: non-markdown paths, paths outside the project root, `.backpass/`, and Firstmate's `.stow-archive.md` / `.stow-notes.md` disk-pref files (allowed only via explicit `--files`).

## Prune: bank hygiene

`seed` and `store` only add or upsert.
`orto prune` (`src/commands/prune.ts`) removes bank documents that are no longer backed by durable sources, or that the operator names explicitly.

Flow:

1. List bank documents via `HindsightClient.listAllDocuments` (`GET .../documents`, paginated).
2. Build a plan in `src/seeder/prune-plan.ts`: path-gone, section-gone, or explicit (`--source` / `--document-id`).
3. `--dry-run` prints groups only (list is read-only; no deletes, no tombstones).
4. TTY multi-select + confirm, or non-interactive `--document-id` / `--source` with `--yes`.
5. `DELETE .../documents/{documentId}` for each selected id; write `.orto/local/tombstones.json`.
6. Later `prepareSeed` skips tombstoned unchanged facts; `--force` or a content hash change can retain again.

Day-to-day order: retain (`store` / `seed`), then prune.
Details: [orto-cli-commands.md](./orto-cli-commands.md#orto-prune).

## Hindsight integration

| Concern | Implementation |
|---------|----------------|
| Bank template | `src/providers/hindsight/template.ts` → `.orto/hindsight/bank-template.json` |
| Retain API | `POST {baseUrl}/v1/default/banks/{bankId}/memories` |
| List documents | `GET {baseUrl}/v1/default/banks/{bankId}/documents` |
| Delete document | `DELETE {baseUrl}/v1/default/banks/{bankId}/documents/{documentId}` |
| Client | `src/providers/hindsight/client.ts` |
| Timeless docs | `timestamp: "unset"` so reference docs are not treated as events |

Import the generated template into Hindsight (Control Plane or import API) before or alongside seeding so mission/directives match the project.

## Local Docker helper

`orto docker` wraps the official Hindsight image (`ghcr.io/vectorize-io/hindsight:latest` for `up`; **pinned tags** for `upgrade`):

| Action | Behavior |
|--------|----------|
| `print` (default) | Print the `docker run` command (no execute) |
| `up` / `start` | Start detached container (`--dry-run` to preview) |
| `down` / `stop` | `docker rm -f` the container |
| `status` | Show container status + API/UI URLs |
| `upgrade --to <ver>` | Back up all banks, recreate container on the same volume with preserved env, validate `/version` + fact counts |

Defaults: container `hindsight`, API `8888`, UI `9999`, volume `hindsight-data`. Resolution for container/volume: `--name` → `docker` in `.orto/config.json` → those defaults. One container is a Hindsight **server** that can host many banks: do not treat container name as the bank id. LLM key from `--llm-api-key` or `OPENAI_API_KEY` / `HINDSIGHT_API_LLM_API_KEY`. Optional `--api-key` enables tenant auth (`HINDSIGHT_API_TENANT_API_KEY` + matching CP dataplane key).

`upgrade` is a different operation from `up`: it inspects the running container, never deletes the data volume, and refuses `:latest`. See [hindsight-upgrade.md](./hindsight-upgrade.md).

## Agent integration (MCP)

`src/integration/` emits single-bank MCP URLs: `{baseUrl}/mcp/{bankId}/`.

| Command | Behavior |
|---------|----------|
| `orto mcp` | Print Cursor, Claude Code, Claude Desktop, Roo, Codex, Kiro snippets |
| `orto mcp --write` | Merge `.cursor/mcp.json` |
| `orto mcp --write-roo` / `--write-kiro` | Project Roo / Kiro MCP JSON |
| `orto mcp --write-agents` | Idempotent AGENTS.md section (HTML comment markers) |
| `orto mcp --write-cursor-rules` | `.cursor/rules/hindsight-bank.mdc` (`alwaysApply`) |
| `orto mcp --harness firstmate --write-firstmate` | Install Firstmate's on-demand `project-bank` skill under `$FM_HOME/.agents/skills/project-bank/` and record this project's bank in `$FM_HOME/.orto/projects.json` (prints install steps when `$FM_HOME` is unset; never writes into this repo) |
| `--dry-run` | Preview writes without mutating |
| `--include-auth` | Add Authorization headers (env placeholders on write) |

Harness filter: `--harness cursor,claude-code`.

`src/project/registry.ts` owns the captain-home registry (`$FM_HOME/.orto/projects.json`, fallback `~/.orto/projects.json`): the same file `store` reads to walk out of a disposable worktree to its durable clone. `src/integration/project-bank-skill.ts` owns the skill content and the write; a checked-in copy for manual install lives at [docs/firstmate/project-bank/SKILL.md](./firstmate/project-bank/SKILL.md).

## Development tips

```bash
pnpm install
pnpm build          # tsup → dist/cli.js
pnpm test           # vitest
pnpm typecheck      # tsc --noEmit
node dist/cli.js --help
```

- Prefer unit tests for pure modules (extractor, template, client with mocked `fetch`).
- Errors should tell the user the next concrete action (`OrtoError` + hint).
- Support `--dry-run` on mutating / network commands.
- Strict TypeScript; avoid `any`.

## Current gaps (intentional)

- Extraction is conservative keyword heuristics, not ML
- Single provider path: Hindsight first
- Single bank per project config (multi-bank CLI is later; one Docker server can already host many banks)
- Optional Jev judgment layer (Phase 7): seed relevance gate, knowledge-kind taxonomy, the contradiction check, the secret / personal-data second pass, and citation support are shipped. Prune annotation is not wired yet

## Related docs

- [README](../README.md): product overview and quick start
- [Developer workflow](./dev-workflow.md): build, first seed, re-seed, retain vs consolidation
- [Developer testing](./dev-testing.md): end-user command sequence and E2E regression checklist
- [Team sharing](./team-sharing.md): deployment profiles and team bootstrap (user guide)
- [Phase 4 dogfood gaps](./phase-4-dogfood-gaps.md): Strumentario multi-repo / template apply / shareable config lessons
- [Phase 5 dogfood gaps](./phase-5-dogfood-gaps.md): zanuka-web `store` ops path; bank-doc list/delete parity
- [Sensitive data](./sensitive-data.md): allowlist/denylist so secrets and noise stay out of banks
- [AGENTS.md](../AGENTS.md): principles for humans and agents
- [ROADMAP.md](../ROADMAP.md): phased plan
- [CONTRIBUTING.md](../CONTRIBUTING.md): PR / setup conventions
- [Hindsight retain docs](https://hindsight.vectorize.io/developer/api/retain)
- [Hindsight bank templates](https://hindsight.vectorize.io/developer/api/bank-templates)
