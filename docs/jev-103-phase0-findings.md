# Issue 103 Phase 0 findings

Tracks baseline evidence for [Prove whether Jev picks facts that make MCP answers better](https://github.com/zanuka/orto/issues/103).

Corpus: Hindsight bank `zanuka-web` (heuristic-only retain history, legacy Nocciolo document ids).
Checkout path is kept private.
Date of this gather pass: 2026-11-21.

## Commands run

```bash
curl -sS http://localhost:8888/health
orto mental-model list
orto status --sample 20
orto status --sample 20 --judge jev
```

Hindsight answered healthy (`database: connected`).
Nothing was deleted or retained.

## Mental models

```
Mental models for bank "zanuka-web"
No mental models found.
Declare models in the bank template, then `orto bank apply`, seed, and refresh.
```

Live Hindsight has **0** mental models.
The bank template on this project already declares three standing models that are not present in Hindsight:

- `project-context`
- `dev-and-bank-ops`
- `career-and-interviews`

That gap is the Phase 0.5 starting point on the issue (apply template models first, then `orto mental-model propose --judge jev`).

## Bank drift sample (n=20)

| Mode | Result |
|---|---|
| hash (`source present vs missing`) | **0/20 supported (0%)** |
| jev (`still_supported_by_repo`) | **0/20 supported (0%)** |

Sampled document ids (from the Jev judge log) were all under two `docs/dev/` files:

- `docs/dev/ultimate-ai-workflow-setup.md` (12 sections)
- `docs/dev/firstmate-architecture.md` (8 sections)

Every id still uses the legacy prefix `nocciolo:…#…` (example: `nocciolo:docs/dev/ultimate-ai-workflow-setup.md#why-a-dispatch-file`).
Current Orto retain ids use `orto:…#…`.

### How to read 0/20

`orto status` counts a memory as supported only when:

- **hash mode:** the source path resolves and the file exists on disk
- **jev mode:** Jev answers `still_supported_by_repo` with band `yes` (uncertain and no both count as not supported)

For legacy `nocciolo:` ids, `parseDocumentId` treats the id as `other` (only the `orto:` prefix is parsed as section/path).
Hash mode then falls back to `document_metadata.source`.
Jev audit builds state the same way and cannot match a section fact by id, because extractor ids are now `orto:…`.

So this 0/20 result is **not** yet proof that the underlying markdown is gone or false.
It is evidence that:

1. Drift tooling is weak on Nocciolo-era document ids in this bank.
2. The first page of documents is concentrated in workflow/architecture notes, not a stratified sample across career, interviews, projects, and study.
3. Jev did not confidently affirm support for any of these 20 rows under the current excerpt/state path.

Treat re-running status after id/provenance normalization (or a stratified sample) as a follow-up measurement, not as a reason to mass-delete.

## Inventory snapshot (earlier read-only pass)

Captured before this gather command, same bank, for context:

| Metric | Value |
|---|---|
| Documents | 469 |
| Memory units (sum of `memory_unit_count`) | ~3,313 |
| Mental models in Hindsight | 0 |
| Docs missing `source` metadata | 84 |
| Rough source buckets | interviews ~120, dev ~134, projects ~92, career ~27, works ~9, other/missing remainder |

`knowledge_kind` on documents with metadata was dominated by `standard` and `architecture`, with a large `(none)` set on older rows.

## Implications for the issue plan

1. Phase 0 baseline must separate **tooling false negatives** (`nocciolo:` ids) from **true drift**.
2. Mental-model work can proceed without waiting on retain A/B: create the three template models, refresh from the existing bank, re-ask playbook probes.
3. Retain A/B banks should use fresh `orto:` document ids only, so status/audit/MCP provenance stay coherent.
4. Next gather steps: stratified inventory tables on the issue, then the MCP probe set (`reflect` / `recall` grades) before any live prune.

## MCP probe baseline (2026-11-22 / 2026-11-23)

Read-only against bank `zanuka-web`. Local artifact: zanuka-web `.orto/local/jev-score/phase0-probes.json` (gitignored).
No retain, prune, or mental-model create/refresh in this pass.

### LLM quietness

Hindsight `/health` was healthy.
Shared worker slots were free (`shared=0/8`), but Ollama stayed busy with a stuck **consolidation** on `coding-agent::cantiere` (`op` age ~6h+, progress stuck around 8/45, repeated `llm.ollama_native.consolidation` attempts with Ollama connection warnings).
`coding-agent::firstmate` had failed ops, no active processing.
`zanuka-web` had 0 pending / 0 processing ops.

Because of that, planned **reflect** probes were not re-run while the queue was hot.
Timed-out reflects from the earlier batch were completed with **recall fallback** and marked in the artifact.

### Grade key

- **pass**: answer matches gold durable docs for the asked facts
- **partial**: useful signal, missing a key gold fact or muddled
- **fail**: wrong / invented / misses the playbook point
- **pollution**: study / ephemeral junk surfaces when it should not dominate

Gold sources stayed in-repo docs (README, Fly guide, hindsight bank config, case-study guide, Astro Keel plan, Firstmate architecture, prior-platform / prior employer project docs, ultimate AI workflow). Interview bodies stay out of this table.

### Probe table

| id | planned | ran | elapsed | grade | notes |
|---|---|---|---:|---|---|
| p01 | reflect | reflect | 126s | fail | Invented Lit / Web Components hybrid stack. Gold is Astro 7 + Astro Keel + MDX Content Collections + Fly static Docker/nginx. Content path `src/content/works/` was the only solid bit. |
| p02 | recall | recall | 9s | pass | Case studies in `src/content/works/`, publish under `/works/`. |
| p03 | recall | recall | 9s | partial | App name `zanuka-web` correct. Default URL `the default Fly hostname` missing; custom portfolio domain dominated. |
| p04 | reflect | recall fallback | 17s | partial | prior-platform ADR exists (accepted 2026-09-05) and some architecture themes surface, but answer mixes Lit/hybrid narrative instead of a clean purpose / components / trade-offs summary. |
| p05 | reflect | recall fallback | 12s | pass | launch-framework = a prior employer homegrown isomorphic / universal JS launch framework; homegrown for SSR, performance, governance vs adopting someone else's app model. |
| p06 | recall | recall | 14s | partial | Bank id `zanuka-web` clear. Wiring advice muddled (mentions multi-bank / four banks). Gold: wire **only** `zanuka-web` in that workspace; Orto / Strumentario banks belong in their own repos. |
| p07 | reflect | recall fallback | 10s | pass | Conversation is not the archive: disk is system of record, `/stow` sweeps; Firstmate `data/*` vs project `AGENTS.md` vs Hindsight institutional bank. |
| p08 | reflect | recall fallback | 9s | pass | High-level career themes only (generalist, systems thinking, ownership, Vue+Go history). No transcript dump in the graded summary. |
| p09 | reflect | recall fallback | 11s | partial | Surfaces target-company interview elevator-style interview shape, not a crisp company-context + role-signal pitch. Keep transcript bodies out of public notes. |
| p10 | recall | recall | 12s | pollution | Study-guide corpus dominates; does not cleanly list React hooks study points. Useful as pollution evidence for Jev skip-on-study. |
| p11 | reflect | recall fallback | 11s | fail | Talks Nocciolo mental-model design lore. Misses day-to-day path: update durable docs, then `orto store` / `orto seed` (not MCP retain fluff). |
| p12 | recall | recall | 12s | pass | Astro Keel theme; site tokens via `src/consts.ts` / `global.css` (`--color-accent`); works collection for case studies. |
| p13 | reflect | recall fallback | 9s | pass | Token budget as architecture / AXI defaults (small default, escalate on demand, thin ambient, crew concurrency caps). |
| p14 | recall | recall | 11s | pass | prior-platform data plane: Amazon RDS (PostgreSQL) system of record; Redis cache/revocation; S3 blobs. |
| p15 | reflect | recall fallback | 15s | partial | Correct direction (prefer pinned mental model for standing project-context questions), but answer is generic study-doc lore. Live bank still has **0** mental models, so reflect/model path cannot win yet. |

### Scoreboard (human grades)

| Grade | Count | ids |
|---|---:|---|
| pass | 7 | p02, p05, p07, p08, p12, p13, p14 |
| partial | 5 | p03, p04, p06, p09, p15 |
| fail | 2 | p01, p11 |
| pollution | 1 | p10 |

Reflect-as-planned succeeded only for **p01** (and it failed the gold stack check).
Eight planned reflects used recall fallback because Ollama was starved by coding-agent consolidation.

### Implications for MCP usefulness

1. **Recall already carries the narrow facts** agents need for project/dev/project-docs probes (paths, Fly app, Keel, Postgres). Those are the rows that passed.
2. **Reflect is both expensive and wrong on this corpus** when the LLM is contended: p01 invents Lit; playbook probes (p11, p15) miss Orto day-to-day retain rules and the missing mental-model gap.
3. **Bank pollution is real**: study material answers p10; Jev dry-run skipping study looks aligned with MCP quality, not just retain thrift.
4. **Mission / in_scope risk remains**: Phase 1 Jev dry-run skipped project ADRs (prior-platform, launch-framework) that p04/p05/p14 show agents can retrieve today. Deleting those would hurt MCP answers even if Jev called them out of scope.
5. **Phase 0.5 (revised):** treat mental models as structural readiness on this host. Do not block the issue on full 7B live refreshes.

## Phase 0.5 (revised approach, 2026-11-22)

### Why the approach changed

Live `orto mental-model refresh` is a full Hindsight reflect over a large bank on local `qwen2.5:7b` with `LLM_MAX_CONCURRENT=1`. Multi-model clear/refresh loops ran for tens of minutes, often stuck or cancelled, and completed refreshes sometimes wrote **empty** content. That cost does not buy Phase 0.5 evidence faster than structural checks plus the Phase 0 recall grades already in hand.

### What landed (structural)

- `orto bank apply` created the three template models in Hindsight: `project-context`, `dev-and-bank-ops`, `career-and-interviews`
- Directives and bank profile updated on `zanuka-web`
- `source_query` can be set via `orto mental-model update --source-query`
- Stuck live refreshes cancelled (including `project-context` op `0c4f8040-…`) so Ollama is free for other work
- Coding-agent banks: `enable_auto_consolidation=false` on `cantiere` / `firstmate` / `strumentario` (host ops; not an Orto product change)

### Refresh / scope diagnosis (no more full live refresh loops)

| Finding | Detail |
|---|---|
| Empty completed refresh | Outcome `content_preserved_no_new_facts` / `reflect_skipped: no_sources_in_scope` |
| Root cause | Default scope used `tags_match: all_strict` with model tags that memories do not all share (e.g. `project` + `docs` + `works`) |
| Fix direction | `--tags-match any` plus tags that exist on memories (`docs`, `works`, `content`, `dev`, `career`, `interviews`) |
| Content today | All three models still `content_len=0` after clears; do not wait on 7B full re-synthesis for this issue |

### Thin p15 re-ask (recall only)

Query: standing zanuka-web project-context question (prefer mental model vs reflect vs recall).

- Tool: `recall`, ~19s (not reflect / not live model refresh)
- Grade: **partial**
- Answer cites study-doc mental-model lore (`prefer pinned models for standing questions`) but cannot read a filled `project-context` model because content is empty
- Implication: routing advice is in the bank; Phase 0.5 “models improve playbook answers” is **not yet measurable** until content is filled on a faster LLM or overnight job

### Phase 0.5 done-when (revised)

- [x] Template models exist in Hindsight
- [x] Scope/tag mismatch diagnosed
- [x] Thin p15 recall graded without a full refresh loop
- [ ] Optional later: one overnight or remote-LLM refresh of `project-context` only, then re-grade p15 by reading the model
- [ ] Optional later: `orto mental-model propose --judge jev --dry-run` (catalog choose), only after one model has real content or as a separate cheap dry-run

## Phase 1: Offline retain-variant score (2026-11-22)

No Hindsight writes. Inputs: zanuka-web `dry-heuristic.out` / `dry-jev.out` (local under `.orto/local/jev-score/`) plus Phase 0 probe grades. Artifact: `phase1-offline.json` (gitignored, same folder).

### Proposed needed set (pending human approve)

Heuristic-kept section ids under paths that Phase 0 probes needed for MCP answers (**124** ids parsed from the heuristic dry-run):

- `src/content/works/` and `docs/content/case-study-update-guide.md` (p02)
- `docs/dev/fly-deployment-guide.md` (p03)
- `docs/projects/prior-platform-ADR.md`, `docs/projects/prior-platform-db-design.md` (p04, p14)
- `docs/projects/*launch-highlights*.md`, `src/content/works/*launch-case-study*.mdx` (p05)
- `docs/dev/hindsight-bank-config.md`, `docs/dev/hindsight-commands.md` (p06)
- `docs/dev/firstmate-architecture.md` (p07)
- `docs/career/*skills*.md` (p08)
- `docs/interviews/interview-elevator-playbook.md` (p09)
- `docs/dev/astro-keel-portfolio-build-plan.md` (p12)
- `docs/dev/ultimate-ai-workflow.md` (p13)

Study paths (`docs/study/`) are treated as **noise** for retain scoring (p10 pollution), not needed.

Parsed heuristic keep set size: **669** unique `orto:…` ids (CLI summary said Would retain **684**; use 669 for coverage math).

### Variant table

| Variant | Bank size (keep) | Needed coverage | Study share of keep | Verdict vs Phase 1 bar |
|---|---:|---:|---:|---|
| Heuristic | 669 | **124/124 (100%)** | 283/669 (42.3%) | Baseline. Passes coverage. Noisy. |
| Jev 0.80 alone | 4 | **2/124 (1.6%)** | 0/4 (0%) | **Out.** Empties the needed set. |
| Heuristic edited by Jev (naive: drop every confident skip) | 516 | **92/124 (74.2%)** | 202/516 (39.1%) | **Out.** Drops 32 needed ids; 29 are `out of scope` on `docs/projects` (prior-platform/launch-framework) and related. |
| Heuristic edited by Jev (mission-aware: only auto-drop confident skips for knowledge-kind noise / ephemeral / PII / secret) | 607 | **121/124 (97.6%)** | 245/607 (40.4%) | **Coverage almost OK**; study share only −1.9pp vs heuristic; bank −9%. Does **not** hit a 20% noise cut offline. Three needed drops are `knowledge kind noise` (one Firstmate “read next” section + two works `contributions`). |

Jev’s four confident retains (for reference): Astro Keel architecture; pstack hybrid-workers note; two ultimate-ai-workflow AXI sections. Two of those sit in the needed path set.

### Reading

1. **Jev alone at 0.80 cannot be the zanuka-web retain gate.** Same pattern as Orto product docs, sharper here.
2. **Naive “delete all confident skips” destroys MCP-needed project ADRs** (p04/p05/p14). Matches Phase 0 implication.
3. **Mission-aware edit** is the only Jev-assisted shape that nearly keeps needed coverage. Offline it only trims study modestly (−38 study sections; study share still ~40%). By the issue’s overall “≥20% noise or recall-token cut” rule, it does **not** win on dry-run size alone.
4. **Phase 2 live A/B is not justified yet** for Jev-alone or naive edit. Mission-aware is optional later only if the operator accepts the 3 edge drops and wants a recall-token measurement on fresh banks.
5. Near-term product learning: feed confident **study / ephemeral / PII** skips into the heuristic; never treat confident **`out of scope` on `docs/projects`** as an automatic delete for this mission.

### Phase 1 done-when

- [x] Needed-set proposal from Phase 0 probes (await human approve)
- [x] Offline variant table posted
- [x] Clear Phase 2 go/no-go: no-go for Jev-alone and naive edit; mission-aware deferred

## Next commands (operator)

Stay in the zanuka-web project root (wherever that checkout lives).
Do not live-seed into bank id `zanuka-web` for retain experiments.
Do not run `mental-model refresh --all` on local 7B as a blocking gate.

```bash
# Approve or edit the needed-set paths in this doc / issue comment.
# Optional cheap side quest:
# orto mental-model propose --judge jev --dry-run
# Optional later Phase 2 only if mission-aware is explicitly greenlit.
```

## Log hygiene

Do not paste private absolute paths or personal interview transcript bodies into this file or the public issue.
Summaries and document id patterns are enough.
