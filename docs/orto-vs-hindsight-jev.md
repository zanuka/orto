# Orto + Jev vs Vanilla Hindsight + Jev Reranker

**Audience:** developers evaluating Orto’s optional Jev judgment layer  
**Related:** [why-orto.md](./why-orto.md), [jev-benefits-and-costs.md](./jev-benefits-and-costs.md), [JEV-0 epic](https://github.com/zanuka/orto/issues/58), Hindsight 0.10.1 release notes  
**As of:** 25 October 2026

Hindsight’s Jev support (0.10.1+) is a strong, opt-in *recall* reranker. Orto’s planned Jev layer is complementary and mostly upstream of that: it decides *what is worth putting in the bank* (and related gates), while Hindsight’s Jev ranks *what is already retrieved*.

---

## Hindsight’s Jev reranker (0.10.1+)

- **Scope**: Recall only. Set `HINDSIGHT_API_RERANKER_PROVIDER=typesafe` (optional prune via `HINDSIGHT_API_RERANKER_TYPESAFE_PRUNE_CANDIDATES=true`). Default remains the local MiniLM cross-encoder.
- **Mechanism**: Listwise Choice — one request with the whole candidate pool as options. Probabilities sum to 1 and become the ranking. (Per-candidate Noul was tried and rejected; relative judgment is better and far cheaper.) Optional second Score question cuts the ranked shortlist where relevance ends (no “nothing” escape hatch). Prune is off by default and caps results at ~12.
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
- Prune annotation (JEV-14–17): score still-on-disk items as outdated / irrelevant / contradicted (Jev annotates; you confirm delete).
- Bank-template fitness (JEV-18–21): score mission/directives, extraction aggressiveness, etc. (does not author prose).
- **Recall & MCP guards** (JEV-22–25): block unsafe MCP retain, rerank recalled passages (overlaps Hindsight’s feature), check “still true?”, route reflect vs recall vs mental-model lookup.
- Firstmate routing (JEV-26–30), share safety (JEV-31/33), heuristic golden-set eval (JEV-34).

---

## Comparison table: Orto (with Jev) vs vanilla Hindsight + its Jev reranker

| Dimension | Vanilla Hindsight (+ Jev reranker) | Orto + optional Jev layer | Developer benefit of Orto |
|---|---|---|---|
| **What enters the bank** | Whatever you (or an agent) `retain`. Quality = extraction from the input. | Scanner + heuristics + optional Jev relevance/durability gate *before* retain. Section-level keep/skip. | Spend retain (and future recall) on durable decisions/invariants/architecture, not changelogs, TOCs, badge walls, or session fluff. |
| **Recall ranking** | Strong listwise Jev reranker (opt-in). Better order + optional prune. | Can use Hindsight’s built-in. Additional planned guards (JEV-23 etc.): still-true check, routing, MCP retain blocking. | Hindsight already solves ranking. Orto adds gates around *how* and *when* recall is used. |
| **Bank hygiene / prune** | Manual or your own scripts. | Existing `prune` (path/section-gone + tombstones). Optional Jev annotation of outdated/irrelevant/contradicted items (you confirm). | Structured, confidence-gated cleanup instead of ad-hoc Hindsight cleanup. |
| **Incremental / provenance** | You manage re-ingest. | Hash-gated incremental seed; source path + commit are first-class. | Agents inherit stable, attributable institutional knowledge. |
| **Agent / MCP surface** | You wire MCP. Agents can retain freely. | Emits ready MCP configs. Planned Jev gates on unsafe retains and routing (reflect/recall/mental-model). | Safer company-brain usage; less session junk in the shared bank. |
| **Firstmate / multi-agent** | Out of scope. | Planned routing decisions (needs bank? which bank? escalate vs dispatch? seedable?). | Keeps agent crews from thrashing the bank. |
| **Default / privacy** | Local MiniLM free and private. Jev reranker is hosted. | Fully local-first by default. Jev is strictly opt-in. | Same local default; extra judgment only when you want it. |
| **Cost model** | Reranker: input tokens only, listwise is cheap. | Judge calls on sections / candidates (typically ≪ $0.0001 each). Recurring only on changes or MCP attempts. | Cheap second opinion on the expensive step (retain) and on prune. |
| **Overlap / complementarity** | Excellent at ranking what is already stored. | Decides what is worth storing, annotates what should leave, and adds operational gates. | Complementary. Orto’s pre-retain and hygiene value remains even when you turn on Hindsight’s Jev reranker. |

---

## Relevance takeaway

Hindsight’s Jev reranker makes *recall* better. It does not solve the upstream problem Orto targets: **bank quality is mostly determined by what you retain**.

The highest-leverage remaining Orto work is therefore:

1. Prune annotation (so the bank stays clean).
2. Treating Hindsight’s native Jev reranker as the default ranking path (JEV-23 can become “prefer Hindsight’s typesafe provider when available; add Orto-specific still-true / routing checks on top”).
3. MCP retain blocking and Firstmate routing (things Hindsight’s reranker never touches).

That positioning keeps Orto relevant: developers get a curated, provenance-aware company brain whose contents are worth ranking, rather than just a better sort of whatever happened to land in retain.

---

*Saved from conversation analysis of Hindsight 0.10.1 Jev reranker vs Orto Phase 7 JEV issues. Copy into the Orto repo `docs/` if it lands.*
