# Hindsight Cloud with Orto

How teams use Orto against **[Hindsight Cloud](https://docs.hindsight.vectorize.io/)** (managed hosting) instead of, or in addition to, a local / self-hosted Hindsight Docker server.

Upstream:

- [Hindsight Cloud docs](https://docs.hindsight.vectorize.io/)
- [Getting started](https://docs.hindsight.vectorize.io/getting-started): org, bank, API key
- [Hindsight Academy](https://learn.hindsight.vectorize.io/): free hands-on courses with Cloud credits
- [MCP server](https://hindsight.vectorize.io/developer/mcp-server): single-bank vs multi-bank endpoints
- [Native MCP OAuth](https://hindsight.vectorize.io/blog/2026/03/30/mcp-oauth-native): interactive agent clients on Cloud

Orto stays **local-first by default**. Cloud is an **opt-in deployment profile**, not the happy-path default and never a forced dependency.

---

## Why support Cloud

| Audience | Why Cloud |
|----------|-----------|
| Solo / learning | Skip Docker + LLM wiring; [Academy](https://learn.hindsight.vectorize.io/) + free credits |
| Small teams | Shared bank without running a Hindsight server; org invites + RBAC |
| Orgs already on Cloud | Same Orto seed/MCP flow against managed API |
| Offline / regulated | Keep using local Docker / VPN / self-host: Cloud is optional |

Self-host remains first-class: `orto docker`, LAN/VPN/public profiles, full data control. Cloud is the managed alternative when infrastructure is the bottleneck, not when Orto should become cloud-only.

---

## Same product, different host

Orto’s CLI pipeline does not change:

```text
init → configure → [apply] → seed → mcp → (mental-model …)
```

What changes is **where** the bank lives and **how** agents authenticate:

| Concern | Local / self-host | Hindsight Cloud |
|---------|-------------------|-----------------|
| Base URL (REST) | `http://localhost:8888` (or LAN/VPN host) | `https://api.hindsight.vectorize.io` |
| Auth for `seed` / apply | Often optional locally; Bearer when tenant key set | **Required** API key (`hsk_…`) |
| Docker helper | `orto docker up` | Skip: managed infra |
| LLM for retain | You supply Ollama / OpenAI / etc. on the server | Managed by Cloud (credits / tokens) |
| Single-bank MCP | `{base}/mcp/{bankId}/` | `https://api.hindsight.vectorize.io/mcp/{bankId}/` (+ Bearer) **or** OAuth MCP host |
| Interactive MCP OAuth | N/A (local HTTP) | `https://mcp.hindsight.vectorize.io` ([native OAuth](https://hindsight.vectorize.io/blog/2026/03/30/mcp-oauth-native)) |
| Team access | Network profile + shared API key / VPN | Cloud org members, roles, (enterprise) SSO |
| Billing | Your infra + LLM spend | Cloud [token/credit usage](https://docs.hindsight.vectorize.io/) (retain, recall, reflect, mental models) |

Bank id, bank template, seed provenance, and mental-model declarations stay in `.orto/` and git. Secrets never do.

---

## Endpoints Orto must know

Documented Cloud surfaces:

| Use | URL | Notes |
|-----|-----|--------|
| REST API (SDK / `seed`) | `https://api.hindsight.vectorize.io` | Same path shape as OSS: `/v1/default/banks/{bank_id}/…` |
| Single-bank MCP + API key | `https://api.hindsight.vectorize.io/mcp/{bankId}/` | `Authorization: Bearer <api_key>` |
| Interactive MCP + OAuth | `https://mcp.hindsight.vectorize.io` | Client opens browser login; no key in config for many harnesses |
| Console | `https://ui.hindsight.vectorize.io` | Org, banks, API keys, team |

CLI URL resolution already supports override (`--hindsight-url`, `hindsightBaseUrl`, `ORTO_HINDSIGHT_URL`). Cloud support is primarily **profile defaults + auth UX + MCP emission**, not a second seed engine.

---

## Recommended deployment profile: `hindsight-cloud`

Phase 4 already plans profiles: **local / LAN**, **VPN**, **public** (self-host exposure). Add **`hindsight-cloud`** as a sibling managed profile.

### Config shape (proposed)

Portable (commit):

```json
{
  "version": 1,
  "name": "my-project",
  "provider": "hindsight",
  "bankId": "my-project",
  "root": ".",
  "deploymentProfile": "hindsight-cloud"
}
```

Environment / secrets (never commit):

```bash
export ORTO_HINDSIGHT_URL=https://api.hindsight.vectorize.io
export ORTO_HINDSIGHT_API_KEY=hsk_…   # from Cloud Connect → Create API Key
```

Optional committed non-secret hint (no keys):

```json
{
  "hindsightBaseUrl": "https://api.hindsight.vectorize.io"
}
```

Prefer env or a **local** profile overlay for the URL so teammates can use Cloud while the repo default stays local: or the reverse. Exact split lands with Phase 4 shareable config (`project` vs `environment/profile`).

### `init` / profile selection

When implementing:

1. Keep default profile **`local`** (Docker on localhost).
2. Interactive `init` (or later `orto share` / `profile set`) offers **Hindsight Cloud** as an explicit choice.
3. Choosing Cloud:
   - Sets profile + suggested `hindsightBaseUrl`
   - Skips / de-emphasizes Docker container prompts
   - Prints next steps: create org/bank at [ui.hindsight.vectorize.io](https://ui.hindsight.vectorize.io), create API key, set env vars
   - Points learners at [Hindsight Academy](https://learn.hindsight.vectorize.io/)
4. `--yes` without Cloud flags remains local-first.

Flags (illustrative): `--profile hindsight-cloud` or `--hindsight-url https://api.hindsight.vectorize.io`.

### Commands under Cloud

| Command | Behavior |
|---------|----------|
| `configure` | Unchanged: writes bank template locally |
| `configure --apply` / `bank apply` | REST against Cloud URL + API key |
| `seed` / `seed --dry-run` | Same retain pipeline; live seed **requires** API key; fails with actionable “set ORTO_HINDSIGHT_API_KEY from Cloud dashboard” |
| `docker *` | No-op or clear message: “Cloud profile: no local container” |
| `mcp` | Emit Cloud MCP URL(s); see below |
| `mental-model` | Same live API against Cloud |

---

## Agent wiring on Cloud

Two legitimate MCP modes:

### A. Bank-scoped + API key (closest to today’s local flow)

Best for: scripted setups, Cursor project `mcp.json` with env placeholders, CI-adjacent tooling.

```json
{
  "mcpServers": {
    "hindsight-my-project": {
      "type": "http",
      "url": "https://api.hindsight.vectorize.io/mcp/my-project/",
      "headers": {
        "Authorization": "Bearer ${env:ORTO_HINDSIGHT_API_KEY}"
      }
    }
  }
}
```

`orto mcp --include-auth` should keep using env placeholders for writes: never commit raw `hsk_` keys.

### B. Native OAuth MCP host (interactive IDEs)

Best for: humans connecting Claude Code / Cursor / Desktop to Cloud without pasting keys ([OAuth announcement](https://hindsight.vectorize.io/blog/2026/03/30/mcp-oauth-native)):

```json
{
  "mcpServers": {
    "hindsight": {
      "type": "http",
      "url": "https://mcp.hindsight.vectorize.io"
    }
  }
}
```

Caveats for Orto:

- OAuth host is **org/account-scoped**, not automatically single-bank URL path. Agents may need to pick bank / use multi-bank tools depending on Cloud MCP behavior.
- For **project company brains**, prefer mode A (bank-scoped URL) so AGENTS.md / Cursor rules point at one durable bank id matching `.orto/config.json`.
- Emit mode B as an optional snippet (`--mcp-auth oauth` or profile sub-option), not as the only Cloud path.

Recommendation: **default Cloud MCP emission = bank-scoped API URL + env API key** (parity with local single-bank focus). Document OAuth as an alternate for personal exploration.

---

## Team workflows

### Shared Cloud bank

1. One person creates the Cloud org + bank (bank id = project `bankId`).
2. Repo commits `.orto/` template + profile hint `hindsight-cloud` (no secrets).
3. Teammates: Cloud invite → personal or shared bot API key via secret channel → `export ORTO_HINDSIGHT_*` → `orto seed` / agents via MCP.
4. Role-based access and (enterprise) SSO live in Cloud: Orto does not reinvent IAM.

### Hybrid

- Seed from CI or a maintainer laptop against Cloud (`ORTO_HINDSIGHT_URL` + key).
- Developers use OAuth MCP for day-to-day reflect/recall without local Docker.
- Or: maintainers self-host; a subset of users mirrors to Cloud later (export/import is a Hindsight concern; Orto does not need a sync product in Phase 4).

### What not to do

- Commit API keys or OAuth tokens.
- Make Cloud the default for `init --yes`.
- Assume Cloud OAuth replaces bank-scoped MCP for multi-repo workspaces (bank-scoped names still matter: see [phase-4-dogfood-gaps.md](./phase-4-dogfood-gaps.md)).
- Treat Cloud credits as unlimited: seed and mental-model refresh consume retain / mental-model tokens.

---

## Security & data

- Cloud means project knowledge leaves the machine: acceptable for many teams, wrong for some. Profile choice should be explicit.
- Same Orto rules: never seed secrets ([sensitive-data.md](./sensitive-data.md)); retain mission already tells the bank to ignore credentials.
- Prefer short-lived or rotated API keys for bots; human OAuth for interactive MCP where available.
- Enterprise Cloud features (SSO, audit logs, Memory Defense) are org-side: document links, do not reimplement.

---

## Implementation checklist (Phase 5)

- [x] Documented profile `hindsight-cloud` alongside local / LAN / VPN / public
- [x] `share` / profile helper: choose Cloud, print dashboard + Academy links, skip Docker when Cloud
- [x] Validate live commands require API key when profile is Cloud
- [x] `mcp` emission: bank-scoped Cloud URL + env auth; optional OAuth via `--mcp-auth oauth`
- [x] `docker` commands: friendly skip under Cloud profile
- [x] README / quick start: Local Docker (default) vs Hindsight Cloud (opt-in)
- [x] Errors: 401/403 point at Cloud key creation / env setup
- [x] Tests: Cloud URL + MCP path resolution; no secrets in fixtures

CLI already resolves custom base URLs and Bearer keys: much of Cloud works today with:

```bash
export ORTO_HINDSIGHT_URL=https://api.hindsight.vectorize.io
export ORTO_HINDSIGHT_API_KEY=hsk_…
orto seed --dry-run
orto seed
orto mcp --hindsight-url https://api.hindsight.vectorize.io --include-auth --write
```

First-class support is naming the profile, tightening UX, and teaching the Cloud vs local trade-off: not inventing a separate product path.

---

## Open decisions

1. Whether committed `hindsightBaseUrl` for Cloud is OK (no secret) or profiles should keep all host URLs in local overlays only.
2. Default Cloud MCP mode: bank-scoped + API key (recommended) vs OAuth host.
3. Whether `orto docker` under Cloud profile errors hard or prints guidance and exits 0.
4. Bank create: rely on Cloud console / first API use vs always `bank apply` from template on first seed.

---

## Related

- [team-sharing.md](./team-sharing.md): all deployment profiles, `orto share`, team bootstrap
- [ROADMAP.md](../ROADMAP.md): Phase 5 team sharing status
- [phase-4-dogfood-gaps.md](./phase-4-dogfood-gaps.md): shareable config / MCP naming
- [orto-configs.md](./orto-configs.md): `.orto/` layout
- [cli-architecture.md](./cli-architecture.md): URL / API key resolution
- [mental-models.md](./mental-models.md): post-seed mental models (same on Cloud)
- [hindsight-mental-models.md](./hindsight-mental-models.md): design notes
