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
- Prune / audit plans for outdated, irrelevant, or contradicted items (including when the file is still on disk)
- Bank-template fitness scores (mission / directives / tags / mental-model questions); prose stays in the template
- MCP `retain` guardrails, recall rerank, still-true checks, `reflect` vs `recall` vs mental-model routing
- Firstmate routing and escalation when confidence is low
- Share / deployment-profile safety before public or Cloud exposure
- Golden-set eval that scores offline heuristics without requiring Jev at runtime

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
Deleting it is prune annotation ([JEV-14](https://github.com/zanuka/orto/issues/32), [JEV-17](https://github.com/zanuka/orto/issues/52)), after you confirm.

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
