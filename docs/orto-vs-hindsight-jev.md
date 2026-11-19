# Orto + Jev vs Vanilla Hindsight + Jev Reranker

**Audience:** developers evaluating Orto’s optional Jev judgment layer  
**Related:** [why-orto.md](./why-orto.md), [jev-benefits-and-costs.md](./jev-benefits-and-costs.md), [JEV-0 epic](https://github.com/zanuka/orto/issues/58), Hindsight 0.10.1 release notes  
**As of:** 25 October 2026

Hindsight’s Jev support (0.10.1+) is a strong, opt-in *recall* reranker. Orto’s planned Jev layer is complementary and mostly upstream of that: it decides *what is worth putting in the bank* (and related gates), while Hindsight’s Jev ranks *what is already retrieved*.

---

## Hindsight’s Jev reranker (0.10.1+)

- **Scope**: Recall only. Set `HINDSIGHT_API_RERANKER_PROVIDER=typesafe` (optional prune via `HINDSIGHT_API_RERANKER_TYPESAFE_PRUNE_CANDIDATES=true`). Default remains the local MiniLM cross-encoder.
- **Mechanism**: Listwise Choice: one request with the whole candidate pool as options. Probabilities sum to 1 and become the ranking. (Per-candidate Noul was tried and rejected; relative judgment is better and far cheaper.) Optional second Score question cuts the ranked shortlist where relevance ends (no "nothing" escape hatch). Prune is off by default and caps results at ~12.
- **Results** (LoCoMo, gold = dataset evidence turns, vs local MiniLM):
  - 30 candidates: recall@1 0.950 vs 0.800, NDCG@10 0.957 vs 0.850, ~0.027 s vs 0.12 s per query.
  - Larger pools widen the gap.
- **Limits**: Hosted only (sends candidate text to TypeSafe). Scores are ranks within a pool, not absolute confidences. No effect on retain, reflect, extraction, or bank hygiene. Prune trades some gold evidence for precision.

Source posts: [What’s new in Hindsight 0.10.1](https://hindsight.vectorize.io/blog/2026/09/21/version-0-10-1), [We Added Jev as a Reranker](https://hindsight.vectorize.io/blog/2026/09/24/adding-jev-reranker-what-we-learned).

---

## Orto’s planned Jev layer (Phase 7 / JEV issues)

Jev is an **opt-in judge** (`--judge jev` or key) for bounded decisions. Orto owns scanning, side effects, and apply; Jev returns typed Choice/Score/Noul + confidence. Offline heuristics remain the default (zero TypeSafe calls).

**Already closed (JEV-1 through JEV-10)**: product rules, judge interface and offline fallback, state sanitization, relevance gate before retain, section-level keep/skip, knowledge kind, the contradiction check, the secret / personal-data check, citation support, and store allowlist proposals.

**Open / planned areas** (grouped):

- Seed quality: knowledge-kind, contradiction vs existing observations, the secret / personal-data check, and citation support are on `seed --judge jev`.
- Store: allowlist proposals are on `store --propose-adopt --judge jev` ([JEV-10](https://github.com/zanuka/orto/issues/41)). `seed --budget N --judge jev` ranks the retain queue ([JEV-11](https://github.com/zanuka/orto/issues/50)). `store --judge jev` gates wording-only edits and workarounds ([JEV-12](https://github.com/zanuka/orto/issues/31)). The watcher high-signal gate helper ships ([JEV-13](https://github.com/zanuka/orto/issues/42)); there is no default `watch` CLI.
- Audit plan ships on `orto audit --judge jev` ([JEV-14](https://github.com/zanuka/orto/issues/32)). Layer-specific aging ships on that planner ([JEV-15](https://github.com/zanuka/orto/issues/43)). Mental-model freshness ships on audit ([JEV-16](https://github.com/zanuka/orto/issues/51)). Apply-with-confirm ships on `orto prune --apply --plan` ([JEV-17](https://github.com/zanuka/orto/issues/52)).
- Bank-template mission/directives fitness ships on `configure --judge jev` ([JEV-18](https://github.com/zanuka/orto/issues/23)). Extraction aggressiveness from repo shape ships on the same command ([JEV-19](https://github.com/zanuka/orto/issues/24)). Mental-model catalog proposals ship on `orto mental-model propose --judge jev` ([JEV-20](https://github.com/zanuka/orto/issues/53)). Consistent retain tags (`layer` / `domain` / `stability`) ship on `seed --judge jev` ([JEV-21](https://github.com/zanuka/orto/issues/54)).
- MCP `retain` guardrail helper ships (`judgeMcpRetain`) with agent-rule emission ([JEV-22](https://github.com/zanuka/orto/issues/44)). Recall rerank / context packing ships as `judgeRecallRanked` / `packRecallContext` ([JEV-23](https://github.com/zanuka/orto/issues/25)); default MCP `recall` stays pass-through. Recall still-true verification ships as `judgeRecallVerified` ([JEV-24](https://github.com/zanuka/orto/issues/45)); default off via `ORTO_JEV_RECALL_VERIFY`. Lookup routing ships as `judgeLookupRoute` ([JEV-25](https://github.com/zanuka/orto/issues/26)); default off via `ORTO_JEV_LOOKUP_ROUTE`.
- Needs-bank gate ships as harness-agnostic `judgeNeedsBank` ([JEV-26](https://github.com/zanuka/orto/issues/27)); default off via `ORTO_JEV_NEEDS_BANK`. Claude Code, Codex, Cursor, Pi, and other MCP snippets document it. Task follow-up ships as `judgeTaskFollowup` ([JEV-28](https://github.com/zanuka/orto/issues/34)); default off via `ORTO_JEV_TASK_FOLLOWUP`. Escalate vs dispatch ships as `judgeEscalateDispatch` ([JEV-29](https://github.com/zanuka/orto/issues/35)); default off via `ORTO_JEV_ESCALATE_DISPATCH`. Scout-report seedability ships as `judgeScoutSeedability` ([JEV-30](https://github.com/zanuka/orto/issues/46)); default off via `ORTO_JEV_SCOUT_SEEDABILITY`; docs point at TypeSafe's official agent skill only. Multi-bank fact routing ships as `judgeBankRoute` ([JEV-32](https://github.com/zanuka/orto/issues/47)); default off via `ORTO_JEV_BANK_ROUTE`; a single bank keeps `in_scope`. Destination kind ships as `judgeDestinationKind` ([JEV-31](https://github.com/zanuka/orto/issues/55)); it landed after bank routing and composes with it. Default off via `ORTO_JEV_DESTINATION_KIND`. Share safety ships as `judgeShareSafety` on `orto share --judge jev` ([JEV-33](https://github.com/zanuka/orto/issues/56)). The golden-set eval ships as `pnpm eval:judge` ([JEV-34](https://github.com/zanuka/orto/issues/48)). Remaining Firstmate-specific routing (JEV-27).

---

## Comparison table: Orto (with Jev) vs vanilla Hindsight + its Jev reranker

| Dimension | Vanilla Hindsight (+ Jev reranker) | Orto + optional Jev layer | Developer benefit of Orto |
|---|---|---|---|
| **What enters the bank** | Whatever you (or an agent) `retain`. Quality = extraction from the input. | Scanner + heuristics + optional Jev relevance/durability gate *before* retain. Section-level keep/skip. | Spend retain (and future recall) on durable decisions/invariants/architecture, not changelogs, TOCs, badge walls, or session fluff. |
| **Recall ranking** | Strong listwise Jev reranker (opt-in). Better order + optional prune. | Prefer Hindsight’s built-in when available. Orto `packRecallContext` (`rank: true`) adds confidence-gated drops + char budget after recall ([JEV-23](https://github.com/zanuka/orto/issues/25)). `judgeRecallVerified` marks stale recalls when the source contradicts them ([JEV-24](https://github.com/zanuka/orto/issues/45)). `judgeLookupRoute` chooses mental_model / reflect / recall ([JEV-25](https://github.com/zanuka/orto/issues/26)). | Hindsight ranks what is stored. Orto packs/gates how harnesses stuff context, when a claim is stale, and which lookup tool to call. |
| **Bank hygiene / prune** | Manual or your own scripts. | Existing `prune` (path/section-gone + tombstones). `orto audit --judge jev` plans keep/refresh/supersede/archive/delete-candidate without mutating the bank; apply is separate. | Structured, confidence-gated cleanup instead of ad-hoc Hindsight cleanup. |
| **Incremental / provenance** | You manage re-ingest. | Hash-gated incremental seed; source path + commit are first-class. | Agents inherit stable, attributable institutional knowledge. |
| **Agent / MCP surface** | You wire MCP. Agents can retain freely. | Emits ready MCP configs. Planned Jev gates on unsafe retains and routing (reflect/recall/mental-model). | Safer company-brain usage; less session junk in the shared bank. |
| **Harness / multi-agent** | Out of scope. | `judgeNeedsBank` skips bank load on pure-code tasks. `judgeTaskFollowup` routes retain vs PR vs both after a task. `judgeEscalateDispatch` chooses escalate vs dispatch from a charter list. `judgeScoutSeedability` gates scout reports before seed. `judgeBankRoute` keeps a section out of the wrong company-brain bank when two or more banks are configured. Further Firstmate-specific routing still planned (which registered project). | Any workflow can avoid thrashing the bank on code-only work, queue store/seed only when durable knowledge changed, escalate real decisions, and keep scout scratch pads out of the bank. |
| **Default / privacy** | Local MiniLM free and private. Jev reranker is hosted. | Fully local-first by default. Jev is strictly opt-in. | Same local default; extra judgment only when you want it. |
| **Cost model** | Reranker: input tokens only, listwise is cheap. | Judge calls on sections / candidates (typically ≪ $0.0001 each). Recurring only on changes or MCP attempts. | Cheap second opinion on the expensive step (retain) and on prune. |
| **Overlap / complementarity** | Excellent at ranking what is already stored. | Decides what is worth storing, annotates what should leave, and adds operational gates. | Complementary. Orto’s pre-retain and hygiene value remains even when you turn on Hindsight’s Jev reranker. |

---

## Relevance takeaway

Hindsight’s Jev reranker makes *recall* better. It does not solve the upstream problem Orto targets: **bank quality is mostly determined by what you retain**.

The highest-leverage remaining Orto work is therefore:

1. Prune annotation (so the bank stays clean).
2. Prefer Hindsight’s native Jev reranker for server-side listwise ranking; use Orto `packRecallContext` when the harness already holds passages and needs confidence-gated drops. Still-true verification ships as `judgeRecallVerified` (JEV-24, default off). Lookup routing ships as `judgeLookupRoute` (JEV-25, default off).
3. Harness gates Hindsight’s reranker never touches (needs-bank, task follow-up, escalate/dispatch, scout seedability, MCP retain). MCP retain blocking already ships (JEV-22); needs-bank ships as `judgeNeedsBank` (JEV-26); task follow-up ships as `judgeTaskFollowup` (JEV-28); escalate vs dispatch ships as `judgeEscalateDispatch` (JEV-29); scout seedability ships as `judgeScoutSeedability` (JEV-30).

That positioning keeps Orto relevant: developers get a curated, provenance-aware company brain whose contents are worth ranking, rather than just a better sort of whatever happened to land in retain.

---

*Saved from conversation analysis of Hindsight 0.10.1 Jev reranker vs Orto Phase 7 JEV issues. Copy into the Orto repo `docs/` if it lands.*
