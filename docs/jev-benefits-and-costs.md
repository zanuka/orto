# Jev in Orto — benefits and expected cost

**Status:** planning / opt-in design  
**Audience:** Orto operators, SWE team leads, anyone deciding whether to turn on `--judge jev`  
**Related:** [JEV-0 epic](https://github.com/zanuka/orto/issues/58), [open `jev` issues](https://github.com/zanuka/orto/issues?q=is%3Aissue+is%3Aopen+label%3Ajev), [jev.md](./jev.md) (product rule), [jev-integration.md](./jev-integration.md), [JEV issue pack](./JEV_GITHUB_ISSUES.md), TypeSafe [Introduction](https://docs.typesafe.ai/introduction), [System One](https://docs.typesafe.ai/concepts/system-one), [Models & pricing](https://docs.typesafe.ai/models)  
**As of:** 29 September 2026

This report is for end-users of Orto, not a TypeSafe sales brief. Orto stays local-first. Jev is an **opt-in hosted judge**. If you never set a TypeSafe key, you never pay TypeSafe, and the CLI behaves as it does today.

---

## 1. Executive summary

Orto already scans a repo, hashes what it keeps, and retains durable knowledge into a Hindsight bank. The expensive and irreversible steps are still decided with heuristics (and, at runtime, by agents):

- which sections are worth a Hindsight `retain`
- which bank items have gone stale
- which monorepo diffs should be seeded first
- whether an agent `retain` through MCP is project knowledge or session junk
- when Firstmate should touch the bank at all

[Jev](https://docs.typesafe.ai/introduction) is TypeSafe’s System One model: unstructured state in, typed Choice / Score / Noul answers out, with calibrated probabilities and a confidence score. It does not write bank text, missions, or ADRs. Orto keeps every side effect.

**Primary benefit:** spend Hindsight retain, prune, and agent context on knowledge that is actually durable — and escalate the uncertain cases to a human or Firstmate captain instead of silently applying a guess.

**Primary cost fact:** TypeSafe bills **input tokens only**. Official list price for `jev-1.13.0` (alias `jev-latest`) is **$0.042 per million input tokens**; **output is free**. A typical Orto section-judge call is on the order of **1,000–2,500 input tokens**, or **well under $0.0001 per section**. A first seed of a mid-size docs tree is cents, not dollars. Recurring cost stays low if you judge **changed sections and MCP retain attempts**, not the whole bank on every command.

**Opt-in contract:**

| Condition | What happens | TypeSafe bill |
|---|---|---|
| No `ORTO_TYPESAFE_API_KEY`, no `--judge jev` | Today’s heuristic path | $0 |
| Key present but flag off | Key is unused | $0 |
| `--judge jev` without a key | Hard error; how to unset the flag | $0 |
| `--judge jev` + key | Typed questions on sanitized excerpts | Input tokens only |
| API error / 429 (default) | Warn once, fall back to heuristics | Partial (failed calls may still meter; Orto must not retry-storm) |

Orto does not resell Jev, does not require a TypeSafe account, and must not treat the Hindsight key as a TypeSafe key.

---

## 2. What Jev is in this product

TypeSafe names Jev a **System One** model, after Kahneman’s fast / slow split:

- **System One (Jev):** snap judgments software can branch on. Fast, structured, no prose.
- **System Two (already Orto’s):** Hindsight extract/retain, `reflect`, Firstmate captain, a person confirming prune or share.

That split is the integration rule. Jev is not a memory backend and not a second agent.

| Jev does | Orto still does |
|---|---|
| Return `choice`, `score`, `noul`, probabilities, confidence | Scan, denylist, hash, retain, prune, share, MCP I/O |
| Score a section for durability / scope / secrets | Write the bank and the repo |
| Rank candidates against a retain budget | Apply the budget |
| Annotate a prune plan | Delete only after you confirm |
| Route “needs bank?” / “allow retain?” | Call Hindsight or dispatch a crewmate |

Do-not-build (from JEV-1):

- no `--provider jev`
- no vendored TypeSafe installer or skill marketplace
- no auto-delete of bank items
- no Jev-generated missions, ADRs, MCP snippets, or mental-model prose
- no silent apply below `--confidence`

---

## 3. Primary benefits

### 3.1 Spend retain on durable knowledge

Hindsight `retain` is the costly step — time, local model/GPU, and bank quality. Heuristics already drop a lot of noise. Changelogs, badge walls, tables of contents, generated API dumps, and meeting-note piles still get through often enough to matter.

With `--judge jev`, after scan and the existing filter, Orto sends a **section excerpt** (not the file, not the bank) and asks atomic questions in one call:

- Noul `is_durable` — decision, invariant, architecture, standard
- Noul `is_ephemeral` — changelog, TOC, generated dump, TODO pile
- Noul `in_scope` — matches this bank’s mission
- Score `durability` — 0 ephemeral … 4 constitutional

Code policy, not a prompt:

- ephemeral ∧ ¬durable → skip retain
- in_scope low → skip (or later route to another bank)
- confidence below threshold → dry-run review, never auto-skip or auto-retain

**User-visible result:** `orto seed --dry-run --judge jev` prints path, heading, decisions, scores, confidence, and heuristic-vs-Jev. You see the keep/skip table before anything is written.

**Why this is the headline benefit:** a dirty bank is more expensive than Jev. Every later `recall` / `reflect` / Firstmate turn pays for junk that was retained once.

### 3.2 Judge sections, not files

A README is often 20% durable architecture and 80% badges, TOC, and contributor tables. File-level keep/skip is the wrong unit. Jev runs per `orto:<path>#<section>` / `document_id`. One file can produce a mix of retain and skip rows in a single seed.

**User-visible result:** the dry-run table has one row per heading. The architecture section of `README.md` can land in the bank while the changelog section does not.

### 3.3 Put the durable part of a large diff first

A monorepo change can touch dozens of markdown files and contain only a few decisions. `seed --budget N --judge jev` ranks those candidates and retains the top N. The rest stay pending. `store --propose-adopt --judge jev` can propose which new files belong on the `store` allowlist. You confirm with `--apply` before the allowlist changes, and that write does not retain. `store --judge jev` also gates wording-only edits and temporary workarounds before retain.

**User-visible result:** incremental `seed` and `store` spend the budget on ADRs and standards first, not on every touched doc.

### 3.4 Remove knowledge that is no longer true: with a plan, not a guess

`seed` and `store` add or upsert. Months later a path is gone, a section is gone, or the file is still on disk but the claim is false. `orto prune` already groups path-gone and section-gone without a TypeSafe key (plus explicit `--source` / `--document-id`). Optional `audit --judge jev` / `--judge jev` on prune is planned to annotate:

- source path no longer in the repo (shipped today; no TypeSafe key required)
- section no longer in the file (shipped today; no key required)
- Jev-scored outdated / irrelevant / contradicted (key + `--judge jev`; not shipped yet)

Jev annotates the prompt with a choice and a confidence score. Low score is shown and left unchecked. `--dry-run` prints groups and does not delete. After you confirm, Orto deletes and tombstones so the next seed does not put the same unchanged text back.

**User-visible result:** prune is a reviewable plan instead of manual Hindsight cleanup. Path-gone / section-gone work offline today.

### 3.5 Stop agents from retaining session junk

Seed quality dies if agents `retain` chat, diffs, and “I just tried X” through MCP. The MCP `retain` tool is the highest-priority runtime use of Jev.

Questions on a sanitized payload:

- Noul `is_durable_project_knowledge`
- Noul `is_session_fluff`
- Choice `action`: `allow | deny | suggest_seed_instead`

Default deny on fluff or low confidence. The agent is told to use `orto seed` / `store`, not mid-session retain. With the judge off, conservative heuristic deny rules still apply to obvious chat-shaped payloads.

**User-visible result:** the bank stays a company brain, not a transcript dump — even when several harnesses are pointed at the same MCP server.

### 3.6 Act only when the decision is still real

At read time (all opt-in, because they add a cloud hop to an otherwise local recall):

- rerank recalled passages and drop low-relevance ones before stuffing context
- flag a memory the current docs no longer support
- choose `reflect` vs `recall` vs a pinned mental model

For Firstmate, Jev answers:

- whether the task needs this bank
- which registered bank
- whether the outcome is a knowledge update, a pull request, or both
- escalate vs dispatch

A low score goes to the captain instead of a silent apply.

**User-visible result:** fewer wasted recall tokens in the coding agent, fewer “we still use MySQL” answers after the Postgres ADR landed, fewer Firstmate loops that load the bank for a pure-code task.

### 3.7 Typed answers so policy lives in Orto

The alternative is “ask an LLM if we should keep this” and parse a paragraph. That is using a System Two text model as a brittle classifier: extra output tokens, parse failures, no calibrated confidence.

Jev returns values code can branch on. The `Judge` port (`off | heuristic | jev`) keeps Hindsight code from importing TypeSafe. Confidence is a first-class gate, not a vibe in the reply.

**User-visible result:** dry-run output is a table, not an essay. Thresholds (`--confidence 0.8`) are yours. Behavior is testable with recorded answers (JEV-34).

### 3.8 Secrets and denylisted paths never become Jev state

Anything sent to TypeSafe leaves the machine. The benefit only holds if state is a capped excerpt, and secret-bearing text is skipped:

- reuse the seed denylist (`.env`, credentials, key files)
- skip inline secrets before build-state (tokens, private keys, connection strings). The warning names the path and does not include the secret.
- cap state: section + path + heading + mission + at most N overlap summaries
- never attach the full bank, a huge file, a secret-bearing patch, or MCP conversation logs
- second-pass Noul `contains_secret` / `contains_pii` on candidates that already passed the path filter

**User-visible result:** a pasted `sk-` / PEM block in an otherwise seedable ADR is skipped and the warning names the path without reprinting the secret. Public share still waits on a Orto safety check (JEV-33).

### 3.9 Make the default (offline) path better, even if you rarely turn Jev on

JEV-34 keeps a golden set of sections labeled keep / skip / kind by a human. Jev is the yardstick. Findings feed heuristic tweaks, not “just require Jev.”

**User-visible result:** teams that never set a TypeSafe key still benefit if the offline keep/skip rules improve. If Jev does not beat heuristics on that set, you do not take the cloud dependency.

### 3.10 What Jev is not a benefit for

Do not expect Jev to:

- replace Hindsight or become a provider
- write better ADRs than your team
- count occurrences, compare dates, or do arithmetic (do that in Orto)
- guarantee a single answer is correct — calibration is over groups of predictions
- harden the bank against a determined adversarial prompt in `state` without your own tests

Those limits are why the product is a judge behind a confidence gate, not an autopilot.

---

## 4. How an operator turns it on

Happy path stays local. Jev is a flag plus a key you own.

```bash
# default — no TypeSafe traffic
orto seed --dry-run
orto seed

# preview judgments only
export ORTO_TYPESAFE_API_KEY=...   # never commit; never reuse the Hindsight key
orto seed --dry-run --judge jev

# apply keep/skip only where confidence ≥ threshold (default documented in docs/jev.md)
orto seed --judge jev --confidence 0.8

# runtime MCP retain gate (harness-level; default off unless the emitted snippet enables it)
# ORTO_TYPESAFE_API_KEY must be present in the MCP server environment
```

Recommended enable order:

1. Dry-run seed on a repo you already know (Orto itself, Strumentario, or a docs-heavy service).
2. Compare the table to heuristics. If it is not obviously better on ADRs vs changelog/TOC, stop.
3. Turn on the MCP retain guardrail. That is the runtime damage-control switch.
4. Add audit/prune annotation once you trust the questions.
5. Leave recall-time verify and Firstmate routing off until you measure extra latency.

Commands that must not call Jev unless they explicitly opt in: `init`, `configure` (except a later fitness issue), `docker *`, and `mcp --write`.

---

## 5. Cost model

### 5.1 Who bills whom

| Party | Charges for Jev? | Notes |
|---|---|---|
| Orto | No | OSS CLI. No markup, no bundled TypeSafe subscription. |
| TypeSafe AI | Yes, if you call their API | You create a key at [console.typesafe.ai](https://console.typesafe.ai/). Early access has been waitlist-based; some gateways also serve `jev-1.13`. |
| Hindsight / local Docker | Unchanged | Jev does not replace local retain compute. It *reduces how often* you pay that cost. |
| Coding-agent vendor | Unchanged, often down slightly | Cleaner bank → fewer wasted recall/reflect tokens in Cursor / Claude Code / etc. |

You bring your own TypeSafe key. Orto never implies that key from the Hindsight key.

### 5.2 Official TypeSafe list price (29 September 2026)

Source: [docs.typesafe.ai/models](https://docs.typesafe.ai/models) for **Jev 1.13** (`jev-1.13.0`, aliases `jev-latest` and currently `jev-preview`).

| Item | Value |
|---|---|
| Input | **$42 per billion tokens** = **$0.042 per million tokens** |
| Output | **Free** |
| Context | 64k tokens per request; 32k for state + the longest question |
| Input types | Text only (string, JSON object, or array of text). No image / audio / video |
| Rate limits (published, can change) | 250,000 tokens/second; 1,200 requests/minute |
| Fine-tuning | None. Same weights for every account. Domain rules go in questions + Orto policy |
| Data use | TypeSafe documents that enterprise terms include zero retention; confirm current terms before sending anything you would not send to any hosted API |

Independent write-ups of the same list price are consistent with the models page. Third-party **credit packs** advertised on unofficial sites (e.g. $0.25–$0.42/M on prepaid tiers) are **not** the official models-page rate and should not be used for Orto planning. Gateways (OpenRouter, Vercel AI Gateway, Cloudflare) have historically listed the same **$0.042 / $0** unit price plus their own fees or context caps — check the gateway you actually use.

TypeSafe has said it expects prices to fall rather than rise and has noted it cannot prove the current price is not subsidized. Treat **$0.042/MTok input** as the planning rate and re-read the models page before you budget a contract.

### 5.3 What Orto sends (and therefore what you pay for)

You pay for **every token in `state` plus every token in the question definitions**, once per HTTP call. Output (the typed answers) is free. Several questions against the same state in **one** call are cheaper than one call per question, because the section text is billed once.

Orto’s state budget (JEV-3) is the main cost-control:

- section text + path + heading + bank mission + a short overlap list
- not the repo, not the bank dump, not a raw patch with secrets
- hard cap aligned with Jev’s 32k state+question budget (in practice far smaller)

Working estimate for a **first-slice relevance call** (JEV-4 / JEV-5):

| Piece | Typical tokens | Notes |
|---|---|---|
| Path, heading, metadata | 30–80 | Cheap |
| Section body (capped excerpt) | 400–1,500 | Dominant term. Do not send a 20k-token README blob. |
| Bank mission / directives excerpt | 80–300 | Shared across a seed run; still sent per call unless batched later |
| Overlap observation summaries (0–N) | 0–600 | Only when contradiction check is on (JEV-7) |
| Question instructions + criteria (4–8 questions) | 300–800 | Paid once per call; fan-out is almost free vs extra calls |
| Protocol / wrapper overhead | ~150–300 | Independent measurements of Jev calls often see a few hundred tokens of request overhead |
| **Planning total per section** | **~1,000–2,500** | Use **2,000 tokens** as a conservative average |

At $0.042 / million input tokens:

```text
cost_per_call ≈ (input_tokens / 1_000_000) × 0.042

2,000 tokens  →  $0.000084
1,000 calls   →  $0.084
10,000 calls  →  $0.84
```

Formula for a run:

```text
run_cost ≈ N_calls × tokens_per_call × 0.042 / 1e6
```

Batching more questions into the same call (kind + durability + secret check) raises tokens_per_call only by the extra question text, not by another copy of the section.

### 5.4 Expected cost by Orto feature

These are **planning ranges**, not invoices. They assume the 2,000-token average unless noted, list price $0.042/MTok, and no gateway markup.

#### A. First seed of a repo (`seed --judge jev`)

Heuristics should already have dropped obvious noise. Jev sees **candidates**, not every file.

| Repo shape | Candidates after heuristics | Jev calls | Input tokens | TypeSafe $ |
|---|---|---|---|---|
| Small library, thin docs | 20–40 sections | 20–40 | 40k–80k | **$0.002–$0.003** |
| Typical service (`README` + `docs/` + ADRs) | 80–200 | 80–200 | 160k–400k | **$0.007–$0.017** |
| Docs-heavy monorepo / company standards tree | 400–1,000 | 400–1,000 | 0.8M–2.0M | **$0.03–$0.08** |
| Pathological: judge every heading with no heuristic pre-filter | 5,000+ | 5,000+ | 10M+ | **$0.42+** — do not do this |

A first seed is a one-time (or rare) bill. Incremental re-seed should only judge **new or hash-changed** sections.

#### B. Incremental / daily seed

| Habit | Calls / week | Monthly TypeSafe $ (order of magnitude) |
|---|---|---|
| A few ADRs and docs PRs per week | 10–40 | **< $0.01** |
| Active monorepo, many markdown touches, hash-gated | 100–400 | **$0.01–$0.04** |
| Watcher on every save with no high-signal gate (JEV-13 off) | thousands | Avoid. JEV-13 exists so the watcher does not become a meter. |

#### C. MCP `retain` guardrail (JEV-22) — the recurring runtime cost

State is a short agent payload, usually smaller than a docs section. Use **~800–1,200 tokens** per attempt.

| Team habit | Retain attempts / day | Monthly calls (22 workdays) | Monthly $ |
|---|---|---|---|
| Rare (agents told to seed, not retain) | 5 | ~110 | **~ $0.005** |
| Several harnesses, sloppy retain | 40 | ~880 | **~ $0.04** |
| Unconstrained agents retaining every turn | 500 | ~11,000 | **~ $0.45** — fix the agent rules; do not just pay |

Default deny on fluff also means many attempts never reach Hindsight. The Jev bill here is insurance against a dirty bank, not a feature tax.

#### D. `audit` / prune annotation (JEV-14)

Path-gone and section-gone groups need **no TypeSafe call**. Jev is only for “file still exists but the claim looks stale / irrelevant / contradicted.”

| Audit | Items scored | Tokens | $ |
|---|---|---|---|
| Monthly sample of 50 memories vs current excerpts | 50 | ~100k | **~ $0.004** |
| Quarterly sweep of 300 | 300 | ~600k | **~ $0.025** |
| Full-bank score every night | thousands | millions | Do not. Bound the sample (JEV-35). |

#### E. Recall-time features (JEV-23, JEV-24, JEV-25) — default off

These sit on the hot path. A naive “score every recalled passage on every agent turn” is how a cents-scale feature becomes a dollars-scale one.

| Pattern | Risk | Planning note |
|---|---|---|
| `recall` pass-through (default) | $0 Jev | Correct default |
| Packed `recall_ranked` on demand | One call per pack, not per passage if batched | Budget ~3k–8k tokens/call if you send several passages as one state |
| `still_true` on every recall | Cloud hop + tokens every turn | Env flag off by default (`ORTO_JEV_RECALL_VERIFY`) |
| Firstmate “needs bank?” once per captain request | One small call per task | Usually cheaper than a useless Hindsight reflect |

**Guidance:** enable seed + MCP retain first. Measure. Only then put Jev on recall.

#### F. Golden-set eval (JEV-34)

CI should replay **recorded** answers with no live key (`$0`). An optional live job on a fixture of 100 sections is about **$0.008** per run. Run it when you change questions or heuristics, not on every commit.

### 5.5 Worked monthly examples

Assumptions: 2,000 tokens/seed-section, 1,000 tokens/MCP-retain, 2,000 tokens/audit-item, $0.042/MTok.

**Solo operator, one service repo, Jev on seed dry-runs and MCP retain only**

- Incremental seed: 40 changed sections/month → 80k tokens → $0.003
- MCP retain attempts: 10/day × 22 → 220k tokens → $0.009
- **Total ≈ $0.01–$0.02 / month**

**Team of 8 on one company-brain bank, first-slice features on**

- Incremental seed: 250 sections/month → 500k tokens → $0.021
- MCP retain: 20/day × 22 → 440k tokens → $0.018
- Monthly audit sample: 80 items → 160k tokens → $0.007
- **Total ≈ $0.05 / month**

**Org with three banks, watcher + recall verify left at defaults (off)**

- Same as team case × ~3 banks, if each bank is seeded separately → **≈ $0.15 / month**
- Turning on un-gated watcher or per-turn recall verify is the only way this becomes material. That is a configuration mistake, not the list price.

Compared with asking Claude Haiku 4.5 to “decide keep/skip and explain” at published **$1 / $5 per million** input/output, the same 500k input tokens is **$0.50** before any output tokens. Jev’s output-free, no-prose design is why the Orto judge can exist as a default-off extra without a procurement exercise.

### 5.6 Costs Jev is meant to *avoid* (the real budget)

TypeSafe cents are not the interesting number. The costs Jev is designed to cut:

| Avoided cost | How Jev helps |
|---|---|
| Hindsight `retain` on changelog / TOC / badge soup | Skip before retain |
| Bank pollution → every future `recall` / `reflect` is worse and longer | MCP retain deny; section-level skip |
| Human time cleaning Hindsight by hand | Audit plan + confidence-gated prune |
| Firstmate / Maglio loops that load the bank for a pure-code task | `needs_project_bank` Noul |
| Accidental public share of internal runbooks | JEV-33 profile gate (still Orto applies the profile) |
| Using a frontier LLM as an ad-hoc JSON judge | Typed primitives, free output, no parser |

A single bad MCP retain of a 2,000-token chat blob is “free” at write time and then paid back on every agent session that recalls it. That is why JEV-22 is in the first slice and why its TypeSafe bill is the wrong thing to minimize in isolation.

### 5.7 Cost-control checklist for operators

1. **Leave it off until dry-run looks better than heuristics.** JEV-34 is the stop rule.
2. **Always hash-gate.** Do not re-judge unchanged sections.
3. **Cap excerpts.** If a section is huge, send the heading + a bounded window, not the file.
4. **Fan-out questions in one call.** Durability + ephemeral + in-scope + secret check together.
5. **Do not put Jev on `recall` by default.**
6. **Do not let a file watcher call Jev without the high-signal gate (JEV-13).**
7. **Fail closed on secrets; fail open to heuristics on 429/5xx** unless `--strict`.
8. **Log question ids and paths at info. Log field names and lengths at debug. Do not log section text or the request body.**
9. **Pin `jev-1.13.0` in production** once you have floors; `jev-latest` can move.
10. **Re-read [docs.typesafe.ai/models](https://docs.typesafe.ai/models) before annual budgeting.** Rate limits and price are documented as changeable.

### 5.8 Access and operational caveats that affect cost

- Direct TypeSafe signup has been **early access / waitlist**. Gateway routing may be how some operators get a key. Gateway context caps can be **32k**, tighter than TypeSafe direct.
- Published rate limits can change without notice during early access. Orto should treat 429 as fallback-to-heuristics, not a tight retry loop (retries are how a $0.02 seed becomes a surprise).
- Jev is hosted. There is **no self-hosted / OSS weights** path as of this writing. Local-first Orto remains the default; Jev is the optional cloud hop.
- Confirm TypeSafe’s current data-retention and DPA language before judging anything that might include customer names. Orto’s job is to keep that text off the wire; the legal review is still yours.

---

## 6. Benefit × feature map (what you get for the spend)

| Spend (opt-in) | Benefit | First-slice? |
|---|---|---|
| `seed --dry-run --judge jev` | See keep/skip + scores before any retain, one row per section | Shipped ([JEV-4](https://github.com/zanuka/orto/issues/30), [JEV-5](https://github.com/zanuka/orto/issues/36)). One file can mix retain and skip |
| `seed --judge jev` | Skip high-confidence junk; review the rest | Yes |
| MCP retain gate | Stop session fluff entering the bank | Yes (JEV-22) |
| Golden-set eval | Know whether Jev beats heuristics; improve offline path | Yes (JEV-34) |
| Kind / tags / contradiction / secrets | Cleaner bank, supersession instead of duplicate facts, secrets and personal data stay out | Shipped for kind ([JEV-6](https://github.com/zanuka/orto/issues/37)), contradiction ([JEV-7](https://github.com/zanuka/orto/issues/38)), the secret / personal-data check ([JEV-8](https://github.com/zanuka/orto/issues/39)), and citation support ([JEV-9](https://github.com/zanuka/orto/issues/40)) |
| `audit --judge jev` + confirm | Structured prune; tombstones | After |
| Firstmate routing | Bank only when the task needs it | After |
| Recall rerank / still-true | Safer context; extra latency and tokens | After, flag-gated |
| Share safety gate | Extra check before `public` | After, with Phase 5 profiles |

Foundation work (JEV-1–3) has **no TypeSafe cost**. It is documentation, a `Judge` port, and sanitization so the later flags cannot leak secrets or become a default.
[JEV-4](https://github.com/zanuka/orto/issues/30) is the first call that spends input tokens, one section at a time.

---

## 7. Recommendation

Ship and talk about Jev as:

> An optional System One judge. Orto stays local-first. You add a TypeSafe key and `--judge jev` when you want typed keep/skip, prune annotation, and an MCP retain gate. Expect **cents per month** on normal seed + retain-guard usage at the September 2026 list price of **$0.042 per million input tokens**, output free. If the dry-run table is not better than heuristics, leave it off.

Success test (already in the issue pack): on Strumentario or Orto itself, `seed --dry-run --judge jev` keeps durable ADRs, drops changelog/TOC, and sends no secrets in the TypeSafe payload.

---

## 8. Sources

- TypeSafe docs: [Introduction](https://docs.typesafe.ai/introduction), [System One](https://docs.typesafe.ai/concepts/system-one), [How to build with System One](https://docs.typesafe.ai/concepts/how-to-build-with-system-one), [Models](https://docs.typesafe.ai/models)
- Orto: [JEV-0](https://github.com/zanuka/orto/issues/58), [JEV issue pack](./JEV_GITHUB_ISSUES.md), [jev.md](./jev.md), [jev-integration.md](./jev-integration.md), [company-brain.md](./company-brain.md)
- Planning rates in §5 were computed from the official **$0.042 / MTok input, output free** line on the models page as of 29 September 2026. Re-verify before procurement.
