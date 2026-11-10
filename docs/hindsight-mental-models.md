# Hindsight mental models in Orto

Design notes for Phase 6.
User-facing workflow guide: [mental-models.md](./mental-models.md).
Upstream: [Mental Models API](https://hindsight.vectorize.io/developer/api/mental-models), [Tags and Visibility](https://hindsight.vectorize.io/developer/api/mental-models#tags-and-visibility), [Listing mental model tags](https://hindsight.vectorize.io/developer/api/mental-models#listing-mental-model-tags).

Mental models are **saved reflect responses**: curated summaries for recurring questions. During reflect, Hindsight checks them **before** observations and raw facts. They are Hindsight-native; Mem0 has no equivalent curated-summary layer (see [ROADMAP Phase 6](../ROADMAP.md)).

---

## What tags do

A mental model’s tags control two things at once ([Tags and Visibility](https://hindsight.vectorize.io/developer/api/mental-models#tags-and-visibility)):

| Effect | Behavior |
|--------|----------|
| **What it reads** | On create/refresh, an internal reflect only sees memories that satisfy the model’s tag filter |
| **Who can see it** | On `reflect` / lookup, callers only see models whose tags overlap their request tags |

Same isolation rules as the rest of the bank, applied to synthesized knowledge: a model scoped to one team, customer, or topic is built only from that scope and surfaces only for requests in that scope.

### Refresh matching defaults (critical)

- A **tagged** model defaults to `all_strict` for refresh: a memory must carry **every** tag on the model.
- Untagged memories are excluded when the model has tags.
- Multi-tag models whose memories are tagged narrowly (one topic each) often refresh **empty** unless you set `trigger.tags_match` to `any` (or use `tag_groups`).
- `GET …/tags?source=mental_models` lists tags on models; `source=memories` (default) lists tags on memories: different tag spaces.

Orto must keep **seed retain tags** and **mental model tags** coherent, or first refresh will fail silently into empty content.

---

## Where this fits in the Orto lifecycle

Mental models are **not** an `init` concern. `init` names the bank and local Docker server. Models need a bank template, retained knowledge, and then create/refresh against a live bank.

```text
init          → project identity + bank id
configure     → declare mission, directives, mental models (+ tags) in bank-template.json
configure --apply / bank apply   → create bank + apply declarations
seed          → retain facts with tags that models can read
mental-model  → create / edit / refresh / clear after the bank has content
mcp           → agents prefer reflect for playbook-style questions
```

| Stage | Mental-model responsibility |
|-------|-----------------------------|
| **`configure` (wizard)** | Declare starter models: id, name, source query, tags, `tags_match`, refresh policy. Write version-controlled template only: no live Hindsight calls required. |
| **Template apply** | Idempotent create-or-update of declared models on the bank (stable custom `id`s). |
| **`seed`** | Stamp retain tags that match (or intentionally overlap) model scopes so refresh has something to read. Optional `--refresh-mental-models`. |
| **`mental-model` (post-seed)** | Add, edit, list, refresh, clear against the live bank; `--save-template` writes declarations back. |
| **Agent wiring** | Tell agents to `reflect` (or read models) for architecture / standards / "how we work," not only `recall`. |

Do not collapse apply or refresh into `seed`. Generation stays in configure/template; apply is provider integration; refresh is a post-seed lifecycle step.

---

## Tag vocabulary for project banks

Default generated templates use **topic-scoped tags that seed already emits**, plus `tags_match: any` on multi-tag models:

| Layer | Tags (example) |
|-------|----------------|
| Seed retain | `orto`, `kind:adr`, `knowledge:decision`, … |
| `project-context` | `knowledge:overview`, `knowledge:domain`, `knowledge:architecture` with `trigger.tags_match: "any"` (not the shared `orto` tag: that scopes almost the whole bank) |
| `architecture-decisions` | `knowledge:architecture`, `knowledge:decision` with `trigger.tags_match: "any"` |
| `coding-standards` | `knowledge:standard` |

Under Hindsight’s default `all_strict`, a multi-tag model only refreshes from memories that carry **every** model tag. Seed stamps one `knowledge:<kind>` per fact, so `architecture-decisions` would refresh empty without `tags_match: any`.

**Project-bank defaults:**

1. Prefer **topic tags that seed already emits**, e.g. `knowledge:architecture`, `knowledge:standard`, `knowledge:decision`, plus the shared bank tag `orto` for project-wide models.
2. For multi-tag models, set `trigger.tags_match: "any"` unless every memory is expected to carry all tags.
3. Reserve customer/team/user scopes (`team:platform`, `customer:acme`) for multi-tenant or multi-team banks: not the default single-repo project template.
4. Changing model tags without retagging memories (or changing `tags_match`) is a breaking refresh change.

Entity labels (`knowledge_kind`, `durability`) on the bank template are **not** the same as memory tags. Labels guide extraction structure; tags drive visibility and refresh scope. Offline seed maps the heuristic `knowledge_kind` to `knowledge:<kind>`.
`seed --judge jev` replaces that label with the taxonomy id from `src/judge/knowledge-kinds.json` and stamps `knowledge:<id>`.
Starter models that list only `knowledge:decision` do not see a section tagged `knowledge:adr`.

---

## `configure` multi-step wizard

`configure` runs an **optional interactive wizard** when stdin is a TTY (same pattern as `init`). Non-interactive paths stay first-class:

- `orto configure --yes`: accept starter defaults, no prompts
- Flags: `--models`, `--tagging-mode`, `--refresh-policy` for CI
- `--dry-run`: print the resulting template

### Wizard steps

1. **Starter mental models**: multi-select Project Context, Architecture Decisions, Coding Standards
2. **Tagging mode**:
   - **Topic-scoped (default)**: seed-aligned tags; `tags_match: any` on multi-tag models
   - **Project-wide**: shared `orto` tag only
   - **Custom**: comma-separated tags per model
3. **Refresh policy**:
   - **Differentiated (default)**: auto after consolidation for evolving summaries; manual for `coding-standards`
   - **Auto** / **Manual** batch presets
4. **Review**: confirm write to `.orto/hindsight/bank-template.json`

Wizard output remains the template file. Applying to Hindsight stays `configure --apply` / `bank apply`. Models stay empty until seed + refresh.

### What the wizard should *not* do

- Call Hindsight to create models before the bank exists or before seed (unless the user explicitly chose apply in the same session: still a separate step).
- Invent customer/tenant isolation for a single-repo “company brain” unless the user picks custom scopes.
- Prompt for every directive by default; keep directive defaults automatic unless an “advanced” path is opened later.

---

## Post-seed command

A dedicated command after seed/sync is the right place for day-2 mental model work. Declaring models at configure time is necessary but not sufficient: content is produced by reflect over retained memories.

### Command surface

```text
orto mental-model list
orto mental-model get <id>
orto mental-model create --name … --source-query … [--id …]
orto mental-model update <id> …
orto mental-model refresh <id|--all>
orto mental-model clear <id>
orto mental-model tags [--source memories|mental_models]
orto mental-model propose --judge jev [--apply] [--yes] [--ids …]
```

Mutating subcommands support `--dry-run`. Refresh `--dry-run` uses Hindsight `dry-run-refresh` when available. Async create/refresh polls operations like `seed`. Template write-back is opt-in via `--save-template`.

Prefer edit template → apply → refresh for team-shared banks. Use `--save-template` when editing the live bank and you want git to catch up.

### Optional seed hook

`orto seed --refresh-mental-models` (opt-in, not default): after retain, refresh declared models from the template. Models with `refresh_after_consolidation: true` may also queue after Hindsight consolidates; the flag is an explicit post-retain refresh. Default seed stays retain-only.

---

## Agent usage

Once models exist and have content:

- Prefer **`reflect`** (or `get_mental_model` / list with `detail=content`) for architecture, standards, and onboarding-style questions.
- Prefer **`recall`** for narrow fact lookup and provenance hunting.
- Callers that pass tags on reflect only see models in that tag scope: MCP snippets for a single project bank should usually use **no tags** (or the shared project tag) so project-wide models remain visible.

---

## Implementation boundaries

| Concern | Module |
|---------|--------|
| Wizard prompts / flags | `src/commands/configure.ts`, `configure-wizard.ts` |
| Starter catalog / tagging / refresh presets | `src/providers/hindsight/mental-models.ts` |
| Template shape (tags, `tags_match`, triggers) | `src/providers/hindsight/template.ts`, `types.ts` |
| Seed tag vocabulary alignment | `src/seeder/prepare.ts` |
| Live create / list / refresh / clear | `src/providers/hindsight/client.ts` + `src/commands/mental-model.ts` |
| Apply from template | `src/providers/hindsight/apply.ts` |

Keep provider logic out of commands. Do not invent a Mem0 mental-model API; if a future Mem0 adapter needs "curated context," map it separately (custom instructions / categories), not through this command.

---

## Decisions

1. Default tagging mode: topic-scoped with seed-aligned tags + `tags_match: any` on multi-tag models (`project-context` uses overview/domain/architecture, not bank-wide `orto`).
2. Template write-back: **`--save-template` only** (not always).
3. First content: explicit `mental-model refresh` and/or `seed --refresh-mental-models`; never auto-refresh on apply.
4. Default refresh presets: auto for `project-context` / `architecture-decisions`; manual for `coding-standards`.

---

## Related

- [ROADMAP.md](../ROADMAP.md): Phase 6 checklist
- [phase-4-dogfood-gaps.md](./phase-4-dogfood-gaps.md): bank template apply
- [orto-configs.md](./orto-configs.md): `.orto/` layout
- [cli-architecture.md](./cli-architecture.md): module boundaries
- [dev-workflow.md](./dev-workflow.md): happy path after seed
