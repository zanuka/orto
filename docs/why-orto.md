# Why Orto (and why the Jev layer)

Orto (Italian for kitchen garden / cultivated plot) is the cultivated knowledge plot that agents inherit.
This is a developer-facing explanation of what Orto adds over default Hindsight, and what the optional Jev integration specifically adds. Use it for README sections, talks, issue discussions, or onboarding notes.

---

## The short version

**Hindsight is the memory bank. Orto is the company-brain config that turns your repo’s durable docs into a bank agents can actually trust.**

Default Hindsight will retain whatever you hand it and extract facts from it. That works, but the quality of the bank is then “whatever landed in retain.” Orto sits in front of that: it scans the repo, prefers decisions / invariants / architecture over noise, tracks provenance, re-seeds only what changed, and (with `--judge jev`) asks a typed “is this worth retaining?” before spending a Hindsight retain.

---
 
## What Orto adds over default Hindsight (even with Jev off)

| Default Hindsight | Orto on top |
|---|---|
| You decide what to `retain` | Scanner finds durable sources (README, `/docs`, ADRs, `AGENTS.md`) and surfaces candidates |
| Facts are extracted from whatever you send | Heuristics already prefer decisions, invariants, architecture over changelogs, TOCs, badge walls |
| Full re-ingest if you want freshness | Hash-gated incremental `seed` — only changed sections are re-retained |
| Provenance is whatever you attach | Source path + commit are first-class |
| MCP is yours to wire | `orto mcp` emits ready configs/rules for Claude Code, Codex, Cursor, Pi, and other popular harnesses |
| Bank mission / directives are manual | `init` / `configure` generate a bank template from the repo shape |
| Stale items stay until you clean them | `prune` groups path-gone / section-gone and tombstones so the same text doesn’t come back |
| Local / Docker is a separate setup | `orto docker` + local-first defaults |

**One-liner for developers:**

> Hindsight remembers what you give it. Orto decides *what from this repo* is worth giving it, keeps the link back to the source, and makes the bank usable from coding agents without a forced cloud path.

---

## What the Jev integration specifically adds

Hindsight 0.10.1 already has an opt-in Jev *reranker* for recall (listwise Choice over candidates). That improves ordering of what is already in the bank. It does **not** decide what should enter the bank.

Orto’s Jev layer is the pre-retain and runtime gate:

| Problem with “just upload the docs” | What `--judge jev` does |
|---|---|
| Changelogs, TOCs, generated API dumps, meeting notes still get retained | Noul `is_durable` / `is_ephemeral` + Score `durability` on the **section**, not the whole file |
| A README is 20% architecture, 80% badges | Section-level keep/skip (`path#section`) so one file can produce mixed rows |
| Agents `retain` “I just tried X” through MCP | JEV-22: deny session fluff; suggest `seed` / `store` instead. Default deny on low confidence |
| Huge monorepo diff, only a few real decisions | Rank candidates against a retain budget; you confirm |
| Extracted facts that the source does not actually support | Citation check after the extract preview: a high-confidence unsupported fact is not retained |
| You don’t know if the filter is better than heuristics | Golden-set (JEV-34) so offline keep/skip can improve even if most users never enable Jev |

**The operator loop:**

```text
orto seed --dry-run --judge jev
→ table of path, heading, keep/skip, scores, confidence
→ high-confidence rejects skipped
→ low-confidence items stay in review
→ only then does Hindsight retain run
```

No key / no `--judge jev` → today’s heuristic path, zero TypeSafe calls. Jev never writes the bank or the repo; Orto still owns the side effects.

---

## Talking points

**Vs dumping the whole docs tree into Hindsight:**

> Every changelog line and TOC you retain becomes noise that every future `recall` and `reflect` has to dig through. Orto + Jev scores the section first so retain is spent on the ADR or the architecture decision, not the badge wall.

**Vs “we already have heuristics”:**

> Heuristics drop a lot. They still let enough boilerplate through to matter. Jev is a second, typed pass with a confidence gate. If it isn’t better on a golden set of your own sections, leave it off — the offline path stays the default.

**Vs Hindsight’s own Jev reranker:**

> Their Jev ranks what is already stored. Ours decides what is worth storing, and stops agents from retaining chat into the company bank. Complementary, not a replacement.

**On cost and opt-in:**

> It’s your TypeSafe key, not ours. Typical section call is ~1–2.5k input tokens at $0.042/MTok, output free — cents for a first seed of a normal service. Recurring cost is hash-changed sections + MCP retain attempts, not the whole bank every run. No key means no calls.

**On control:**

> Low confidence never silently applies. You see the table, you confirm prune, you set the threshold. Jev returns Choice / Score / Noul; Orto policy decides keep, skip, or escalate.

---

## What not to claim

- Do not say Orto replaces Hindsight or that Jev is a memory provider. Hindsight is still the bank.
- Do not say Jev writes better ADRs or generates mission prose. It only judges.
- Do not imply Jev is required. The product rule is local-first; Jev is the optional System One reflex in front of expensive retain.
- Do not promise Hindsight’s recall reranker and Orto’s pre-retain judge are the same feature.

---

## Suggested one-paragraph pitch

> Orto turns a repository’s durable docs (ADRs, architecture, standards) into a Hindsight bank that coding agents inherit, with provenance, incremental re-seed, and MCP configs out of the box. The default path stays local and heuristic. Optionally, `--judge jev` adds a typed relevance gate so you retain sections that are actually durable project knowledge and skip changelogs, TOCs, and agent session fluff — instead of uploading the whole docs tree and hoping recall stays clean. You bring your own TypeSafe key; without it, behavior is unchanged.

---

## Sources

- [company-brain.md](./company-brain.md) — positioning for SWE teams
- [jev-integration.md](../jev-integration.md) — job split and flow
- [jev-benefits-and-costs.md](./jev-benefits-and-costs.md) — cost model and opt-in contract
- Hindsight 0.10.1 TypeSafe reranker docs (recall-only; complementary to Orto’s pre-retain gate)
