# Preventing sensitive data from being seeded

How Orto keeps secrets and low-value project noise out of Hindsight banks. Companion to [cli-architecture.md](./cli-architecture.md) and [dev-workflow.md](./dev-workflow.md).

## Goals

- Never retain API keys, tokens, private keys, or env secrets into a memory bank
- Prefer **missing** a file over injecting credentials or ephemeral config
- Keep the default `seed` path non-interactive and CI-friendly
- Make the policy readable so contributors and agents know what is in / out of scope

## Decision summary

| Decision | Choice | Why |
|----------|--------|-----|
| Primary filter | **Allowlist** of durable docs | Most of the repo should never be considered for seeding |
| Secrets | **Hard denylist** before extract/retain | Defense in depth if the allowlist widens later |
| Build / lock / CI noise | Out of scope today via allowlist; expand explicit noise denylist soon | Lockfiles and manifests are not durable “why” knowledge |
| Ignore wizard on every seed | **No** | Blocks automation; dry-run already shows candidates |
| User customization | **Config-based ignore** (planned), optional one-time wizard later | Explicit, version-controlled, progressive |

## Layer 1: Allowlist (what can be considered)

The scanner only looks for durable documentation shapes:

- `README.md`
- Root `STRATEGY.md` and `VISION.md` (the project vision)
- Markdown under `docs/`, `doc/`, `documentation/`
- ADR locations (`adr/`, `docs/adr/`, `docs/decisions/`, root `ADR*.md`, …)

`AGENTS.md` is intentionally excluded: it is agent harness wiring (integration surface), not institutional knowledge to retain.

Consequently, these are **not** seeded today even without a denylist hit:

- `node_modules/`, `dist/`, `build/`, `target/`, `_build/`, `deps/`
- `package.json`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `Cargo.lock`
- `Cargo.toml`, `mix.exs`, `go.mod`, and other language manifests
- `.github/workflows/`, `.gitlab-ci.yml`, and similar CI config
- Source trees (`src/`, `lib/`, …) as bulk code dumps

Seeding is for durable **project knowledge**, not for mirroring the repository into Hindsight.

## Layer 2: Sensitive denylist (never retain)

Implemented in `src/scanner/sensitive.ts` and applied in `findDurableSources` **before** extraction.

Even under `docs/`, matching paths are skipped.

### Environment and auth material

- `.env`, `.env.*`, `.envrc`
- `.npmrc`, `.pypirc` (often hold tokens)
- `auth.json`, `token.json`

### Credential / secret files

- `credentials.json` / `.yaml` / `.yml`
- `secrets.json` / `.yaml` / `.yml`
- `service-account*.json`
- Names matching `*credentials*` / `*secret*` with config-like extensions

### Keys and certs

- `*.pem`, `*.key`, `*.p12`, `*.pfx`, keystore/JKS
- `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519` (and prefixes)

### Sensitive directories (not traversed / not retained)

- `.ssh/`, `.aws/`, `.gnupg/`, `.kube/`
- `secrets/`, `credentials/`, `private-keys/`
- Dot-directories in general when walking docs trees (`node_modules`, `dist`, `build` also skipped)

### Sensitive-looking docs

Markdown that is usually a secret dump rather than architecture:

- `secrets.md`, `credentials.md`, `api-keys.md`, `private-keys.md`

### Bank template alignment

Generated Hindsight retain missions also tell the bank to ignore secrets/credentials during LLM extraction: a second line of defense after the scanner.

## Layer 3: How developers verify

Always preview before a live retain:

```bash
node dist/cli.js seed --dry-run
```

Confirm candidates do not include env files, credential docs, or unexpected paths. Live `seed` only retains what dry-run would list (plus incremental skip of unchanged sources).

## What we are not doing (yet)

### Required CLI wizard before every seed

Rejected as the default. Reasons:

- Breaks non-interactive / CI usage
- Repeats questions that belong in version-controlled config
- `--dry-run` is the review step for the happy path

### Planned follow-ups

1. **Broader noise denylist**: explicit excludes for lockfiles, package manifests, `.github/`, `.gitlab*`, language build dirs (`target`, `_build`, `deps`, etc.) even if scanning expands later
2. **Project ignore file**: e.g. `.orto/ignore` or `ignorePatterns` in `.orto/config.json` (gitignore-style), committed with the repo
3. **Optional one-time wizard**: during `configure` (or `orto ignore`) that *writes* ignore patterns; never a mandatory gate on each `seed`

## Implementation map

| Concern | Location |
|---------|----------|
| Sensitive path checks | `src/scanner/sensitive.ts` |
| Applied during discovery | `src/scanner/durable-sources.ts` |
| Unit tests | `src/scanner/sensitive.test.ts`, `src/scanner/durable-sources.test.ts` |
| Agent / contributor rules | `.cursor/rules/knowledge-curation.mdc`, `.cursor/rules/cli-architecture.mdc` |

When changing the denylist, update this doc and add a test case for the new pattern.

## Reporting gaps

If a real-world secret shape still reaches `--dry-run`, open an issue with a **redacted** path pattern (never paste the secret). Prefer tightening the denylist or allowlist over relying on Hindsight to filter credentials after retain.

## Related

- [cli-architecture.md](./cli-architecture.md): scanner and seed pipeline
- [dev-workflow.md](./dev-workflow.md): first seed and re-seed loop
- [AGENTS.md](../AGENTS.md): durable-over-ephemeral principle
- [SECURITY.md](../SECURITY.md): security reporting for the project
