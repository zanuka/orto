# Orto Roadmap

High-level phased plan. This is a living document; priorities will shift based on real usage and feedback as we build in public.

## Phase 0: Foundation (Now)

- [x] Repository created
- [x] README + vision
- [x] Basic project structure and TypeScript CLI skeleton
- [x] MIT license, contributing guidelines, CODE_OF_CONDUCT
- [x] CLI installable on PATH / package publish-ready as `@orto-ai/cli` (`publishConfig`, global link / install docs)
- [ ] First npm publish of `@orto-ai/cli`
- [ ] GitHub project board / issue templates for public development

**Goal:** Clean starting point that makes the vision obvious and invites early feedback.

## Phase 1: Core CLI + Hindsight Bank Config

- [x] `orto init`: detect project root, scaffold `.orto/` config (interactive bank id + Docker container name; flags/`--yes` for non-interactive)
- [x] Bank template generation for Hindsight (mission, directives, extraction settings)
- [x] Sensible defaults for typical full-stack / web projects
- [x] `orto configure`: non-interactive bank setup with `--dry-run` (interactive prompts later)
- [x] Basic validation and dry-run support

**Goal:** A developer can point Orto at a repo and get a ready-to-apply Hindsight bank template in under a minute.

## Phase 2: Knowledge Curation & Seeding

- [x] Project scanner for durable sources (README, `/docs`, ADRs): conservative first pass; `AGENTS.md` is integration surface, not seed input
- [x] Optional `scanner.include` / `exclude` / `extensions` in `.orto/config.json` (MDX when listed; secrets denylist still wins; `store.allowlist` stays orthogonal)
- [x] Extraction heuristics that prefer decisions, invariants, and architecture over ephemeral content (YAML frontmatter stripped before section scoring)
- [x] `orto seed --dry-run`: preview extracted candidates with provenance
- [x] `orto seed`: retain high-signal knowledge into the configured Hindsight bank
- [x] Seed progress reporting: do-not-interrupt warning + `[i/N]` percent during sync retain; optional `--async` operation polling
- [x] Incremental / re-seed support (content-hash manifest under `.orto/local/`)
- [x] Simple provenance tracking (source file + commit)

**Goal:** Agents start sessions with real project context instead of an empty bank.

## Phase 3: Local Hosting & Agent Integration

- [x] Docker / local Hindsight helper (`orto docker` or equivalent)
- [x] `orto docker upgrade --to <version>`: backup all banks, recreate on same volume with preserved env, validate fact counts (pinned tags only)
- [x] MCP endpoint generation for Cursor, Kiro, Claude Code, Roo, Codex, etc.
- [x] `orto mcp`: emit ready-to-paste configs and rules
- [x] Optional updates to `AGENTS.md` / Cursor rules that tell agents to prefer the project bank
- [x] Single-bank focus (multi-bank later)
- [x] `orto store`: operator-selected, ongoing incremental retain once durable project `.md` already exists on disk (preview first; reuses `seed`'s retain path exactly, no second implementation)
- [x] Firstmate dogfood: on-demand `project-bank` skill (`orto mcp --harness firstmate --write-firstmate`) appends a recall-only bank card to the ship brief before a crewmate spawn; crewmates recall, they never seed or store

**Goal:** End-to-end path from repo → configured bank → agent that actually uses it.

## Phase 4: Bank hygiene (prune)

- [x] `orto prune` (v1): path-gone / section-gone / explicit `--source` or `--document-id`, `--dry-run`, TTY multi-select, non-interactive `--yes` with explicit selection, Hindsight document delete, local `.orto/local/tombstones.json` so unchanged sources are not re-retained on the next `seed` / `store` (`--force` or content change can retain again). Mental-model refresh is recommended in copy only. See [CLI reference](./docs/orto-cli-commands.md#orto-prune).

Optional `--judge jev` annotation on prune (score items still on disk but no longer true) is tracked in [Phase 7](#phase-7-optional-jev-judgment-layer--reliability).

**Goal:** Operators can remove stale bank documents without a full re-seed.

## Phase 5: Team Sharing & Deployment Profiles

**Dogfood targets:**

- [Strumentario](https://github.com/zanuka/strumentario): first external repo to run the full `init` → `configure` → `seed` → `mcp` path on a shared local Hindsight server (same Docker container as the orto bank, distinct `bankId`). Lessons from this pass drive shareable configs and deployment profiles.

- [x] Dogfood: create and seed a Hindsight bank for Strumentario via the Orto CLI (shared container, bank id `strumentario`)
- [x] Capture dogfood gaps (multi-repo DX, bank template apply, shareable config shape) back into this phase: see [docs/phase-4-dogfood-gaps.md](./docs/phase-4-dogfood-gaps.md)
- [x] Dogfood: zanuka-web day-to-day ops document `orto store` (allowlist-gated); no zanuka-web patch attempted
- [x] Capture zanuka-web gaps (prune / list-bank-docs / delete-doc parity; deferred Firstmate `project-bank`) : see [docs/phase-5-dogfood-gaps.md](./docs/phase-5-dogfood-gaps.md)
- [x] Bank document ops parity: thin `orto docs list` inventory helper (JSON optional); delete stays on `prune --document-id --yes`; dogfood archive of Python list/delete helpers after zanuka-web prune pass
- [x] Multi-repo MCP DX: bank-scoped MCP server names (`hindsight-<bankId>`), optional `--server-name`, Cursor auth/env guidance, optional `mcp --check`
- [x] Bank template apply: `configure --apply` and `bank apply` create/update the Hindsight bank from `.orto/hindsight/bank-template.json` (`--dry-run`)
- [x] Shareable knowledgebase configs: portable project identity in `config.json` plus `.orto/share.json` deployment profile (base URL strategy, no secrets in git)
- [x] Deployment profile: **local / LAN**: single machine or trusted network, minimal exposure
- [x] Deployment profile: **VPN**: bank reachable only inside a private network for closed teams
- [x] Deployment profile: **public**: intentionally exposed self-hosted Hindsight when knowledge is meant to be open
- [x] Deployment profile: **hindsight-cloud**: managed [Hindsight Cloud](https://docs.hindsight.vectorize.io/) (`https://api.hindsight.vectorize.io`); API key for seed/apply; bank-scoped MCP and/or OAuth MCP; skip local Docker: see [docs/hindsight-cloud.md](./docs/hindsight-cloud.md)
- [x] Documented security defaults and trade-offs per profile (auth, TLS, network binding, Cloud credits / data residency)
- [x] CLI helpers to generate and validate the chosen profile (`orto share`, with `--dry-run` / `--validate`)
- [x] Profile-aware MCP / harness emission (URLs and server names follow the active deployment profile; Cloud emits `api.hindsight.vectorize.io` + env key placeholders)

**Goal:** A team can publish one durable bank and let agents across the org inherit it: local/self-host by default, [Hindsight Cloud](https://docs.hindsight.vectorize.io/) opt-in, never a forced cloud path.

User guide: [docs/team-sharing.md](./docs/team-sharing.md).

## Phase 6: Mental Models (Hindsight-native curated reflect)

[Hindsight mental models](https://hindsight.vectorize.io/developer/api/mental-models) are **saved reflect responses** checked first during reflect (before observations and raw facts). They are not the same as Mem0’s “mental model” metaphor in [How Mem0 Works](https://docs.mem0.ai/core-concepts/how-it-works): Mem0 stores extracted facts and retrieves them via `search`; it has no first-class curated-summary layer. Closest Mem0 knobs are **custom instructions** / **custom categories** (write-time extraction and labeling), which map more to Orto’s retain mission and tags than to Hindsight mental models.

**Approach (hybrid: not init-only, not docs-only):**

| Layer | What ships | Why |
|-------|------------|-----|
| Defaults in bank template | Already generated in Phase 1 (`project-context`, `architecture-decisions`, `coding-standards`) | Sensible starter pack; applied with Phase 5 `configure --apply` / `bank apply` |
| Post-seed lifecycle CLI | Create / list / refresh / clear with `--dry-run`; stable custom IDs | Models are useless until the bank has retained knowledge; refresh is the real product |
| Version-controlled declarations | Extend `.orto/hindsight/bank-template.json` (or a sibling mental-models section) for project-specific queries, tags, and triggers | Durable, shareable, reviewable: same as mission/directives |
| Best-practice guidance | When to use auto-refresh vs manual; tag/`tags_match` pitfalls; agent “prefer reflect for playbook questions” | Prevent empty refreshes and over-eager regeneration of curated policy docs |

Do **not** fold mental-model curation into `init` prompts. Keep generation in `configure` / template; keep apply separate; add refresh after `seed`. Multi-provider: treat mental models as a **Hindsight adapter** capability; Mem0 path later can expose extraction instructions + category/metadata guidance without inventing a fake mental-model API.

- [x] Document mental-model role, tagging, configure wizard, and post-seed CLI: see [docs/mental-models.md](./docs/mental-models.md) (user guide) and [docs/hindsight-mental-models.md](./docs/hindsight-mental-models.md) (design)
- [x] Fix default template refresh safety: tagged models default to `all_strict` source matching; align seed tags **or** set `trigger.tags_match` (e.g. `any`) so first refresh is not empty
- [x] Interactive `configure` wizard (TTY) for starter models, tagging mode, and refresh policy; `--yes` / flags for non-interactive
- [x] `orto mental-model`: list / get / create / update / refresh / clear / tags against the configured bank (`--dry-run`; refresh dry-run uses upstream dry-run-refresh; poll async operations like seed; `--save-template` opt-in write-back)
- [x] Idempotent apply of declared models from the bank template (stable `id`s; create-or-update; tags / `tags_match` / triggers preserved)
- [x] Optional post-seed hook: `seed --refresh-mental-models` (opt-in; documents overlap with `refresh_after_consolidation`)
- [x] Refresh policy presets: differentiated defaults (auto for evolving starters; manual for `coding-standards`); trigger typing includes `mode` / full `tags_match` / optional `min_refresh_interval_seconds` (`delta` still optional later; Jev: [JEV-16](https://github.com/zanuka/orto/issues/51), [JEV-20](https://github.com/zanuka/orto/issues/53))
- [x] Agent integration hint: AGENTS / Cursor snippets prefer `reflect` / mental models for playbook questions; `recall` for narrow facts ([JEV-25](https://github.com/zanuka/orto/issues/26) routing judge remains optional)
- [x] Provider boundary: Hindsight mental-model helpers stay in `src/providers/hindsight/`; no fake Mem0 mental-model surface

**Goal:** After seed, agents get consistent, high-priority answers to the project’s recurring questions: not just a bag of retained facts.

## Phase 7: Optional Jev judgment layer + Reliability

### Optional Jev judgment layer

[Jev](https://docs.typesafe.ai/introduction) (TypeSafe System One) is an opt-in judge for bounded decisions: what to retain, what is stale, what to seed first, and when a human should confirm.
Hindsight stays the memory backend and the CLI provider.
With no `ORTO_TYPESAFE_API_KEY` and no `--judge jev`, the CLI keeps today's offline heuristics.
Orto owns scanning, side effects, and apply.
Jev returns typed choices and scores.
Low confidence queues a dry-run or a confirmation.
Secrets and denylisted paths stay on the machine.

Product rule: [docs/jev.md](./docs/jev.md).
Where it sits: [docs/jev-integration.md](./docs/jev-integration.md).
Tracked in [JEV-0](https://github.com/zanuka/orto/issues/58) and the [open `jev` issues](https://github.com/zanuka/orto/issues?q=is%3Aissue+is%3Aopen+label%3Ajev).
The checklist groups those tickets.
The [issue index](#jev-issue-index) lists the epic.
JEV-1 through JEV-13 are done in the checklist (JEV-12 and JEV-13 helpers included).
JEV-1 through JEV-10 are closed on GitHub.

- [x] Product rule: `docs/jev.md` states Jev is a judge, not a backend (opt-in, offline fallback, do-not-build, confidence gate, state budget). ([JEV-1](https://github.com/zanuka/orto/issues/20))
- [x] Judge port: `Judge` interface (`off` / `heuristic` / `jev`), `--judge` / `--confidence` / `--strict` on seed/store/prune, TypeSafe HTTP client with offline fallback. Missing key with `--judge jev` is a hard error; network/429/5xx fall back to heuristics unless `--strict`. Default path makes no TypeSafe calls. ([JEV-2](https://github.com/zanuka/orto/issues/21))
- [x] State sanitization before TypeSafe calls (secrets, denylist, size). `buildJevState` skips denylisted paths and inline secrets, caps the excerpt, and `JevJudge` refuses to POST a payload that fails those checks. ([JEV-3](https://github.com/zanuka/orto/issues/22))
- [x] Relevance gate before retain: after the heuristic filter, `seed --judge jev` asks `is_durable`, `is_ephemeral`, `in_scope`, and a durability score in one call. High-confidence rejects are skipped. Scores below `--confidence` stay in the dry-run review queue and are not retained. Without `--judge jev`, seed is unchanged. ([JEV-4](https://github.com/zanuka/orto/issues/30))
- [x] Section-level keep/skip: the same questions run once per `orto:<path>#<section>`. Dry-run prints one row per document id, so one README can retain an architecture section and skip a changelog section. Headings the heuristic would drop are judged only when `--judge jev` is on. ([JEV-5](https://github.com/zanuka/orto/issues/36))
- [x] Knowledge-kind taxonomy: the same `seed --judge jev` call asks a `kind` choice. Criteria (`what`, `not_for`, `examples`) live in `src/judge/knowledge-kinds.json`. Dry-run prints the kind and probabilities. Confident `noise` and `style_pref` are not retained. Other confident kinds stamp `knowledge:<kind>`. `document_id` stays `orto:<path>#<section>`. ([JEV-6](https://github.com/zanuka/orto/issues/37))
- [x] Contradiction check before retain: `seed --judge jev` recalls up to 5 observation summaries and asks one `relation` choice (`supports`, `extends`, `supersedes`, `contradicts`, `unrelated`) when that list has at most 3 ids. Four or five overlaps use a `conflicts_with_<n>` noul each. Confident `supersedes` or `contradicts` retains the section once with metadata pointing at the old observation id. `supports`, `extends`, and `unrelated` retain normally, with no extra item. Dry-run prints the relation and does not retain or delete. ([JEV-7](https://github.com/zanuka/orto/issues/38))
- [x] PII / secret second pass: the same `seed --judge jev` call asks `contains_secret` and `contains_pii`, where a high score means unsafe. A confident secret is a hard skip, with a stderr warning that names the path and does not print the secret. A confident personal-data answer is skipped. A mid-range score stays in review and is not retained. A local `sk-` token or PEM block skips before the TypeSafe call. A clean ADR is not flagged. ([JEV-8](https://github.com/zanuka/orto/issues/39))
- [x] Citation support after extract: when `seed --judge jev` keeps a section, Hindsight previews the facts it would extract (read-only, no persistence). One Jev call per section asks `supported_by_source_<n>` and a `support_<n>` choice (`quoted`, `implied`, `unsupported`) for those facts together. A high-confidence `unsupported` answer is not retained. A quote of the section is kept. Retain sends the kept fact text, so this filters the Hindsight extractor and does not run a second one. At most 12 facts are judged in that call. Dry-run does not retain or write the manifest. If the preview returns no facts, or the preview fails, the section is retained as written. ([JEV-9](https://github.com/zanuka/orto/issues/40))
- [x] Propose allowlist adoption: `store --propose-adopt --judge jev` asks `should_adopt` and the knowledge `kind` once per new durable file. A confident durable kind is printed as a proposal. A dependency readme or other non-durable markdown is not proposed. The allowlist changes only with `--apply`, and nothing is retained. Default `store` does not adopt new files. ([JEV-10](https://github.com/zanuka/orto/issues/41))
- [x] Composite seed priority and retain budget: `seed --budget N --judge jev` ranks changed sections from durability, centrality, supersession, fanout, and secret risk. Weights live in `judge.priorityWeights`. Dry-run prints the ordered queue and a cutoff. Only the top N are retained. The rest stay pending in the seed manifest. ([JEV-11](https://github.com/zanuka/orto/issues/50))
- [x] `store` edit durability gate: `store --judge jev` asks `claim_changed`, `looks_like_workaround`, and `action`. Wording-only skips retain and still updates the content hash. A temporary workaround stays in review. A real claim change re-retains. Without `--judge jev`, store is unchanged. ([JEV-12](https://github.com/zanuka/orto/issues/31))
- [x] Watcher high-signal gate helper: `judgeWatcherGate` asks `durable_claim_changed` and `behavior_delta`. Formatting-only changes skip. High `behavior_delta` enqueues a seed path. No `watch` CLI command ships with this helper. ([JEV-13](https://github.com/zanuka/orto/issues/42))
- [ ] Optional `--judge jev` prune annotation: score items that are still on disk but no longer true (outdated / irrelevant / contradicted). Jev annotates only; Orto deletes after confirm. Low confidence is listed and left unchecked. ([JEV-14](https://github.com/zanuka/orto/issues/32), [JEV-15](https://github.com/zanuka/orto/issues/43), [JEV-16](https://github.com/zanuka/orto/issues/51), [JEV-17](https://github.com/zanuka/orto/issues/52))
- [ ] Bank-template fitness: score mission and directives, choose extraction aggressiveness from repo shape, propose mental-model catalog questions, and assign tags consistently. Jev does not author the prose. ([JEV-18](https://github.com/zanuka/orto/issues/23), [JEV-19](https://github.com/zanuka/orto/issues/24), [JEV-20](https://github.com/zanuka/orto/issues/53), [JEV-21](https://github.com/zanuka/orto/issues/54))
- [ ] Recall and MCP guards: block unsafe MCP `retain`, rerank recalled passages, check whether a memory is still true, and route `reflect` vs `recall` vs mental-model lookup. ([JEV-22](https://github.com/zanuka/orto/issues/44), [JEV-23](https://github.com/zanuka/orto/issues/25), [JEV-24](https://github.com/zanuka/orto/issues/45), [JEV-25](https://github.com/zanuka/orto/issues/26))
- [ ] Firstmate routing: whether a task needs the project bank, which bank, knowledge update vs PR vs both, escalate vs dispatch, and whether a scout report is seedable. Low confidence escalates to the captain. ([JEV-26](https://github.com/zanuka/orto/issues/27), [JEV-27](https://github.com/zanuka/orto/issues/33), [JEV-28](https://github.com/zanuka/orto/issues/34), [JEV-29](https://github.com/zanuka/orto/issues/35), [JEV-30](https://github.com/zanuka/orto/issues/46))
- [ ] Share safety and destination kind: route by destination kind (Hindsight remains first-class) and gate a public or Cloud share on a safety check before anything is exposed. ([JEV-31](https://github.com/zanuka/orto/issues/55), [JEV-33](https://github.com/zanuka/orto/issues/56))
- [ ] Heuristic eval: a golden-set judge that scores the offline heuristics so the default path improves without requiring Jev at runtime. ([JEV-34](https://github.com/zanuka/orto/issues/48))

Deferred (still tracked under the Jev epic; land with later phases):

- Multi-bank fact routing ([JEV-32](https://github.com/zanuka/orto/issues/47)): with multi-bank support in Phase 8
- Maglio and Strumentario product judges ([JEV-36](https://github.com/zanuka/orto/issues/28), [JEV-37](https://github.com/zanuka/orto/issues/29)): adjacent dogfood

### Jev issue index

Issue index as of 2 November 2026.
JEV-1 through JEV-13 are done in the checklist (JEV-12 and JEV-13 helpers included).
JEV-1 through JEV-10 are closed on GitHub.
Open [`jev`-labeled issues](https://github.com/zanuka/orto/issues?q=is%3Aissue+is%3Aopen+label%3Ajev) are the rest of the table.
Closed duplicate epic [#19](https://github.com/zanuka/orto/issues/19) is superseded by [#58](https://github.com/zanuka/orto/issues/58).

| ID | Issue | Title |
|----|-------|-------|
| JEV-0 | [#58](https://github.com/zanuka/orto/issues/58) | Optional Jev judgment layer for Orto (epic) |
| JEV-1 | [#20](https://github.com/zanuka/orto/issues/20) | Product rule: Jev is a judge, not a backend (closed) |
| JEV-2 | [#21](https://github.com/zanuka/orto/issues/21) | Judge interface, CLI flags, and offline fallback (closed) |
| JEV-3 | [#22](https://github.com/zanuka/orto/issues/22) | Sanitize Jev state (secrets, denylist, size) (closed) |
| JEV-4 | [#30](https://github.com/zanuka/orto/issues/30) | Relevance gate before retain (closed) |
| JEV-5 | [#36](https://github.com/zanuka/orto/issues/36) | Section-level keep/skip (not file-level) (closed) |
| JEV-6 | [#37](https://github.com/zanuka/orto/issues/37) | Knowledge-kind taxonomy (closed) |
| JEV-7 | [#38](https://github.com/zanuka/orto/issues/38) | Contradiction check against existing observations (closed) |
| JEV-8 | [#39](https://github.com/zanuka/orto/issues/39) | PII / secret second pass (closed) |
| JEV-9 | [#40](https://github.com/zanuka/orto/issues/40) | Citation support check after retain / extract (closed) |
| JEV-10 | [#41](https://github.com/zanuka/orto/issues/41) | Propose `store` allowlist adoption for new durable files (closed) |
| JEV-11 | [#50](https://github.com/zanuka/orto/issues/50) | Composite seed priority + retain budget |
| JEV-12 | [#31](https://github.com/zanuka/orto/issues/31) | `store` edit durability gate |
| JEV-13 | [#42](https://github.com/zanuka/orto/issues/42) | Watcher / event-driven re-seed: high-signal gate (Phase 8) |
| JEV-14 | [#32](https://github.com/zanuka/orto/issues/32) | `orto audit --judge jev` writes a prune/refresh plan |
| JEV-15 | [#43](https://github.com/zanuka/orto/issues/43) | Layer-specific aging policy |
| JEV-16 | [#51](https://github.com/zanuka/orto/issues/51) | Mental-model freshness: refresh vs leave |
| JEV-17 | [#52](https://github.com/zanuka/orto/issues/52) | Apply audit plan with explicit confirmation |
| JEV-18 | [#23](https://github.com/zanuka/orto/issues/23) | Score generated bank mission / directives |
| JEV-19 | [#24](https://github.com/zanuka/orto/issues/24) | Choose extraction aggressiveness from repo shape |
| JEV-20 | [#53](https://github.com/zanuka/orto/issues/53) | Propose mental-model catalog questions |
| JEV-21 | [#54](https://github.com/zanuka/orto/issues/54) | Consistent tag assignment |
| JEV-22 | [#44](https://github.com/zanuka/orto/issues/44) | MCP `retain` guardrail (highest-priority runtime use) |
| JEV-23 | [#25](https://github.com/zanuka/orto/issues/25) | Rerank recalled passages before context stuffing |
| JEV-24 | [#45](https://github.com/zanuka/orto/issues/45) | Still-true check at recall time |
| JEV-25 | [#26](https://github.com/zanuka/orto/issues/26) | Route `reflect` vs `recall` vs mental-model lookup |
| JEV-26 | [#27](https://github.com/zanuka/orto/issues/27) | Firstmate: does this task need the project bank? |
| JEV-27 | [#33](https://github.com/zanuka/orto/issues/33) | Firstmate: which Orto project bank? |
| JEV-28 | [#34](https://github.com/zanuka/orto/issues/34) | Firstmate: knowledge update vs PR-only vs both |
| JEV-29 | [#35](https://github.com/zanuka/orto/issues/35) | Firstmate: escalate vs dispatch, and which crewmate |
| JEV-30 | [#46](https://github.com/zanuka/orto/issues/46) | Firstmate: scout report seedability + official TypeSafe skill pointer |
| JEV-31 | [#55](https://github.com/zanuka/orto/issues/55) | Destination-kind router (not vendor lock-in) |
| JEV-32 | [#47](https://github.com/zanuka/orto/issues/47) | Multi-bank fact routing (Phase 8) |
| JEV-33 | [#56](https://github.com/zanuka/orto/issues/56) | Deployment-profile safety gate before public share |
| JEV-34 | [#48](https://github.com/zanuka/orto/issues/48) | Golden-set judge to tune heuristics |
| JEV-35 | [#49](https://github.com/zanuka/orto/issues/49) | Bank drift metric (`orto status` / audit summary) |
| JEV-36 | [#28](https://github.com/zanuka/orto/issues/28) | Maglio: work order vs bank invariant (adjacent dogfood) |
| JEV-37 | [#29](https://github.com/zanuka/orto/issues/29) | Strumentario: instrument output vs bank standard (adjacent dogfood) |

### Reliability & Developer Experience

- [ ] Status / health commands (bank drift summary: [JEV-35](https://github.com/zanuka/orto/issues/49))
- [ ] Better error messages and recovery paths
- [ ] Bank rename / re-id: when the repo (or desired bank id) changes, keep the same retained knowledge under the new name; update `.orto/` config, bank template, seed manifest, and MCP/agent wiring (`--dry-run`). Do not require a full re-seed into an empty bank
- [ ] Config schema + validation
- [ ] Test coverage for core extraction and template logic
- [ ] Documentation site or expanded examples

**Goal:** Operators can preview keep/skip scores with `seed --dry-run --judge jev` when opted in, and every retain, prune, and share still happens only in Orto behind a confidence gate. The default path (no TypeSafe) feels solid enough for daily use on real projects.

## Phase 8: Advanced & Extensibility

- [ ] File watcher / event-driven re-seeding (wire `judgeWatcherGate` / `collectSeedEnqueue` into an opt-in watch loop; gate helper: [JEV-13](https://github.com/zanuka/orto/issues/42))
- [ ] Multi-provider support: Hindsight remains first-class and the default; other backends are opt-in CLI options
  - [ ] Multi-provider foundation (extract `HindsightProvider`, `--provider` dispatch; destination-kind router: [JEV-31](https://github.com/zanuka/orto/issues/55))
  - [ ] Mem0 adapter
  - [ ] Graphiti / Zep adapter: **seed destination only** (see [docs/graphiti-integration.md](./docs/graphiti-integration.md))
    - [ ] OSS HTTP transport spike (`add_episode` + `group_id`)
    - [ ] `init` / `configure` / `seed --dry-run` / incremental `seed`
    - [ ] Software ontology (`software-v1`) + extraction instructions
    - [ ] Optional Zep Cloud runtime (`--provider zep`)
    - [ ] `mcp` / `docker print` point at official Graphiti docs (do not vendor compose)
  - [ ] Cognee adapter (later)
- [ ] Multi-bank and multi-repo company brains (fact routing: [JEV-32](https://github.com/zanuka/orto/issues/47))
- [ ] Lightweight inspection UI (optional, later)
- [ ] Deeper ADR and decision-record parsers

**Goal:** Orto becomes the durable knowledge layer that agentic workflows can reliably build on.

---

### Guiding Constraints

- Prefer local control and self-hosting as the default; [Hindsight Cloud](https://docs.hindsight.vectorize.io/) is an explicit opt-in profile
- Hindsight-native first; other memory providers only if demanded and without compromising the Hindsight experience
- Team sharing must remain opt-in and profile-driven (local/LAN, VPN, public self-host, or Hindsight Cloud): never a forced cloud default
- Amplify existing engineering practices (ADRs, standards, clear architecture) rather than replace them
- Keep the CLI fast and the happy path short
- Stay focused on knowledgebases and agent context before expanding into broader agent orchestration

Feedback and real-world usage will reshape this plan. Open issues or discussions are the best way to influence direction.
