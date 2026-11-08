# Orto CLI commands

Reference for the `orto` command surface.
Flags and behavior match `src/cli.ts`.
Run `orto --help` or `orto <command> --help` for the live list.

Related: [README](../README.md), [CLI architecture](./cli-architecture.md), [developer workflow](./dev-workflow.md), [sync strategy](./orto-sync-strategy.md).

---

## Happy path

```bash
orto init
orto configure
orto bank apply --dry-run
orto bank apply
orto seed --dry-run
orto seed
orto store --dry-run
orto store --yes
orto prune --dry-run
orto share --profile local
orto mcp --write --write-agents --write-cursor-rules --include-auth
```

### Day-to-day bank hygiene

Prefer **retain, then prune**:

1. Edit durable docs (if needed).
2. `orto store --dry-run`, then `orto store` (or `seed` when bootstrapping).
3. `orto prune --dry-run`, then prune what is still orphaned.

`store` and `seed` only add or upsert.
They do not remove old `document_id`s.
Pruning after retain means candidates are “still stale relative to today’s extract.”
Pruning first can delete an id you were about to bring back on the next retain (for example a restored heading).

Local Hindsight (optional Docker helper):

```bash
orto docker print
orto docker up
orto docker status
orto docker upgrade --to <version> --dry-run
orto docker down
```

Mutating or network commands support `--dry-run` where practical.
`seed --dry-run` previews candidates and does not retain or write the seed manifest.
With `--judge jev` it may recall up to 5 observation summaries and preview extracted facts (both read-only).
Without that flag it does not call Hindsight.
`prune --dry-run` lists bank candidates (read-only list) and never deletes or writes tombstones.

---

## Global

| Command | Description |
|---------|-------------|
| `orto --help` | Top-level help |
| `orto --version` | Package version |

Hindsight connection (for `seed`, `store`, `prune`, `mcp`, `docker upgrade`):

| Source | URL | API key |
|--------|-----|---------|
| CLI flag | `--hindsight-url` | `--api-key` |
| Config | `hindsightBaseUrl` in `.orto/config.json` | (not stored) |
| Env | `ORTO_HINDSIGHT_URL` / `HINDSIGHT_URL` | `ORTO_HINDSIGHT_API_KEY` / `HINDSIGHT_API_KEY` |
| Default | `http://localhost:8888` | none |

Resolve order: CLI flag → config (URL only) → env → default.
Never commit API keys.

---

## `orto init`

Detect the project root and scaffold `.orto/` (config plus layout).

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be written without creating files |
| `--force` | Overwrite an existing `.orto/config.json` |
| `--name <name>` | Project name (defaults to directory name) |
| `--bank-id <id>` | Hindsight bank id (defaults to a slug of the project name) |
| `--container-name <name>` | Local Hindsight Docker container name (default: `hindsight`) |
| `-y, --yes` | Accept defaults without interactive prompts |

In a TTY, `init` prompts for bank id and Docker container name unless flags or `--yes` skip prompts.
Bank id is project-specific.
Container name is shared: one Hindsight container can host many banks.

---

## `orto configure`

Generate a Hindsight bank template under `.orto/hindsight/`.
In a TTY, prompts for starter mental models, tagging mode, and refresh policy unless `--yes` or flags skip prompts.

| Flag | Description |
|------|-------------|
| `--dry-run` | Print the template without writing files |
| `--force` | Overwrite an existing bank template |
| `-y, --yes` | Accept starter defaults without interactive prompts |
| `--models <ids>` | Comma-separated starter ids (`project-context`, `architecture-decisions`, `coding-standards`) |
| `--tagging-mode <mode>` | `topic-scoped` (default), `project-wide`, or `custom` |
| `--refresh-policy <policy>` | `differentiated` (default), `auto`, or `manual` |
| `--apply` | Apply the existing (or newly written) template to Hindsight |
| `--hindsight-url <url>` | Override Hindsight base URL when using `--apply` |
| `--api-key <key>` | API key when using `--apply` |

The template holds mission, directives, mental models, and extraction policy.
It is separate from project content retained by `seed`.
Prefer `orto bank apply` when you only want to apply an existing template.
See [mental-models.md](./mental-models.md) (user guide) and [hindsight-mental-models.md](./hindsight-mental-models.md) (design).

---

## `orto bank apply`

Create or update the Hindsight bank from `.orto/hindsight/bank-template.json`.
Idempotent for bank profile/config, directives (matched by name), and declared mental models (matched by stable `id`).

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview apply steps without mutating Hindsight |
| `--hindsight-url <url>` | Override Hindsight base URL |
| `--api-key <key>` | Hindsight API key (required for Cloud) |

Mental-model create may start an async reflect; refresh again after `seed` if the bank was empty.

---

## `orto share`

Generate or validate a deployment profile share artifact (`.orto/share.json`).
Portable project identity stays in `config.json`; host strategy lives in the share profile (no secrets).

| Flag | Description |
|------|-------------|
| `--profile <name>` | `local`, `lan`, `vpn`, `public`, or `hindsight-cloud` |
| `--base-url <url>` | Non-secret base URL (required for `lan` / `vpn` / `public`) |
| `--mcp-auth <mode>` | Cloud MCP mode: `api-key` (default) or `oauth` |
| `--validate` | Validate the active profile without writing |
| `--dry-run` | Preview `share.json` / `deploymentProfile` updates |

Prints security defaults and trade-offs for the chosen profile.
Cloud skips local Docker; see [hindsight-cloud.md](./hindsight-cloud.md).

---

## `orto docs list`

Thin bank inventory helper for scripts when `prune --dry-run` grouping is too heavy.
Delete remains on `orto prune --document-id <id> --yes`.

| Flag | Description |
|------|-------------|
| `--json` | Machine-readable JSON |
| `--limit <n>` | Cap printed rows (API still pages) |
| `--hindsight-url <url>` | Override Hindsight base URL |
| `--api-key <key>` | Hindsight API key |

---

## `orto seed`

Scan durable sources, extract high-signal candidates, and retain them into the configured bank.

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview candidates without retaining or writing the seed manifest. With `--judge jev`, may recall up to 5 observation summaries and preview extracted facts (both read-only) |
| `--force` | Re-seed even when source content hashes are unchanged |
| `--refresh-mental-models` | After retain, refresh declared mental models (opt-in; may overlap `refresh_after_consolidation`) |
| `--hindsight-url <url>` | Override Hindsight base URL |
| `--api-key <key>` | Hindsight API key (or set env vars above) |
| `--async` | Submit retain asynchronously to Hindsight |
| `--judge <id>` | `off`, `heuristic` (default), or `jev` (hosted TypeSafe, optional; needs `ORTO_TYPESAFE_API_KEY`) |
| `--confidence <n>` | Minimum confidence to apply a Jev decision (default `0.8`; see [jev.md](./jev.md)) |
| `--budget <n>` | With `--judge jev`, retain the top N ranked candidates this run. The rest stay pending. Dry-run prints the queue and a cutoff |
| `--strict` | With `--judge jev`, fail on TypeSafe errors instead of falling back to heuristics |

`--judge jev` runs the relevance gate once per section (`orto:<path>#<section>`).
The dry-run prints `document_id`, path, heading, decisions, score, confidence, knowledge kind, probabilities, relation, and heuristic-vs-jev.
It does not retain.
`--budget N` prints that retain queue in priority order and marks the cutoff.
Only the top N are retained on a live seed.
The rest stay pending in the seed manifest.
With `--judge jev` it may recall up to 5 observation summaries and preview extracted facts (both read-only).
One file can mix retain and skip.
Headings the heuristic would drop are judged only when this flag is on.
A confident reject is left out of retain.
That includes a confident `noise` kind and a confident `style_pref` (personal taste stays out of the company bank).
A score or kind below `--confidence` is listed as review and is not retained.
`contains_secret` and `contains_pii` run on the same call.
A high score means unsafe.
A confident secret is skipped, and the stderr warning names the path without printing the secret.
A confident personal-data answer is skipped.
A mid-range score stays in review and is not retained.
An `sk-` token or PEM block in an otherwise seedable ADR is skipped before the TypeSafe call.
After that gate, Hindsight previews the facts it would extract from each section still going to be retained.
One Jev call covers every fact from that section.
A high-confidence `unsupported` answer is not retained.
A quote of the section is kept.
Retain sends the kept fact text.
If the preview returns no facts, or the preview fails, the section is retained as written.
Retained sections receive the stable tags for that kind (`knowledge:<kind>`).
A confident `supersedes` or `contradicts` relation keeps that one retain and records the old observation id.
`supports`, `extends`, and `unrelated` do not add another retain item.
The old observation is not deleted.
`document_id` stays `orto:<path>#<section>`.
Omit the flag to keep heuristics only.
Incremental state lives in `.orto/local/seed-manifest.json` (gitignored).
Stable `document_id`s upsert on re-seed.
When `.orto/config.json` has `scanner.include`, that glob set replaces the default README / docs / ADR walk for this command and for `store`. `scanner.exclude` and `scanner.extensions` apply either way. Omit `scanner` to keep the default. Secrets paths stay denied.
See [sync strategy](./orto-sync-strategy.md) and [knowledge-base configs](./orto-configs.md).

---

## `orto mental-model`

Post-seed lifecycle for Hindsight mental models on the configured bank.

| Subcommand | Description |
|------------|-------------|
| `list` | List models (`--detail metadata\|content\|full`) |
| `get <id>` | Fetch one model |
| `create` | Create with `--name` and `--source-query` (optional `--id`, tags, trigger) |
| `update <id>` | Patch name, query, tags, trigger |
| `refresh [id]` | Refresh one id, or `--all` declared template models |
| `clear <id>` | Clear content so the next refresh is a full re-synthesis |
| `tags` | List tags (`--source memories\|mental_models`) |

Mutating paths support `--dry-run`. Refresh dry-run uses Hindsight `dry-run-refresh` when available.
`--save-template` writes create/update declarations back into `bank-template.json`.
See [mental-models.md](./mental-models.md).

---

## `orto store`

Retain operator-selected durable markdown into the configured bank, on an ongoing basis after durable project docs already exist on disk. `seed` bootstraps from the scanner set (default walk, or `scanner.include` when set); `store` is the incremental follow-up: preview first, and new files are never stored implicitly. It reuses `seed`'s retain path exactly (same `document_id` upserts, same seed manifest, same client, auth, and progress reporting): no second retain implementation.

| Flag | Description |
|------|-------------|
| `--dry-run` | Print `known` / `new` / `changed` / `unchanged` bucket counts (zeros explicit) and suggested next commands; no API calls |
| `--force` | Re-store selected sources even when their content hash is unchanged |
| `--async` | Submit retain asynchronously to Hindsight |
| `-y, --yes` | Store changed known files only; print and skip new files rather than adopting them |
| `--files <list>` | Comma-separated paths to store exactly (must pass the scanner/denylist); persists them onto `store.allowlist` |
| `--add-files <list>` | Comma-separated paths to add to `store.allowlist` only; never retains |
| `--propose-adopt` | With `--judge jev`, print new durable files that belong on the allowlist. Does not retain or change the allowlist |
| `--apply` | With `--propose-adopt`, write the proposed paths onto `store.allowlist`. Does not retain |
| `--project <path>` | Project root (default: cwd, walking out of a disposable git worktree to the durable clone) |
| `--hindsight-url <url>` | Override Hindsight base URL |
| `--api-key <key>` | Hindsight API key (or set env vars above) |
| `--judge <id>` | `off`, `heuristic` (default), or `jev` (hosted TypeSafe, optional) |
| `--confidence <n>` | Minimum confidence to apply a Jev decision (default `0.8`) |
| `--strict` | With `--judge jev`, fail on TypeSafe errors instead of falling back to heuristics |

Selection when neither `--yes` nor `--files` is given: in an interactive terminal, `store` prompts a multi-select over new files (changed known files are included by default); otherwise it behaves like `--yes` and never silently adopts new files.

`--propose-adopt --judge jev` does not use that selection.
It prints new durable files Jev would add to the allowlist.
A dependency readme and other non-durable markdown are not proposed.
`--apply` writes the proposed paths and does not retain.
`--dry-run` with `--apply` prints the paths and does not write the allowlist.

`--judge jev` on a normal store also runs the edit durability gate on changed allowlisted files.
A wording-only edit skips retain and still updates the content hash so the same change does not loop.
A temporary workaround stays in review and is not retained.
A real claim change re-retains.
Without `--judge jev`, store is unchanged.

The allowlist is `store.allowlist` in `.orto/config.json` (version-controlled). The first `store` after a `seed` bootstraps it from `.orto/local/seed-manifest.json`'s sources, so already-seeded files read as known, not new. Content hashes for incremental skip live in the same seed manifest `store` reuses.

`store` refuses to run from a disposable git worktree (detected via `git rev-parse --git-dir` vs. `--git-common-dir`, not path naming): it only operates on the durable clone that owns `.orto/`. From a worktree it resolves the durable clone through the captain-home registry (`$FM_HOME/.orto/projects.json`, fallback `~/.orto/projects.json`, installed by `orto mcp --harness firstmate --write-firstmate`), or via an explicit `--project <durable-clone-path>`.

Denylist (in addition to the seed scanner's secrets/credentials rules): `.stow-archive.md`, `.stow-notes.md` unless passed explicitly via `--files`, `.backpass/` paths, files that are not `.md`, `.markdown`, or `.mdx`, paths the scanner did not select, and any path outside the project root. `--files` of an MDX case study works once `scanner.include` and `scanner.extensions` select it.

---

## `orto prune`

Remove bank documents that are no longer backed by durable sources, or that you name explicitly.
`seed` and `store` only add or upsert, so a deleted doc, a renamed path, or a removed section stays in the bank until you prune.

For day-to-day use, retain first (`store` or `seed`), then prune.
See [Day-to-day bank hygiene](#day-to-day-bank-hygiene).

```bash
orto store --dry-run
orto store --yes
orto prune --dry-run
orto prune
orto prune --document-id 'docs/dev/foo.md' --yes
orto prune --source docs/dev/foo.md --yes
orto prune --document-id 'orto:docs/dev/foo.md#some-section' --yes
```

### Candidate groups (v1)

| Group | Meaning |
|-------|---------|
| Source path gone | Bank doc / section whose source file is no longer on disk |
| Section gone | Source still exists, but extraction no longer emits that `orto:<path>#<section>` id |
| Explicit | `--source` / `--document-id` supplied by the operator |

Legacy bare path ids (for example `docs/foo.md`) that still exist on disk are **not** auto-candidates.
Use `--document-id` or `--source` to retire them after section coverage.
Do not treat all `orto:` ids as stale merely because they are not bare paths.

### Safety

- `--dry-run` lists groups with stable `document_id`s and provenance. It may call Hindsight list APIs. It never deletes or writes tombstones.
- Non-interactive runs require `--source` or `--document-id` plus `--yes`.
- TTY runs multi-select candidates, then confirm before delete.
- Apply deletes the chosen documents (and linked memories) via Hindsight `DELETE .../documents/{document_id}`.
- Apply writes `.orto/local/tombstones.json` so an unchanged source is not re-retained on the next `seed` or `store`.
- A later edit, or `--force` on `seed` / `store`, can retain again (and clears matching tombstones after a successful retain).
- Mental-model refresh may be recommended in the output. It is a separate confirmation (not auto-run).
- Optional `--judge jev` prune annotation (outdated / irrelevant / contradicted scoring) is not wired yet. The judge port and flags exist; path-gone and section-gone work with no TypeSafe key.

| Flag | Description |
|------|-------------|
| `--dry-run` | Print the groups. Do not delete. |
| `--source <path>` | Limit the selection to bank documents for this repo path |
| `--document-id <id>` | Limit the selection to this Hindsight `document_id` |
| `-y, --yes` | Apply an explicit `--source` or `--document-id` selection without a second prompt. Refused when nothing is selected. |
| `--hindsight-url <url>` | Override Hindsight base URL |
| `--api-key <key>` | Hindsight API key (or set env vars above) |
| `--judge <id>` | `off`, `heuristic` (default), or `jev` (hosted TypeSafe, optional) |
| `--confidence <n>` | Minimum confidence to apply a Jev decision (default `0.8`) |
| `--strict` | With `--judge jev`, fail on TypeSafe errors instead of falling back to heuristics |

### Retiring a custom seeder

When a project still has a legacy path-id seeder alongside Orto section ids:

1. Keep day-to-day retain on `orto store` (allowlist-gated).
2. After store covers the current sections, run `orto prune --dry-run` and review path-gone / section-gone groups.
3. Retire stale path ids **per file** with `--document-id` or `--source` plus `--yes` after section coverage and a recall smoke check.
4. Do not mass-wipe path ids, and do not prune with a `orto:` prefix as if those ids were bare paths on disk.

`orto docs list` covers flat inventory for scripts. Explicit prune covers selective delete.

Design (optional Jev annotation later): [Jev integration](./jev-integration.md).
Tracked in [Phase 5 dogfood gaps](./phase-5-dogfood-gaps.md).

---

## `orto mcp`

Emit MCP and agent wiring for the project bank.
By default prints snippets.
It does not detect your IDE: use write flags for the files you want.
Default MCP server name is bank-scoped (`hindsight-<bankId>`) so multi-root workspaces can attach multiple banks.
Emission follows the active deployment profile from `orto share` / `config.deploymentProfile`.

| Flag | Description |
|------|-------------|
| `--harness <list>` | Limit output: `cursor`, `claude-code`, `claude-desktop`, `roo`, `codex`, `kiro`, `firstmate`, or `all` (comma-separated) |
| `--write` | Write/merge project `.cursor/mcp.json` |
| `--write-roo` | Write/merge project `.roo/mcp.json` |
| `--write-kiro` | Write/merge project `.kiro/settings/mcp.json` |
| `--write-agents` | Upsert an `AGENTS.md` section telling agents to prefer the project bank |
| `--write-cursor-rules` | Write `.cursor/rules/hindsight-bank.mdc` (`alwaysApply: true`) |
| `--write-firstmate` | Install the `project-bank` skill under `$FM_HOME/.agents/skills/project-bank/` and record this project's `bankId` + `hindsightBaseUrl` in `$FM_HOME/.orto/projects.json` (fallback `~/.orto/projects.json`); prints install steps instead of writing when `$FM_HOME` is unset |
| `--dry-run` | Preview writes without touching the filesystem (requires at least one `--write*` flag) |
| `--force` | Overwrite an existing bank-scoped MCP entry, Cursor rule file, or `project-bank` skill |
| `--hindsight-url <url>` | Override Hindsight base URL for the MCP endpoint |
| `--server-name <name>` | Override MCP server name (default: `hindsight-<bankId>`) |
| `--check` | Probe the MCP endpoint with resolved auth (never prints secrets) |
| `--include-auth` | Add `Authorization` headers; written files use env placeholders |
| `--api-key <key>` | Include this key literally in printed snippets only; file writes still use env placeholders |

Single-bank MCP URL shape: `{base}/mcp/<bankId>/` (Cloud: `https://api.hindsight.vectorize.io/mcp/<bankId>/`).

Cursor must see `ORTO_HINDSIGHT_API_KEY` / `HINDSIGHT_API_KEY` in the **Cursor process** environment (login shell / desktop env), not only an integrated terminal.

`--harness firstmate` still prints a `cd` into the Firstmate home followed by a `claude mcp add --transport http …` command wired to this project's single-bank Hindsight URL. The wiring itself stays captain-only (do not wire scouts or ships) and is never written into this product repo. `--write-firstmate` adds one more write path alongside that: the on-demand `project-bank` skill (see [Firstmate `project-bank` skill](../docs/firstmate/project-bank/SKILL.md)), plus the project-to-bank map Firstmate reads before a crewmate spawn. That skill is on-demand, not an always-on persona, and a crewmate that reads its bank card recalls from Hindsight only: it does not seed or store.

Once wired, agents use Hindsight MCP tools such as `recall`, `reflect`, and `retain`.
See the [Hindsight MCP tools](../README.md#hindsight-mcp-tools-any-agent) section in the README.

---

## `orto docker`

Local Hindsight Docker helper.
Actions: `up` / `start`, `down` / `stop`, `status`, `print` (default: `print`).

| Flag | Description |
|------|-------------|
| `--dry-run` | Print the docker command without executing |
| `--name <name>` | Container name (default: `config.docker.containerName`, or `hindsight`) |
| `--api-port <port>` | Host port for Hindsight API (default: `8888`) |
| `--ui-port <port>` | Host port for Control Plane UI (default: `9999`) |
| `--image <image>` | Docker image (default: `ghcr.io/vectorize-io/hindsight:latest`) |
| `--llm-api-key <key>` | LLM provider API key (or `OPENAI_API_KEY` / `HINDSIGHT_API_LLM_API_KEY`) |
| `--llm-provider <name>` | `HINDSIGHT_API_LLM_PROVIDER` (`openai`, `anthropic`, `ollama`, …) |
| `--api-key <key>` | Enable tenant API auth on the container (`HINDSIGHT_API_TENANT_API_KEY`) |
| `--no-pull` | Do not pass `--pull always` |
| `--no-detach` | Run attached (`-it`) instead of `-d` |

`status` looks for the container name in config.
If Hindsight already runs under a different name, pass `--name` or update `docker.containerName`.
Do not run `docker up` if ports `8888` / `9999` are already bound.

---

## `orto docker upgrade`

Upgrade the local Hindsight Docker image to a pinned tag.
Backs up all banks, recreates the container on the same data volume, then verifies `/version` and bank fact counts.

| Flag | Description |
|------|-------------|
| `--to <version>` | Target image tag (required; pinned, e.g. `0.9.2`). `:latest` is refused |
| `--dry-run` | Print backup + pull + recreate plan without mutating |
| `--backup-dir <path>` | Backup directory (default under `~/hindsight-bank-backups/`) |
| `--skip-backup` | Skip backups (dangerous; loud warning; default off) |
| `--force` | Recreate even when `api_version` already matches `--to` |
| `--all-banks` | Back up and validate every bank on the instance (default: on) |
| `--bank <id>` | Emphasize this project bank in backup notes (default: config `bankId`) |
| `-y, --yes` | Skip TTY confirmation prompts |
| `--hindsight-url <url>` | Hindsight base URL |
| `--api-key <key>` | Hindsight API key |
| `--name <name>` | Container name |

Full procedure: [hindsight-upgrade.md](./hindsight-upgrade.md).

---

## See also

- [Sync strategy](./orto-sync-strategy.md): curated retain vs file upload
- [Knowledge-base configs](./orto-configs.md): `.orto/` layout and seed manifest
- [Team sharing](./team-sharing.md): deployment profiles, share artifact, bank apply, multi-repo MCP
- [Sensitive data](./sensitive-data.md): what the scanner denies before retain
- [Jev integration](./jev-integration.md): planned judge, including optional `--judge jev` on prune
- [Hindsight Cloud](./hindsight-cloud.md): managed hosting instead of local Docker
