# Orto knowledge-base configs

Orto turns durable project docs into a [Hindsight](https://hindsight.vectorize.io) memory bank that coding agents can **recall** and **reflect** against over MCP.

The configs under `.orto/` are the version-controlled (and machine-local) knobs for that bank. They are not a dump of the repo into a vector store. They name the bank, shape how it extracts and answers, track what was already seeded, and point agent harnesses at the right MCP endpoint.

| Layer | Role |
|-------|------|
| **Docs in git** | Source of truth (README, ADRs, architecture notes, …); `AGENTS.md` is harness wiring |
| **`.orto/`** | Project identity, bank template, incremental seed state |
| **Hindsight bank** | Structured memories agents query via MCP |
| **Agent wiring** | MCP URL + rules / AGENTS snippets that steer agents to `recall` / `reflect` |

Docs stay authoritative. The bank is the agent-facing index of those docs: with provenance: so sessions start warm instead of re-reading the whole tree.

---

## What’s under `.orto/`

```text
.orto/
  config.json                 # project identity + bank id + optional deploymentProfile (commit)
  share.json                  # deployment profile + non-secret base URL strategy (commit)
  hindsight/
    bank-template.json        # Hindsight mission / directives / mental models (commit)
  local/
    seed-manifest.json        # incremental seed / store state (gitignored; machine-local)
    tombstones.json           # pruned document ids (gitignored; machine-local)
```

Related agent wiring lives **outside** `.orto/` and is emitted by `orto mcp`:

| Path | Purpose |
|------|---------|
| `.cursor/mcp.json` | Cursor MCP entry for the project bank |
| `.cursor/rules/hindsight-bank.mdc` | Always-on rule: prefer bank recall for durable questions |
| `AGENTS.md` section between `<!-- orto:hindsight-bank -->` markers | Same preference for non-Cursor agents |

**Commit:** `config.json`, `hindsight/bank-template.json`, and the MCP / AGENTS / Cursor rule wiring you want teammates to inherit.

**Do not commit:** `.orto/local/` (seed manifest, tombstones), API keys, or anything under secrets / credential paths. See [sensitive-data.md](./sensitive-data.md).

---

## `config.json`

Written by `orto init`. Portable project identity for this repo.

```json
{
  "version": 1,
  "name": "orto",
  "provider": "hindsight",
  "bankId": "orto",
  "root": ".",
  "docker": {
    "containerName": "hindsight",
    "volumeName": "hindsight-data"
  }
}
```

| Field | Meaning |
|-------|---------|
| `bankId` | Hindsight bank name: **project-specific**. Many banks can share one server. |
| `provider` | Memory backend (`hindsight` today). |
| `root` | Project root relative to config (usually `"."`). |
| `deploymentProfile` | Optional share profile hint: `local` (default), `lan`, `vpn`, `public`, `hindsight-cloud`. |
| `docker.containerName` / `volumeName` | Which **local Docker server** hosts banks: not 1:1 with `bankId`. Skip under Cloud. |
| `hindsightBaseUrl` | Optional default Hindsight URL (still overridable by env / CLI / share). |
| `scanner.include` | Optional globs. When set, `seed` and `store` discover these paths instead of the default README / docs / ADR walk. |
| `scanner.exclude` | Optional globs removed after discovery (default scan or `include`). |
| `scanner.extensions` | Optional suffixes. Default is `.md` and `.markdown`. Add `.mdx` to retain MDX. |
| `judge.priorityWeights` | Optional weights for `seed --budget`. Keys: `durability`, `centrality`, `supersession`, `fanout`, `secretRisk`. Defaults are in [jev.md](./jev.md). |
| `bankTemplate.extraction` | Optional extraction aggressiveness: `conservative`, `standard`, or `greedy`. Set by `configure --judge jev` or `--extraction`; maps to Hindsight `retain_extraction_mode` (`concise` / `verbose` / `verbatim`). |

### `share.json`

Written by `orto share`. Commit this file. It names how teammates reach the bank without embedding secrets.

```json
{
  "version": 1,
  "profile": "lan",
  "baseUrl": "http://192.168.1.10:8888"
}
```

| Profile | Base URL strategy | Notes |
|---------|-------------------|-------|
| `local` | `http://localhost:8888` | Minimal exposure; Docker helper OK |
| `lan` / `vpn` / `public` | Required `baseUrl` in share.json | Network auth differs; API keys still recommended |
| `hindsight-cloud` | `https://api.hindsight.vectorize.io` | API key required; optional `--mcp-auth oauth` |

Never put API keys in `share.json`.
Use env vars.
Team workflows and profile trade-offs: [team-sharing.md](./team-sharing.md).
Cloud specifics: [hindsight-cloud.md](./hindsight-cloud.md).

Example for a docs tree plus published MDX, with presentation workspaces and underscore drafts left out:

```json
{
  "scanner": {
    "include": ["docs/**/*.md", "src/content/works/**/*.mdx"],
    "exclude": ["docs/interviews/panel-2/**", "**/_*.mdx"],
    "extensions": [".md", ".markdown", ".mdx"]
  }
}
```

`seed` bootstraps from whatever that policy selects. `store` uses the same discovered set, then `store.allowlist` gates ongoing retain of new files. Secrets and credential paths are still denied even if an include glob matches them.

Bank id defaults to a slug of the project directory name; it is never hardcoded to `orto` for other projects. One Docker container is a Hindsight **server** that can hold many banks.

Never store API keys here. Use `ORTO_HINDSIGHT_API_KEY` / `HINDSIGHT_API_KEY` or `--api-key`.

---

## `hindsight/bank-template.json`

Written by `orto configure`. Importable Hindsight bank template (version `"1"`) that shapes how the bank thinks: separate from the memories themselves.

It typically includes:

- **Retain / observations / reflect missions**: extract durable architecture, standards, and domain facts; ignore secrets and ephemeral noise
- **Entity labels**: e.g. `knowledge_kind` (`decision`, `standard`, `architecture`, …) and `durability` (`stable`, `evolving`, `deprecated`)
- **Mental models**: living summaries (project context, architecture decisions, coding standards) refreshed after consolidation
- **Directives**: prefer durable sources, cite provenance, do not invent conventions, local-first defaults

Example (abbreviated from this repo’s template):

```json
{
  "version": "1",
  "bank": {
    "retain_mission": "This bank holds durable knowledge for the orto software project. Always extract: architectural decisions… Ignore: secrets/credentials…",
    "reflect_mission": "You are the durable project memory for orto. Prefer established architecture, ADRs, coding standards… Do not invent conventions…",
    "disposition_skepticism": 4,
    "disposition_literalism": 4
  },
  "mental_models": [
    {
      "id": "project-context",
      "name": "Project Context",
      "source_query": "Summarize orto only from retained memories: purpose, TypeScript/Node CLI for Hindsight banks, pipeline stages, local-first conventions…"
    }
  ],
  "directives": [
    {
      "name": "prefer-durable-sources",
      "content": "Prefer ADRs, architecture docs, standards, and AGENTS.md over chat history…",
      "priority": 10,
      "is_active": true
    }
  ]
}
```

Commit this file. Apply it with `orto bank apply` (or `orto configure --apply`) so mission and directives match the project before or alongside seeding.

The template is the *personality and policy* of the bank. Retained facts are the *content*. Both matter for useful MCP recall.

---

## `local/seed-manifest.json`

Written by live `orto seed` and `orto store`. Tracks **what was already retained** so re-seeds are incremental.

- Per source path: content hash, list of stable fact / `document_id`s, last seeded time
- Unchanged files are skipped on the next `seed` unless you pass `--force`
- Fact ids look like `orto:README.md#the-vision`: Hindsight upserts by id instead of duplicating

This is **machine-local seed state**, not documentation. Prefer keeping it out of git (`.orto/local/` is gitignored). The bank in Hindsight is the shared memory; the manifest only speeds up re-seed on this machine.

Illustrative shape (from a dogfood project):

```json
{
  "version": 1,
  "bankId": "strumentario",
  "updatedAt": "2026-08-07T23:13:46.596Z",
  "sources": {
    "README.md": {
      "contentHash": "…",
      "factIds": [
        "orto:README.md#the-vision",
        "orto:README.md#core-principles"
      ],
      "seededAt": "2026-08-07T22:59:26.952Z"
    },
    "docs/overview.md": {
      "contentHash": "…",
      "factIds": ["orto:docs/overview.md#overview"],
      "seededAt": "2026-08-07T23:13:46.596Z"
    }
  }
}
```

`seed --dry-run` previews candidates without writing the manifest or retaining.
With `--judge jev` it may recall up to 5 observation summaries and preview extracted facts (both read-only).

---

## `local/tombstones.json`

Written by live `orto prune` after a successful document delete.
Tracks **which `document_id`s must not be re-retained** while the source content is unchanged.

- Per document id: optional `sourcePath`, optional `contentHash`, and `prunedAt`
- `prepareSeed` (shared by `seed` and `store`) skips tombstoned facts when the current hash still matches (or when the tombstone has no hash)
- `--force` on seed/store, or a content hash change, allows retain again
- After a successful re-retain of that id, the matching tombstone entry is cleared

This is **machine-local prune state**, not documentation.
Keep it out of git with the rest of `.orto/local/`.
Details: [CLI reference](./orto-cli-commands.md#orto-prune).

Illustrative shape:

```json
{
  "version": 1,
  "bankId": "orto",
  "updatedAt": "2026-09-30T20:00:00.000Z",
  "entries": {
    "orto:docs/old.md#removed-heading": {
      "sourcePath": "docs/old.md",
      "contentHash": "…",
      "prunedAt": "2026-09-30T20:00:00.000Z"
    }
  }
}
```

---

## How agents use it (MCP recall)

With a running Hindsight instance and MCP wired to the project bank:

```text
http://localhost:8888/mcp/<bankId>/
```

Example for this repo: `http://localhost:8888/mcp/orto/`.

1. Agent asks a durable question (“What are our architecture boundaries?”, “How do we treat secrets?”)
2. Cursor rule / AGENTS guidance steers it to Hindsight **`recall`** (or **`reflect`** for synthesis)
3. Bank returns structured memories with provenance (source file / section ids), not a raw markdown paste
4. Docs in git remain authoritative; the bank is the agent-facing memory of those sources

Wire the harness after seed:

```bash
orto mcp --write --write-agents --write-cursor-rules --include-auth
```

Auth (when the server requires a tenant key) uses the same secret as seed: set `ORTO_HINDSIGHT_API_KEY` in the environment the IDE inherits: never commit the key. Refresh MCP in Cursor Settings after writing `.cursor/mcp.json`.

---

## Why put Orto in a project

Without a bank, every agent session rediscovers architecture, standards, and domain rules from scattered files. With Orto:

- **Shared context**: teammates and agents hit the same bank id and template policy
- **Provenance**: recalled facts point back to README / ADR / docs sections
- **Conservative seeding**: only high-signal durable sections; secrets stay out
- **Incremental updates**: change docs → `seed --dry-run` → live `seed`; unchanged sources are skipped
- **Harness-ready MCP**: one command emits Cursor / AGENTS wiring so recall is the default path

Typical loop:

```bash
orto init --bank-id <your-bank> --yes
orto configure
# import .orto/hindsight/bank-template.json into Hindsight

orto seed --dry-run
ORTO_HINDSIGHT_API_KEY='…' orto seed

orto store --dry-run
orto prune --dry-run

orto mcp --write --write-agents --write-cursor-rules --include-auth
```

Update docs when the project evolves; re-seed when you want the bank to catch up; prune after renames or heading drift.
Prefer missing a weak section over injecting noise.

---

## Related

- [README](../README.md): quick start and MCP flags
- [CLI commands](./orto-cli-commands.md): full flag reference (incl. store / prune)
- [Team sharing](./team-sharing.md): deployment profiles, share artifact, bank apply, multi-repo MCP
- [Developer workflow](./dev-workflow.md): first seed, re-seed, retain-then-prune tips
- [CLI architecture](./cli-architecture.md): config layout and seed / prune pipeline for contributors
- [Sensitive data](./sensitive-data.md): what must never be retained
- [Phase 4 dogfood gaps](./phase-4-dogfood-gaps.md): multi-repo MCP DX and template apply
- [Phase 5 dogfood gaps](./phase-5-dogfood-gaps.md): zanuka-web `store` ops; prune shipped; optional bank-list helper
- [Hindsight bank templates](https://hindsight.vectorize.io/developer/api/bank-templates)
