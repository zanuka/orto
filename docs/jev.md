# Jev product rule

Jev is an **opt-in judge**, not a memory backend and not a CLI provider.

Orto's job does not change: scan the repo, curate durable knowledge, seed a Hindsight bank, prune stale documents, emit harness config, and apply after confirmation.
Jev answers narrow, typed questions about that work.
Orto keeps every side effect.

**Status:** Product rule for Phase 7 ([JEV-1](https://github.com/zanuka/orto/issues/20)).
Judge port: [JEV-2](https://github.com/zanuka/orto/issues/21) (`src/judge/`, `--judge` / `--confidence` / `--strict` on seed/store/prune).
State sanitization: [JEV-3](https://github.com/zanuka/orto/issues/22) (`buildJevState` before any TypeSafe call).
Relevance gate: [JEV-4](https://github.com/zanuka/orto/issues/30) (`seed --judge jev` before retain).
Knowledge kind ships on that same call.
The contradiction check ships on that same call.
The secret and personal-data second pass ships on that same call.
Citation support ships after that gate, on the facts Hindsight would extract.
Allowlist proposals ship on `store --propose-adopt --judge jev`.
A retain budget ships on `seed --budget N --judge jev`.
The watcher high-signal gate helper ships in `src/judge/watcher-gate.ts`.
There is no `watch` CLI command yet.
`store` edit durability ships on `store --judge jev`.
Prune annotation is still planned.
**Related:** [jev-integration.md](./jev-integration.md) (where it sits), [jev-diagrams.md](./jev-diagrams.md) (store / update flows), [jev-benefits-and-costs.md](./jev-benefits-and-costs.md), [ROADMAP.md](../ROADMAP.md) Phase 7, [JEV-0](https://github.com/zanuka/orto/issues/58).

---

## Job split

| Orto owns | Jev returns |
|---------------|-------------|
| Scan, denylist, extract candidates, content hashes | [Choice](https://docs.typesafe.ai/primitives/choice), [Score](https://docs.typesafe.ai/primitives/score), [Noul](https://docs.typesafe.ai/primitives/noul) |
| Retain, prune, share, MCP I/O, tombstones | Probabilities and confidence |
| Missions, ADRs, MCP snippets, mental-model prose in git | Nothing that writes the bank or the repo |

Code stays in control.
Jev never stores the bank and never authors project docs.

---

## Opt-in only

Enable Jev only when both are present:

- CLI: `--judge jev`
- Env: `ORTO_TYPESAFE_API_KEY` (TypeSafe key)

The Hindsight API key (`ORTO_HINDSIGHT_API_KEY` / `HINDSIGHT_API_KEY`) never implies Jev.
`--provider jev` must not exist.
Hindsight remains the default memory path.

---

## Offline fallback

Without `--judge jev`, the CLI uses offline heuristics and makes no TypeSafe call.

With `--judge jev`:

- Missing `ORTO_TYPESAFE_API_KEY` is a hard error (unset the flag to keep heuristics).
- Network / timeout / 429 / 5xx: warn once and fall back to heuristics for that run.
- Pass `--strict` to fail instead of falling back.

---

## Do not build

| Build | Do not build |
|-------|----------------|
| `Judge` modes: `off` / `heuristic` / `jev` behind `--judge` | `--provider jev` or a Jev memory adapter |
| Confidence gate (`--confidence`) before apply | Silent auto-retain, auto-prune, or auto-share |
| Sanitize state before any TypeSafe call (secrets, denylist, size) | Sending the whole repo or a bank dump as Jev state |
| Point at official TypeSafe docs and [agent skill](https://docs.typesafe.ai/agent-skill) | Vendoring TypeSafe's installer, plugin marketplace, or skill as if Orto owned them |
| Preview keep/skip scores in `seed --dry-run --judge jev` | Jev-generated mission, ADR, MCP, or mental-model prose |
| Annotate prune candidates; delete only after Orto confirm | Auto-delete bank items from a Jev answer alone |

Same installer rule as Graphiti: thin pointers to official URLs, no wrap of their install path.
See [graphiti-integration.md](./graphiti-integration.md) product rule.

---

## What Jev is for

Bounded decisions where a typed answer plus confidence is enough:

- Section relevance and keep/skip before retain (shipped on `seed --judge jev`)
- Knowledge kind on that same call (shipped)
- Contradiction against overlapping observations on that same call (shipped)
- Citation support on the facts Hindsight would extract (shipped on `seed --judge jev`)
- PII / secret second pass (shipped on `seed --judge jev`)
- Store allowlist proposals (shipped on `store --propose-adopt --judge jev`)
- Seed priority and retain budget (shipped on `seed --budget N --judge jev`)
- Watcher high-signal gate (helper shipped; no default `watch` CLI yet)
- `store` edit durability (shipped on `store --judge jev`)
- Audit prune/refresh plans (shipped on `orto audit --judge jev`)
- Layer-specific aging on that plan (shipped)
- Mental-model freshness on that plan (shipped)
- Apply audit plans with confirmation (shipped on `orto prune --apply --plan`)
- Bank-template mission / directives fitness (shipped on `configure --judge jev`)
- Extraction aggressiveness from repo shape (shipped on `configure --judge jev`)
- Mental-model catalog question proposals (shipped on `orto mental-model propose --judge jev`)
- Consistent retain tags for Reflect filters (shipped on `seed --judge jev`)
- MCP `retain` guardrail (helper shipped: `judgeMcpRetain`; agent rules emitted by `orto mcp`)
- Recall rerank / context packing (helper shipped: `judgeRecallRanked` / `packRecallContext`; default recall stays pass-through)
- Recall still-true verification (helper shipped: `judgeRecallVerified`; default off via `ORTO_JEV_RECALL_VERIFY`)
- Lookup routing (helper shipped: `judgeLookupRoute`; default off via `ORTO_JEV_LOOKUP_ROUTE`)
- Needs-bank gate (helper shipped: `judgeNeedsBank`; default off via `ORTO_JEV_NEEDS_BANK`; harness-agnostic; Firstmate snippet also prints the policy)
- Task follow-up gate (helper shipped: `judgeTaskFollowup`; default off via `ORTO_JEV_TASK_FOLLOWUP`; harness-agnostic; Choice `followup` retain_to_bank | pr_only | both)
- Escalate vs dispatch gate (helper shipped: `judgeEscalateDispatch`; default off via `ORTO_JEV_ESCALATE_DISPATCH`; Noul `needs_captain` + Choice `crewmate` from the distro charter list)
- Scout-report seedability (helper shipped: `judgeScoutSeedability`; default off via `ORTO_JEV_SCOUT_SEEDABILITY`; docs point at official TypeSafe agent skill only)
- Multi-bank fact routing (helper shipped: `judgeBankRoute`; default off via `ORTO_JEV_BANK_ROUTE`; single-bank projects keep `in_scope` and never see the prompt)
- Destination-kind router (helper shipped: `judgeDestinationKind`; default off via `ORTO_JEV_DESTINATION_KIND`; Hindsight stays the default; Mem0 and Graphiti only when configured)
- Firstmate-specific routing still planned (which registered project bank)
- Share / deployment-profile safety (helper shipped: `judgeShareSafety` on `orto share --profile public --judge jev` and `hindsight-cloud`; default share stays on Phase 4 checks)
- Golden-set eval (shipped: `pnpm eval:judge` replays recorded answers with no API key and compares heuristic vs Jev vs human labels; `ORTO_EVAL_JUDGE_LIVE=1` is the optional live job)
- Bank drift metric (shipped: `orto status` prints `supported / sampled` and a date; default sample 20, cap 50; judge off is hash-only source present vs missing; `orto audit` includes the same line)

Detail and sequencing: [jev-integration.md](./jev-integration.md) and the Phase 7 checklist in [ROADMAP.md](../ROADMAP.md).

---

## Confidence-gated routing

Choice and Score answers include confidence.
Default `--confidence` is **0.8**.
Orto routes on that score:

- At or above `--confidence`: apply the Orto side effect the operator already authorized (retain, prune selection, share check, Firstmate route).
- Below threshold: dry-run queue, unchecked prune row, or Firstmate captain escalation.
- Never silent apply on low confidence.

Noul answers have no separate confidence field.
The `noul` value is the probability that the answer is yes, from 0 to 1.
`--confidence` is the yes threshold.
A noul at or below `1 - confidence` is a confident no.
A value between those thresholds stays in the dry-run review queue.
The relevance gate skips retain only for a confident reject: ephemeral and not durable, or out of scope.

Pattern reference: [Confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing).

---

## Knowledge kind

`seed --judge jev` asks a `kind` choice in the same call as the relevance gate.
The bins, and the `what` / `not_for` / `examples` for each one, live in `src/judge/knowledge-kinds.json`.
Dry-run prints the chosen kind, its confidence, and the probability of every bin.
`document_id` stays `orto:<path>#<section>`, so a later reclassification still upserts the same document.

A confident `noise` answer is skipped, the same as a relevance reject.
A confident `style_pref` answer is skipped too.
Style preferences can go to a personal memory store later.
They do not enter the company brain.
Other kinds are retained only when that choice meets `--confidence`.
Those items use the tags listed for the kind in the catalog (`knowledge:<kind>`).
A kind below `--confidence` stays in review and is not retained, so the bank does not keep a guessed tag.
Without `--judge jev`, retain tags stay on the offline heuristic labels (`knowledge:decision`, `knowledge:overview`, and the rest).
Starter mental models still filter on those heuristic labels.
`knowledge:architecture` and `knowledge:standard` match the taxonomy ids of the same name.
`knowledge:adr` does not match a model that only lists `knowledge:decision`.

The same relevance call also asks three retain-tag Choices (`layer`, `domain`, `stability`).
Confident answers compose into additional tags such as `layer:platform`, `domain:engineering`, and `stability:frozen`.
The vocabulary is versioned in `src/judge/retain-tags.json` and documented in [retain-tags.md](./retain-tags.md).
Low-confidence axes are omitted; they do not invent tags.

---

## Contradiction check

`seed --judge jev` recalls up to 5 overlapping observation summaries before the same judge call.
The recall is read-only.
Dry-run does not retain and does not delete.
If recall fails, including a first seed before the bank exists, Orto warns once and continues without the relation question.

When one to three observations have ids, the call asks one `relation` choice: `supports`, `extends`, `supersedes`, `contradicts`, or `unrelated`.
A confident `supersedes` or `contradicts` answer retains the section once and records those observation ids on the retain metadata (`supersedes` or `contradicts`).
`supports`, `extends`, and `unrelated` retain the section normally, with no extra item and no observation metadata.
A relation below `--confidence` does not stamp that metadata.

Four or five observations are too many for one choice to name each id.
Each one gets a `conflicts_with_<n>` noul instead.
A confident yes records that id as `contradicts`.
A confident no, or an uncertain score, adds no metadata for that id.

The old observation stays in the bank.
`orto audit --judge jev` can propose delete or supersede ([JEV-14](https://github.com/zanuka/orto/issues/32)).
Deleting waits on `orto prune --apply --plan ... --allow-delete` ([JEV-17](https://github.com/zanuka/orto/issues/52)).

---

## Secret and personal data

The same `seed --judge jev` call asks `contains_secret` and `contains_pii`.
A high score means the section is unsafe.
A confident secret is a hard skip.
The stderr warning names the path and does not print the secret.
A confident personal-data answer is also skipped.
There is no `--allow-pii` flag.
A score between `--confidence` and `1 - confidence` stays in review and is not retained.
A local match for an `sk-` token or a PEM private-key block skips before any TypeSafe call, so that text is not sent.
A clean ADR is not flagged ([JEV-8](https://github.com/zanuka/orto/issues/39)).

---

## Citation support

After the relevance gate, `seed --judge jev` asks Hindsight to preview the facts it would extract from each section that is still going to be retained.
That preview is `dry-run-extract`.
It does not persist anything.
One Jev call per section asks `supported_by_source_<n>` and a `support_<n>` choice (`quoted`, `implied`, `unsupported`) for those facts together.
A high-confidence `unsupported` answer is not retained.
A confident "no" on the noul is not retained either.
A quote or a direct implication at or above `--confidence` is kept.
A mid-range answer stays in review, and that fact is not retained.
Retain sends the kept fact text, so an unsupported claim is absent from the payload.
Hindsight extracts again from that filtered text.
This is a check on the Hindsight extractor, not a second extractor.
At most 12 facts are judged in that call.
Further facts stay in review.
If the preview returns no facts, or the preview fails, the section is retained as written.
A fact that matches a secret pattern is dropped and is not sent to Jev.
The log redacts that fact.
`document_id` stays `orto:<path>#<section>`.
Dry-run may run this preview and still must not retain or write the manifest ([JEV-9](https://github.com/zanuka/orto/issues/40)).

---

## Allowlist proposals

`store --propose-adopt --judge jev` looks at durable files that are not on `store.allowlist` yet.
One Jev call per file asks `should_adopt` and the same knowledge `kind` used at seed time.
A confident durable kind is printed as a proposal.
A confident `noise` or `style_pref`, or a confident no on `should_adopt`, is not proposed.
A dependency readme and markdown outside the durable scan are not considered.
The allowlist changes only when you pass `--apply`.
That write does not retain.
Default `store` still never adopts a new file on its own ([JEV-10](https://github.com/zanuka/orto/issues/41)).

---

## Retain budget

`seed --budget N --judge jev` ranks the sections that survived the relevance gate and retains the top N this run.
The rest stay pending in `.orto/local/seed-manifest.json`.
The next seed judges those pending sections again.
Dry-run prints the ordered queue and a cutoff, and it does not retain or write the manifest.
Without `--budget`, seed still retains every section the gate keeps.

Jev supplies the atomic scores.
Orto combines them.
The same judge call already returns `durability` (0 ephemeral through 4 constitutional).
When `--budget` is set, that call also asks `centrality` (0 buried note through 4 ADR, AGENTS.md, or constitutional standard), `agent_fanout` (0 none through 4 shared context), and the noul `supersedes_existing`.
`secret_risk` is the higher of `contains_secret` and `contains_pii`.
It is not a separate model weight.

Each score is scaled to 0 through 1 (`durability`, `centrality`, and `agent_fanout` are divided by 4).
The noul and `secret_risk` are already 0 through 1.
Missing answers count as 0.
The formula is:

```text
priority = w1*durability + w2*centrality + w3*supersession + w4*fanout - w5*secret_risk
```

Weights live in `.orto/config.json` under `judge.priorityWeights`.
They are not chosen by the model.
When the block is omitted, the defaults are:

| Weight | Key | Default |
|--------|-----|---------|
| w1 | `durability` | 0.40 |
| w2 | `centrality` | 0.30 |
| w3 | `supersession` | 0.15 |
| w4 | `fanout` | 0.15 |
| w5 | `secretRisk` | 0.25 |

A changed ADR, with high durability and centrality, ranks above a wording-only changelog.
Ties break by source path, then document id.
`--budget` requires `--judge jev`.
`N` is a positive integer ([JEV-11](https://github.com/zanuka/orto/issues/50)).

---

## Watcher high-signal gate

A future file watcher will fire often.
Jev answers whether that change should enqueue a seed, so Orto does not retain on every typo.

`judgeWatcherGate` in `src/judge/watcher-gate.ts` takes the previous and current text for one durable path.
One call asks:

- Noul `durable_claim_changed`: did the durable claim change, or is the edit only wording or formatting?
- Score `behavior_delta` (0 none through 4 agents must see the new claim): how much agent behavior changes if we skip re-seed today.

A confident no on the claim is a skip.
Whitespace-only edits are skipped locally before any TypeSafe call.
A confident yes with `behavior_delta` at or above 3, and score confidence at or above `--confidence`, enqueues a real seed for that path via `collectSeedEnqueue` in `src/watcher/`.
Mid-range answers stay in review.
A secret match is skipped and is not sent to Jev.

There is no `orto watch` command on the default CLI.
Phase 8 can wire an event loop to this helper.
Until then, tests cover the gate with fixtures ([JEV-13](https://github.com/zanuka/orto/issues/42)).

---

## Store edit durability

`store --judge jev` gates changed allowlisted files before retain.
One Jev call per changed path asks:

- Noul `claim_changed`: durable meaning changed vs wording or formatting only
- Noul `looks_like_workaround`: temporary hack, "revert this", or "TODO undo"
- Choice `action`: `re_retain`, `skip`, or `review`

A confident wording-only answer skips retain.
The content hash still updates under `.orto/local/seed-manifest.json` so the same edit does not loop.
A confident workaround stays in review and is not retained.
A confident claim change that is not a workaround re-retains.
Previous text comes from `.orto/local/retained-sources.json` after an earlier store, or from a test override.
Without previous text, store retains as today.
Without `--judge jev`, store is unchanged ([JEV-12](https://github.com/zanuka/orto/issues/31)).

---

## Audit plan

`orto audit --judge jev` writes a prune/refresh plan for retained bank documents.
One Jev call per document asks:

- Noul `still_supported_by_repo`
- Noul `superseded`
- Choice `action`: `keep`, `refresh_mental_model`, `supersede`, `archive`, or `delete_candidate`

State is a small object: id, text, source-still-exists, optional file excerpt, bank mission.
Items are batched with `--limit`.
The whole bank is never dumped into one request.
Live runs write `.orto/local/audit-plan.json` (gitignored) and print a table with id, action, confidence, and a reason built from the answers.
`--dry-run` prints the table only.
The bank is never mutated.
Missing `ORTO_TYPESAFE_API_KEY` is a hard error ([JEV-14](https://github.com/zanuka/orto/issues/32)).

### Apply audit plan

`orto prune --plan .orto/local/audit-plan.json` previews high-confidence allowed actions and mutates nothing.
`orto prune --apply --plan .orto/local/audit-plan.json` executes them ([JEV-17](https://github.com/zanuka/orto/issues/52)):

- `refresh_mental_model` calls the Hindsight mental-model refresh path
- `archive` tombstones document ids locally (no delete)
- `supersede` records provenance under `.orto/local/audit-supersedes.json` and deletes only with `--allow-delete`
- `delete_candidate` deletes only with `--allow-delete`
- Low-confidence and `reviewOnly` rows stay skipped
- A plan whose ids are missing from the current bank is refused as stale
- Re-applying the same plan is idempotent via `.orto/local/audit-plan-applied.json`

### Layer-specific aging

Hindsight layers age differently.
After Jev answers, the audit planner biases the action by layer ([JEV-15](https://github.com/zanuka/orto/issues/43)):

| Layer | Default bias |
|-------|--------------|
| World / experience | Archive when the source is gone, or when the content hash changed and `still_supported_by_repo` is low |
| Observation | Supersede (mark) when proof-count is low and a contradicting candidate exists |
| Mental model / knowledge page | Prefer `refresh_mental_model` over `delete_candidate` (Reflect reads these first). Freshness questions can still propose `archive`. |
| Document (`orto:<path>#<section>`) | Keep for re-retain when the section was rewritten; archive when the source file is gone |

Reasons include `layer=<layer>` and, when a bias applied, `aging=<rule>`.
Today's `orto audit` lists bank mental models (freshness path) then documents (document-layer signals: source gone, hash mismatch, section rewritten).
World, experience, and observation rows stay on the same aging planner for when those inventories are wired in.

### Mental-model freshness

Pinned mental models and knowledge pages get dedicated questions ([JEV-16](https://github.com/zanuka/orto/issues/51)):

- Noul `model_still_answers_source_query`
- Noul `new_evidence_since_refresh` (state includes recent observation summaries)
- Choice `action`: `leave`, `refresh`, `retarget_query`, or `archive`

`refresh` becomes plan action `refresh_mental_model` and never proposes delete.
`retarget_query` is review-only: the plan records it with `reviewOnly`, and Orto does not rewrite the source query in this step.
`leave` maps to `keep`. `archive` maps to `archive`.

---

## Mission and directives fitness

`orto configure --judge jev` scores the generated bank template against the repo ([JEV-18](https://github.com/zanuka/orto/issues/23)):

- Score `mission_fit` (0 generic or wrong through 3 specific and true)
- Noul `directives_conflict_with_docs`

Jev does not write mission or directive prose.
A low `mission_fit` (0 or 1) at or above `--confidence` prints `review mission before applying` and skips the template write unless `--yes`.
Default `configure` without `--judge jev` is unchanged.

---

## MCP retain guardrail

`judgeMcpRetain` in `src/judge/mcp-retain.ts` gates mid-session Hindsight `retain` attempts ([JEV-22](https://github.com/zanuka/orto/issues/44)).

One call asks:

- Noul `is_durable_project_knowledge`
- Noul `is_session_fluff` (chat, diffs, "I just tried X")
- Choice `action`: `allow`, `deny`, or `suggest_seed_instead`

Policy:

- Default deny on fluff or low confidence
- Confident allow only when `action=allow` and durability is a confident yes
- `suggest_seed_instead` denies MCP retain and tells the agent to use `orto seed` / `orto store`
- When the judge is off (or Jev falls back), `heuristicDenyMcpRetain` still denies chat-shaped payloads and allows clear ADR-shaped markdown

`orto mcp --write-agents` / `--write-cursor-rules` emit the same policy so agents do not treat MCP retain as a scratch pad.
Orto does not host the Hindsight MCP server; harnesses and proxies call this helper before forwarding retain.

---

## Recall context packing

`judgeRecallRanked` and `packRecallContext` in `src/judge/recall-rank.ts` rerank recalled passages before a harness stuffs them into context ([JEV-23](https://github.com/zanuka/orto/issues/25)).

Default path is pass-through:

- No TypeSafe call
- Input order preserved
- No low-score drops
- Raw MCP `recall` stays unchanged unless a harness opts in

Opt in with `rank: true` (and a Jev judge when available). One batched call scores `relevance_to_task` per passage (0-4). Confident scores below `minRelevance` (default 2) are omitted from the packed string. When the judge is off, or Jev falls back, token-overlap heuristics still drop obvious noise.

Benchmark note: unranked packing is local and roughly free. Ranked packing adds one TypeSafe round-trip for the batch (typically hundreds of milliseconds plus a few thousand tokens), not one call per passage. Prefer Hindsight's native typesafe reranker for server-side listwise ranking when available; use this helper when the harness already holds passages and needs confidence-gated drops plus a char budget.

`formatRecallRankLines` prints keep/drop rows and `latency: Nms vs unranked recall` for dry-run review.

---

## Recall still-true verification

`judgeRecallVerified` in `src/judge/recall-verify.ts` annotates recalled passages when the on-disk source no longer supports the claim ([JEV-24](https://github.com/zanuka/orto/issues/45)).

Default path is pass-through:

- Off unless `verify: true` or `ORTO_JEV_RECALL_VERIFY=1` (`NOCCIOLO_JEV_RECALL_VERIFY` alias)
- No TypeSafe call
- `stale` stays false
- Raw MCP `recall` stays unchanged

When enabled, one batched call asks Noul `still_true_given_current_excerpt` per passage (with the recalled text and current excerpt). A confident no marks `stale: true` in the harness tool result so agents do not act on a superseded ADR that has not been pruned yet. Missing source files mark stale / skip verify and never crash recall. Secrets skip the TypeSafe send.

Harnesses that already hold passages can pre-fill `currentExcerpt` / `sourceStillExists`, or pass `projectRoot` so Orto loads the excerpt via `loadCurrentExcerptForDocumentId`.

`formatRecallVerifyLines` prints stale rows and `latency: Nms vs unverified recall`.

---

## Lookup routing

`judgeLookupRoute` in `src/judge/lookup-route.ts` chooses which Hindsight tool a harness should call for an agent question ([JEV-25](https://github.com/zanuka/orto/issues/26)).

Default path is pass-through:

- Off unless `route: true` or `ORTO_JEV_LOOKUP_ROUTE=1` (`NOCCIOLO_JEV_LOOKUP_ROUTE` alias)
- No TypeSafe call
- Verdict stays `unset`
- Default MCP `reflect`, `recall`, and mental-model tools remain separate

When enabled, one Choice `lookup` asks `mental_model` | `reflect` | `recall` given the question and known model titles. The harness then calls the matching Hindsight API. Jev does not synthesize the answer.

Heuristic fallback (judge off or low confidence):

- Standing question that matches a pinned model title → `mental_model`
- One-off factual lookup → `recall`
- Why/how synthesis → `reflect`

`formatLookupRouteLines` prints the chosen route and `latency: Nms vs unrouted lookup`.

---

## Needs project bank?

`judgeNeedsBank` in `src/judge/needs-bank.ts` decides whether an agent task needs the project bank ([JEV-26](https://github.com/zanuka/orto/issues/27)).

This is a harness-agnostic helper. Claude Code, Codex, Cursor, Pi, and other popular agentic workflows can call it before recall, reflect, or attaching bank context. Firstmate and custom orchestrators use the same API. Jev does not run the coding agent; it only answers the gate question.

Default path is pass-through:

- Off unless `needsBank: true` or `ORTO_JEV_NEEDS_BANK=1` (aliases: `ORTO_JEV_FIRSTMATE_NEEDS_BANK`, `NOCCIOLO_JEV_NEEDS_BANK`)
- No TypeSafe call
- Verdict stays `unset`
- Existing MCP / harness flows keep working with the judge off

When enabled, one Noul `needs_project_bank` scores the task request (default `--confidence 0.8`):

| Band | Verdict | Harness behavior |
|------|---------|------------------|
| Confident no | `skip_bank` | Skip recall/reflect; do not attach bank context; treat as pure code |
| Confident yes | `use_bank` | May recall/reflect / attach bank context |
| Uncertain | `escalate` | Ask the operator; do not guess |

`orto mcp` prints these policy notes on Cursor, Claude Code, Codex, Pi, Kiro, and Firstmate snippets. `orto mcp --write-agents` / `--write-cursor-rules` also mention the optional gate. Do not embed TypeSafe keys in the repo; wire `ORTO_TYPESAFE_API_KEY` in the harness environment when enabling the gate.

`formatNeedsBankLines` prints the verdict and `latency: Nms vs ungated request`.

---

## Task follow-up (retain vs PR vs both)

`judgeTaskFollowup` in `src/judge/task-followup.ts` chooses post-task follow-up after a PR, merge, or task summary ([JEV-28](https://github.com/zanuka/orto/issues/34)).

This is a harness-agnostic helper. Claude Code, Codex, Cursor, Pi, and other popular agentic workflows can call it after work lands. Firstmate and custom orchestrators use the same API. Jev does not open the PR or retain; it only answers the Choice.

Default path is pass-through:

- Off unless `followup: true` or `ORTO_JEV_TASK_FOLLOWUP=1` (aliases: `ORTO_JEV_FIRSTMATE_FOLLOWUP`, `NOCCIOLO_JEV_TASK_FOLLOWUP`)
- One Choice `followup` with bins `retain_to_bank` | `pr_only` | `both` (default `--confidence 0.8`)

| Verdict | Meaning |
|---------|---------|
| `retain_to_bank` | Queue `orto store` / `orto seed` for durable docs/ADRs; never MCP-retain |
| `pr_only` | Ship the PR only; no bank retain queue |
| `both` | Ship the PR and queue store/seed for durable knowledge that also changed |
| `escalate` | Ask the operator; below threshold or ambiguous |
| `unset` | Gate off; no routing policy applied |

Heuristics (when Jev is off or falls back): ADR/standards merges prefer `retain_to_bank` or `both`; pure bugfix PRs prefer `pr_only`.

`orto mcp` prints these policy notes on Cursor, Claude Code, Codex, Pi, Kiro, and Firstmate snippets. `orto mcp --write-agents` / `--write-cursor-rules` also mention the optional gate. Do not embed TypeSafe keys in the repo.

`formatTaskFollowupLines` prints the verdict and `latency: Nms vs ungated followup`.

---

## Escalate vs dispatch

`judgeEscalateDispatch` in `src/judge/escalate-dispatch.ts` chooses whether a multi-agent harness should escalate a task to the captain/operator or dispatch it to a listed worker charter ([JEV-29](https://github.com/zanuka/orto/issues/35)).

This helper is for multi-agent workflows. Firstmate is the primary consumer; Claude Code, Codex, Cursor, Pi, and custom orchestrators can call the same API when they have a captain + worker charter list. Jev does not spawn agents; it only answers the gate questions.

Default path is pass-through:

- Off unless `dispatch: true` or `ORTO_JEV_ESCALATE_DISPATCH=1` (aliases: `ORTO_JEV_FIRSTMATE_DISPATCH`, `NOCCIOLO_JEV_ESCALATE_DISPATCH`)
- One call asks Noul `needs_captain` and Choice `crewmate` (default `--confidence 0.8`)
- Crewmate criteria come only from the provided charter ids, plus always-present `ask_captain`
- Empty or missing charter list → only `ask_captain` (never invent crewmates)

| Verdict | Meaning |
|---------|---------|
| `escalate` | Ask the captain/operator (`crewmate` = `ask_captain`) |
| `dispatch` | Dispatch to a listed charter id |
| `unset` | Gate off; no routing policy applied |

Heuristics (when Jev is off or falls back): architecture-invariant / decision work escalates; typo / test-fix can dispatch to a listed implementer-like charter.

`orto mcp` prints these policy notes on Cursor, Claude Code, Codex, Pi, Kiro, and Firstmate snippets. `orto mcp --write-agents` / `--write-cursor-rules` also mention the optional gate. Do not embed TypeSafe keys in the repo.

`formatEscalateDispatchLines` prints the verdict and `latency: Nms vs ungated escalate/dispatch`.

---

## Scout-report seedability

`judgeScoutSeedability` in `src/judge/scout-seedability.ts` decides whether a scout/investigation report is durable enough to queue into `orto store` / `orto seed` ([JEV-30](https://github.com/zanuka/orto/issues/46)).

Typical path shape is `data/<id>/report.md` (Firstmate scout output). Other harnesses that land investigation reports can call the same helper. Jev does not retain; a `seed` verdict means queue Orto's normal seed/store path (never MCP-retain).

Default path is pass-through:

- Off unless `scoutSeed: true` or `ORTO_JEV_SCOUT_SEEDABILITY=1` (aliases: `ORTO_JEV_FIRSTMATE_SCOUT_SEED`, `NOCCIOLO_JEV_SCOUT_SEEDABILITY`)
- One call asks Noul `is_durable_scout_report`, Noul `is_scratch_pad`, and Choice `action` (`seed` | `skip` | `review`) at default `--confidence 0.8`

| Verdict | Meaning |
|---------|---------|
| `seed` | Durable findings; queue `orto store` / `orto seed` |
| `skip` | Scratch pad or secret-bearing; do not seed |
| `review` | Ask the captain/operator |
| `unset` | Gate off; no policy applied |

Heuristics (when Jev is off or falls back): ADR/architecture/decision-shaped findings prefer `seed`; WIP/TODO/transcript scratch prefers `skip`; mixed or short reports prefer `review`. Paths that are not `data/<id>/report.md` stay in `review`.

`orto mcp` prints these policy notes on Cursor, Claude Code, Codex, Pi, Kiro, and Firstmate snippets. `orto mcp --write-agents` / `--write-cursor-rules` also mention the optional gate.

`formatScoutSeedabilityLines` prints the verdict and `latency: Nms vs ungated scout seedability`.

---

## Firstmate + TypeSafe skill

Captains who want TypeSafe's official agent skill for Claude Code or Codex should follow TypeSafe's own install steps.

- Official skill doc: [https://docs.typesafe.ai/agent-skill.md](https://docs.typesafe.ai/agent-skill.md)
- HTML overview: [https://docs.typesafe.ai/agent-skill](https://docs.typesafe.ai/agent-skill)

Orto must not wrap TypeSafe's marketplace, plugin installer, or skill package.
Point at those URLs only.
Do not vendor their skill into this repo.
Wire `ORTO_TYPESAFE_API_KEY` in the harness environment when using Jev; never commit keys.

Same installer rule as Graphiti: thin pointers to official URLs, no wrap of their install path.

---

## Multi-bank fact routing

`judgeBankRoute` in `src/judge/bank-route.ts` chooses which configured company-brain bank a section belongs in ([JEV-32](https://github.com/zanuka/orto/issues/47)).

Single-bank projects never see this prompt. Seed keeps using `in_scope` from the relevance gate ([JEV-4](https://github.com/zanuka/orto/issues/30)).

When two or more banks are configured:

- Off unless `routeBanks: true` or `ORTO_JEV_BANK_ROUTE=1` (`NOCCIOLO_JEV_BANK_ROUTE` alias)
- One Choice `bank` whose criteria are the configured bank ids plus `current` and `ask` (default `--confidence 0.8`)
- Never invent bank ids

| Verdict | Meaning |
|---------|---------|
| `route` + `current` | Seed the current bank |
| `route` + other bank id | Do not seed the current bank. Queue the section for that bank |
| `ask` | Operator picks. Do not guess |
| `unset` | Gate off, or fewer than two banks |

A design-token section with banks `billing-service` and `design-system` routes to `design-system` and sets `seedCurrent` false.

This helper does not open a second retain client. Writing into the other bank waits on the Phase 8 multi-bank seed CLI.

`formatBankRouteLines` prints the verdict and `latency: Nms vs ungated bank route`.

---

## Destination kind

`judgeDestinationKind` in `src/judge/destination-kind.ts` chooses the kind of knowledge, then the provider that kind uses ([JEV-31](https://github.com/zanuka/orto/issues/55)).

This landed after `judgeBankRoute` ([JEV-32](https://github.com/zanuka/orto/issues/47)). They compose. Destination kind runs first. Bank routing runs only when the resolved provider is still Hindsight (`routeHindsightBank`).

| Kind | Provider |
|------|----------|
| `institutional` | Hindsight (default) |
| `personal_preference` | Mem0, when configured |
| `temporal_episode` | Graphiti, when configured |

The Choice is the kind, not a vendor name.

- Off unless `destinationKind: true` or `ORTO_JEV_DESTINATION_KIND=1` (`NOCCIOLO_JEV_DESTINATION_KIND` alias)
- Default `--confidence 0.8`
- An ADR stays `institutional` on Hindsight
- A style preference can select Mem0 when that provider is in the configured list (the stand-in for `--provider mem0`)
- If the chosen kind's provider is not configured, the helper defaults to Hindsight, sets `warning`, and does not throw

Mem0 and Graphiti seed adapters are not wired yet. This helper only decides the route.

`formatDestinationKindLines` prints the kind, the provider, any warning, and `latency: Nms vs ungated destination kind`.

---

## Share safety

`judgeShareSafety` in `src/judge/share-safety.ts` runs before Orto writes a public or Cloud profile ([JEV-33](https://github.com/zanuka/orto/issues/56)).

`orto share --profile public --judge jev` and `orto share --profile hindsight-cloud --judge jev` ask, in one call:

- Noul `safe_outside_trusted_network`
- Noul `leaks_internal_urls_or_customers`
- Score `sensitivity` from 0 to 3
- Choice `profile_ok`: `local_only` | `vpn` | `public_ok`

Orto applies the profile. Jev does not publish.

An internal runbook that names a private hostname cannot pass `public_ok`, even when the Choice is confident. A public-by-design standards doc can. A refused public profile is not written.

`orto share` without `--judge` keeps the Phase 4 profile checks only (required base URL, localhost rule, Cloud URL). It does not call TypeSafe.

---

## Golden-set eval

`pnpm eval:judge` scores the offline keep/skip heuristics against a human-labeled fixture ([JEV-34](https://github.com/zanuka/orto/issues/48)).

The fixture lives in `src/judge/golden-set.ts`.
Each section has a human `keep` or `skip`, a kind, and recorded Jev answers.
`pnpm test` replays those answers.
No `ORTO_TYPESAFE_API_KEY` is required.

The report has three columns: label, heuristic, and Jev.
When the label and Jev agree and the heuristic does not, the finding says to tune the offline heuristic.
Jev is the yardstick for the eval.
It is not a production dependency, and seed still runs with no key.

`ORTO_EVAL_JUDGE_LIVE=1 pnpm eval:judge` is the optional live job.
It calls TypeSafe on the same fixture and prints heuristic vs live Jev vs labels.
Without that env var, the job replays the recorded answers.

A security heading that states a coding standard is kept.
A security mailbox, changelog, install, and quick start stay skipped, including a changelog that says "we decided".

---

## Bank drift

`orto status` prints a health line for a bounded sample of bank memories ([JEV-35](https://github.com/zanuka/orto/issues/49)).

The line is `Drift: supported/sampled supported (percent) as of YYYY-MM-DD`.
The default sample is 20. The cap is 50.
Status reads one Hindsight document page of that size.

With the judge off, support means the source file is still in the repo.
With `--judge jev`, support means `still_supported_by_repo` is confidently yes.
`orto audit` prints the same line for its document sample and stores `drift` on the plan.
Neither command deletes or retains.

---

## Extraction aggressiveness

`orto configure --judge jev` also chooses how hard retain should dig ([JEV-19](https://github.com/zanuka/orto/issues/24)).

State is a compact durable-source snapshot (readme / docs / ADR counts, docs byte total, whether an ADR tree exists), not the full repo tree.

One Choice `extraction`:

| Choice | Hindsight `retain_extraction_mode` | Typical shape |
|--------|--------------------------------------|---------------|
| `conservative` | `concise` | Tiny library with one README |
| `standard` | `verbose` | Moderate docs, small ADR set |
| `greedy` | `verbatim` | Dense `docs/adr` tree |

The choice is written to `.orto/config.json` as `bankTemplate.extraction`.
Operators override with `--extraction <mode>` or by editing that field.
An override skips the Jev extraction question.
Low-confidence Jev answers fall back to the same snapshot heuristic used in tests.
Jev does not author mission or directive prose.

---

## Mental-model catalog proposals

`orto mental-model propose --judge jev` picks which standing questions to pin ([JEV-20](https://github.com/zanuka/orto/issues/53)).

Titles and `source_query` strings live in an Orto catalog (auth, module boundaries, release process, starters, and related topics).
Jev only answers noul `should_propose` for each entry that is not already declared in `.orto/hindsight/bank-template.json`.
State is the catalog entry plus a compact repo snapshot (and a short README excerpt when present).

Confident yes prints a proposal shaped as `{ title, source_query, kind, confidence }`.
Mid-range answers stay in review.
Confident no is skipped.
Without `--apply`, nothing is created in Hindsight.
With `--apply`, operators multi-select proposals in a TTY (or pass `--yes` / `--ids`) and Orto creates those models with catalog tags, optionally writing `bank-template.json`.

---

## State budget

`buildJevState` in `src/judge/` is the only supported way to fill TypeSafe `state`.
[JEV-3](https://github.com/zanuka/orto/issues/22).

Send only:

- the candidate section excerpt
- its path and heading
- the bank mission when the question needs it
- at most 5 overlapping observation summaries

Do not send the full repo tree, a full file, a bank export, a git patch, or MCP conversation logs.

Two local checks run before any HTTP body is built:

- Denylist: reuse `src/scanner/sensitive.ts`. If a path is not seedable, it is not judgeable.
- Inline secrets: a token, private key, credential connection string, or assignment-shaped API key skips the section before the TypeSafe call. The warning names the path and does not include the secret. The Noul questions `contains_secret` and `contains_pii` ([JEV-8](https://github.com/zanuka/orto/issues/39)) run only on text that already passed this gate.

Jev allows 32k tokens for state plus the longest question.
The builder reserves 8k tokens for questions and caps state at 24k tokens, counted as 4 characters per token (96k characters).
Field caps are tighter: section 6k characters, mission 1.2k, each overlap summary 400.
`JevJudge` refuses to POST a payload that fails these checks.
Info logs record the path and question ids.
Debug logs (`ORTO_LOG_LEVEL=debug`) record field names and lengths.
Section text and the request body are not logged.

---

## TypeSafe pointers

- [Introduction](https://docs.typesafe.ai/introduction)
- [System One](https://docs.typesafe.ai/concepts/system-one)
- [Primitives (Choice / Score / Noul)](https://docs.typesafe.ai/primitives)
- [Confidence](https://docs.typesafe.ai/confidence)
- [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)
- [Models](https://docs.typesafe.ai/models)
- [Agent skill](https://docs.typesafe.ai/agent-skill) (official; do not vendor)
