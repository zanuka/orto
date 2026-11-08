# Jev integration

[Jev](https://docs.typesafe.ai/introduction) (TypeSafe System One) is an opt-in judge for decisions Orto still makes with heuristics. Orto already scans a repo, hashes what it keeps, and retains that into a Hindsight bank. The open question is which of that work is worth retaining, what is stale, what should go first, and when a person should step in. Jev takes a small slice of that state and returns a typed answer with a confidence score. Orto keeps the side effects.

Product rule (judge, not backend): [jev.md](./jev.md).
Store and update flow diagrams: [jev-diagrams.md](./jev-diagrams.md).

The seed relevance gate is available: `orto seed --dry-run --judge jev` ([JEV-4](https://github.com/zanuka/orto/issues/30)).
Section-level keep/skip is part of that command ([JEV-5](https://github.com/zanuka/orto/issues/36)).
Each `orto:<path>#<section>` is its own row.
A README can retain an architecture section and skip a changelog section in one seed.
Headings the heuristic would drop, such as changelog, table of contents, and badges, are still judged when `--judge jev` is on.
Without the flag, those headings stay out of retain.
The rest of this page describes the wider layer that is still planned.

This is planned work:

- [Phase 7](../ROADMAP.md) on the roadmap
- [JEV-0](https://github.com/zanuka/orto/issues/58), the epic
- the open [`jev` issues](https://github.com/zanuka/orto/issues?q=is%3Aissue+is%3Aopen+label%3Ajev)

## Why

**Spend retain on durable knowledge.** Hindsight retain is the expensive step. Heuristics already drop a lot of noise, and changelogs, tables of contents, and boilerplate still get through often enough to matter. Jev scores a section before that spend.
The relevance questions (`is_durable`, `is_ephemeral`, `in_scope`, and the durability score), the `kind` choice, and the contradiction check run on `seed --judge jev` today.
Dry-run prints the kind, its probabilities, and any supersede or contradict relation.
A confident `noise` or `style_pref` is left out of the company bank.
A confident `supersedes` or `contradicts` relation retains the section once and records the old observation id.
The old observation is not deleted.
The same call asks `contains_secret` and `contains_pii`.
A confident secret or personal-data answer is skipped, and a secret warning names the path without printing the secret.
A mid-range score stays in review and is not retained.
After that gate, Hindsight previews the facts it would extract (read-only).
One Jev call per section asks whether each fact is in the source.
A high-confidence unsupported fact is left out of retain.
A quote of the section is kept.
This checks the Hindsight extractor.
It does not run a second extractor.

The same pass can score the generated mission and directives, and can propose mental-model questions and tags. The wording stays in the template you commit. `seed --dry-run --judge jev` shows the keep, the skip, and the score.

**Put the durable part of a large diff first.** A monorepo change can touch dozens of markdown files and contain only a few decisions. `seed --budget N --judge jev` ranks the retain queue and keeps the top N. The rest stay pending in the seed manifest. Dry-run prints the order and the cutoff. The same layer can also:

- propose which new files belong on the `store` allowlist (`store --propose-adopt --judge jev` prints the list; `--apply` writes it and does not retain)
- hold an edit that does not look durable (`store --judge jev` skips wording-only changes and reviews temporary workarounds)

You confirm before anything is retained.

**Remove knowledge that is no longer true.** `seed` and `store` add or upsert. Months later a doc can be irrelevant, a path can be gone, or a section can contradict the current tree. `orto prune` groups those cases and asks you to choose:

- source path no longer in the repo
- section no longer in the file
- a path or `document_id` you name
- with `--judge jev`, items scored as outdated, irrelevant, or contradicted, including when the file is still on disk

Jev annotates that prompt with a choice and a confidence score.
A low score is shown and left unchecked.
`--dry-run` prints the groups and does not delete.
After you confirm, Orto invalidates or deletes the chosen documents and tombstones them so the next `seed` or `store` does not put the same unchanged text back.
A mental-model refresh can be recommended in the same run and is its own confirmation.
Path-gone and section-gone groups work with no TypeSafe key.

**Act only when the decision is still real.** At read time, Jev can:

- rerank recalled passages
- flag a memory the docs no longer support
- choose `reflect`, `recall`, or a mental model

An agent `retain` through MCP is checked before it lands in the project bank. For Firstmate, Jev answers:

- whether the task needs this bank
- which bank
- whether the outcome is a knowledge update, a pull request, or both

A low score goes to the captain instead of a silent apply.

**Leave the default path local.**

- With no `ORTO_TYPESAFE_API_KEY` and no `--judge jev`, the CLI behaves as it does today and makes no TypeSafe call.
- A golden-set judge can score the offline heuristics so that default keep/skip improves for runs that never enable Jev.
- A public or Cloud share still waits on a safety check in Orto before anything is exposed.

## Where it sits

Solid arrows are actions Orto owns.
`orto prune` path-gone / section-gone / explicit delete is in the CLI.
The dotted Jev annotation into prune is planned and not shipped yet.
Dotted arrows exist only with `--judge jev`.
Jev never stores the bank and never writes the repo.
It returns a typed choice and a confidence score.
Orto retains, refuses, reranks, or applies after that, and a low score waits for you.

```mermaid
flowchart TD
  docs["Durable docs in git"]
  scan["Scan"]
  extract["Extract"]
  template["Bank template"]
  retain["Retain: seed or store"]
  bank["Hindsight bank"]
  read["Recall and reflect"]
  agents["Agents and Firstmate"]
  prune["orto prune after you confirm"]

  subgraph judge ["Opt-in judge"]
    jev["Jev"]
  end

  docs --> scan --> extract --> retain --> bank --> read --> agents
  template --> retain

  bank -->|"document ids still retained"| prune
  docs -->|"path or section gone"| prune
  prune -->|"delete after you confirm"| bank

  extract -.->|"section"| jev
  template -.->|"mission and directives"| jev
  bank -.->|"drift and overlap"| jev
  read -.->|"recalled passages"| jev
  agents -.->|"proposed retain or routing"| jev

  jev -.->|"keep or rank, then you confirm"| retain
  jev -.->|"rerank, route, or refuse"| read
  jev -.->|"stale or irrelevant"| prune
```

Secrets and denylisted paths stop at scan.
They do not reach extract, Jev, or Hindsight.
Inline tokens, private keys, and connection strings inside a seedable file are skipped when Jev state is built.
That text is not sent to TypeSafe.

## Boundary

- Hindsight remains the memory bank and the CLI default.
- Jev is a judge, reached with `--judge jev`.
- Missions, ADRs, MCP snippets, and mental-model prose stay in the repo.
- Secrets and denylisted paths stay on the machine.
- Retain, prune, and share stay in this CLI, behind the confidence gate.

Full product rule: [jev.md](./jev.md).
Store / update diagrams: [jev-diagrams.md](./jev-diagrams.md).
How those decisions show up in bank setup is in [company brain config](./company-brain.md).
