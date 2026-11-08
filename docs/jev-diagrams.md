# Jev diagrams: store and update paths

How the opt-in Jev judge sits on Orto's retain path when you store **new** durable markdown or update **changed** content already in the bank.

Product rule: [jev.md](./jev.md).
Narrative design: [jev-integration.md](./jev-integration.md).
Judge port: `src/judge/` ([JEV-2](https://github.com/zanuka/orto/issues/21)).
The seed relevance gate is shipped ([JEV-4](https://github.com/zanuka/orto/issues/30)).
Section-level keep/skip is shipped with it ([JEV-5](https://github.com/zanuka/orto/issues/36)).
One file can retain one section and skip another.
`store --propose-adopt` can propose new allowlist files ([JEV-10](https://github.com/zanuka/orto/issues/41)).
Edit durability ships on `store --judge jev` ([JEV-12](https://github.com/zanuka/orto/issues/31)).
The watcher high-signal gate helper ships ([JEV-13](https://github.com/zanuka/orto/issues/42)); there is no default `watch` CLI yet.
The diagrams show that intended `store` experience with `--judge jev`.

Without `--judge jev`, solid boxes still run. Dotted Jev steps are skipped and offline heuristics decide keep/skip.

---

## New vs changed at a glance

`seed` and `store` share one retain path (stable `document_id` upserts, seed manifest under `.orto/local/`).
Buckets differ by how the operator selects files:

| Bucket | Meaning | Typical command |
|--------|---------|-----------------|
| New | Durable `.md` not yet on `store.allowlist` / not in the seed manifest | `store` preview, then confirm or `--files` |
| Changed | Same source path, content hash differs from the last retain | `store` / `seed` re-retain (upsert) |
| Unchanged | Hash matches; skip unless `--force` | no Hindsight call |

Jev does not invent new files or rewrite docs.
It scores candidates Orto already extracted, then Orto retains only after confidence and (when required) confirmation.

```mermaid
flowchart LR
  subgraph sources [Repo markdown]
    newFile[New durable file]
    changedFile[Changed known file]
  end

  subgraph orto [Orto]
    scan[Scan and denylist]
    extract[Extract sections]
    buckets[Bucket new or changed]
    retain[Retain or upsert]
  end

  subgraph judge [Opt-in judge]
    jev[Jev scores]
  end

  bank[Hindsight bank]

  newFile --> scan
  changedFile --> scan
  scan --> extract --> buckets
  buckets -.->|"--judge jev"| jev
  jev -.->|"keep rank confirm"| retain
  buckets -->|"heuristics if judge off"| retain
  retain --> bank
```

---

## Store / seed retain with Jev

Operator flow for `orto store` (or `seed`) when Jev is enabled.
Orto owns every side effect: denylist, hash, upsert, manifest.

```mermaid
flowchart TD
  start([store or seed]) --> load[Load config and seed manifest]
  load --> discover[Discover markdown candidates]
  discover --> deny{Secrets or denylist?}
  deny -->|yes| drop[Drop before extract]
  deny -->|no| hash[Content-hash vs manifest]
  hash --> bucket{Bucket}
  bucket -->|unchanged| skip[Skip unless force]
  bucket -->|new or changed| extract[Extract section candidates]
  extract --> judgeOn{judge jev?}
  judgeOn -->|no| heuristic[Offline heuristic keep or skip]
  judgeOn -->|yes| sanitize[Sanitize state for TypeSafe]
  sanitize --> jevCall[Jev Choice Score Noul]
  jevCall --> conf{confidence at or above threshold?}
  conf -->|no| review[Dry-run queue or leave unchecked]
  conf -->|yes| keepSkip{keep?}
  heuristic --> keepSkip
  keepSkip -->|skip| noRetain[Do not retain]
  keepSkip -->|keep| rank[Rank under retain budget]
  rank --> confirm{Operator confirm when required?}
  confirm -->|no| preview[Preview only dry-run]
  confirm -->|yes| retain[Hindsight retain upsert]
  retain --> manifest[Update seed manifest]
  review --> preview
```

Notes:

- `seed --budget N --judge jev` ranks kept sections and retains the top N. Without `--budget`, every kept section is still eligible. Weights are in [jev.md](./jev.md).
- Default `--confidence` is `0.8` ([jev.md](./jev.md)).
- Missing `ORTO_TYPESAFE_API_KEY` with `--judge jev` is a hard error.
- Network / 429 / 5xx: warn once and fall back to heuristics unless `--strict`.

---

## New file adoption (`store`)

When a durable file appears that is not on the allowlist yet, Jev can propose adoption.
The operator still confirms. `store` never silently adopts new files.

```mermaid
flowchart TD
  newMd[New durable markdown on disk] --> preview[store dry-run buckets]
  preview --> inAllow{On store.allowlist?}
  inAllow -->|yes| changedPath[Treat as known path]
  inAllow -->|no| propose{judge jev?}
  propose -->|no| waitOps[Operator picks via prompt or files flag]
  propose -->|yes| jevAdopt[Jev: durable enough to allowlist?]
  jevAdopt --> adoptConf{confidence high?}
  adoptConf -->|no| waitOps
  adoptConf -->|yes| suggest[Propose allowlist entry]
  suggest --> waitOps
  waitOps --> confirmed{Operator confirms?}
  confirmed -->|no| leave[Leave file unstored]
  confirmed -->|yes| allow[Persist store.allowlist]
  allow --> extract[Extract and judge sections]
  changedPath --> extract
  extract --> retain[Retain selected sections]
```

---

## Changed content update

When a known source's hash changes, Orto re-extracts and upserts by `document_id`.
Jev can hold an edit that does not look durable (changelog noise, temporary notes) even though the path is already allowlisted.

```mermaid
flowchart TD
  edit[Known file content changed] --> hash[Hash differs from manifest]
  hash --> extract[Re-extract sections]
  extract --> sectionGone{Section still present?}
  sectionGone -->|no| pruneHint[Later prune: section-gone]
  sectionGone -->|yes| judgeOn{judge jev?}
  judgeOn -->|no| heuristic[Heuristic keep or skip]
  judgeOn -->|yes| jevDur[Jev durability and contradiction checks]
  jevDur --> gate{keep and confidence ok?}
  heuristic --> gate
  gate -->|hold or low confidence| queue[Preview or skip retain]
  gate -->|keep| upsert[Upsert same document_id]
  upsert --> manifest[Update content hash in manifest]
```

---

## Job split reminder

```mermaid
flowchart LR
  subgraph ortoOwns [Orto owns]
    scanOwn[Scan denylist hash]
    sideEffects[Retain upsert tombstone]
    prose[Missions ADRs in git]
  end

  subgraph jevReturns [Jev returns]
    choice[Choice]
    score[Score]
    noul[Noul]
    conf[Confidence]
  end

  scanOwn -->|"small state slice"| choice
  choice --> sideEffects
  score --> sideEffects
  noul --> sideEffects
  conf -->|"gate apply"| sideEffects
  prose -.->|"never authored by Jev"| prose
```

---

## Related

- [jev.md](./jev.md): product rule (judge, not backend)
- [jev-integration.md](./jev-integration.md): where Jev sits on the full pipeline
- [orto-cli-commands.md](./orto-cli-commands.md): `seed` / `store` flags including `--judge`
- [orto-sync-strategy.md](./orto-sync-strategy.md): why curated retain beats file upload
