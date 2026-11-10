# Retain tag vocabulary

Versioned Choice axes used by `seed --judge jev` so retained memories carry consistent Reflect filters.

Source of truth: [`src/judge/retain-tags.json`](../src/judge/retain-tags.json) (`version: 1`).
Orto composes confident answers into tags in code.
It does not invent free-form tag strings.

## Axes

Each axis is one Choice question on the same relevance call as `kind`.

| Axis | Tag prefix | Choices |
|------|------------|---------|
| `layer` | `layer:` | `interface`, `domain`, `platform`, `ops`, `docs` |
| `domain` | `domain:` | `product`, `engineering`, `process`, `security`, `other` |
| `stability` | `stability:` | `frozen`, `evolving` |

Examples:

- `layer:platform`
- `domain:engineering`
- `stability:frozen`

## Confidence

An axis is stamped only when its Choice confidence is at or above `--confidence` (default `0.8`).
Low-confidence or missing answers omit that axis.
They do not by themselves move a section into review.
Knowledge-kind gating is unchanged: retain still requires a confident retain disposition kind.

## Retain stamp

On retain, tags become:

```text
orto
kind:<source-kind>
knowledge:<kind-id>
layer:<choice>        # when confident
domain:<choice>       # when confident
stability:<choice>    # when confident
```

`seed --dry-run --judge jev` prints `retain-tags` and `bank-tags` for each row.

## Related

- Knowledge kind taxonomy: [jev.md](./jev.md#knowledge-kind) and `src/judge/knowledge-kinds.json`
- Mental model topic tags still use `knowledge:*` (see [hindsight-mental-models.md](./hindsight-mental-models.md))
- Catalog proposals for standing questions: `orto mental-model propose --judge jev`
