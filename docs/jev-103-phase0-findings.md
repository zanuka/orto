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

## Next commands (operator)

Stay in the zanuka-web project root (wherever that checkout lives).
Do not live-seed into bank id `zanuka-web` for retain experiments.

```bash
curl -sS http://localhost:8888/health
orto mental-model list
# After documenting probe questions and gold answers locally:
# ask reflect/recall against bank zanuka-web and grade answers.
# Then Phase 0.5:
# orto bank apply   # or documented mental-model create from template
# orto mental-model propose --judge jev --dry-run
```

## Log hygiene

Do not paste private absolute paths or personal interview transcript bodies into this file or the public issue.
Summaries and document id patterns are enough.
