# Switchboard v2 — Expansion Plan

This plan turns Switchboard from a single-environment demo into a small,
self-hosted, OpenFeature/OFREP-compatible feature flag platform that other
projects can integrate with.

The v1 application and API stay available. v2 adds projects, environments,
environment API keys, OFREP evaluation, and a Node/TypeScript SDK with an
OpenFeature provider.

## 1. Decisions

| Topic | Decision |
|---|---|
| Product direction | Self-hosted, open source, OpenFeature/OFREP-compatible |
| First vertical slice | Projects/environments + API keys + OFREP + Node/TS SDK |
| Database | Postgres primary; SQLite for local/test of the portable core |
| SDK | Node/TypeScript SDK + OpenFeature provider |
| API compatibility | `/api` stays; new `/api/v1` and `/ofrep/v1` |
| First release | `v2.0.0`: boolean flags + percentage rollout |
| Later | Targeting rules/segments, flag types, dashboard, audit/RBAC |
| Cost | €0 additional infrastructure; existing Go subscription |

## 2. Domain model

```text
project
  └── environment
        ├── flag
        │     ├── type: boolean (v2.0)
        │     ├── enabled
        │     └── default rule + percentage rollout
        ├── API key (server type, v2.0)
        └── evaluation context
```

Tables:

| Table | Fields | Notes |
|---|---|---|
| `projects` | `id`, `key`, `name`, timestamps | `key` unique |
| `environments` | `id`, `project_id`, `key`, `name` | `(project_id, key)` unique |
| `flags` | `id`, `project_id`, `key`, `type`, `description`, `legacy_id` | `(project_id, key)` unique; immutable key; `legacy_id` is the numeric v1 compatibility ID |
| `flag_configs` | `id`, `flag_id`, `environment_id`, `enabled`, `rollout_basis_points` | `(flag_id, environment_id)` unique |
| `api_keys` | `id`, `environment_id`, `type`, `name`, `prefix`, `hash`, `last_used_at`, `revoked_at` | secret returned once |
| `schema_migrations` | Kysely migrator state | managed by Kysely |

`rollout_basis_points` is `0..100000`; the API exposes `rolloutPercentage` with
up to three decimal places.

## 3. API surface

### Management API (v2.0)

| Method | Path | Auth |
|---|---|---|
| `POST/GET` | `/api/v1/projects` | `ADMIN_TOKEN` |
| `POST/GET` | `/api/v1/projects/:project/environments` | `ADMIN_TOKEN` |
| `POST/GET/PATCH` | `/api/v1/projects/:project/environments/:env/flags` | `ADMIN_TOKEN` |
| `POST/GET/DELETE` | `/api/v1/projects/:project/environments/:env/api-keys` | `ADMIN_TOKEN` |

The management API is defined by the route JSON schemas, tests, and this table;
a separate management OpenAPI document is deferred to v2.1 (ADR-021).

### OFREP

- `POST /ofrep/v1/evaluate/flags` — bulk evaluation.
- `POST /ofrep/v1/evaluate/flags/:key` — single evaluation.
- Auth: `X-API-Key: sb_srv_...` or `Authorization: Bearer sb_srv_...`.
- Context: `targetingKey` + attributes; `targetingKey` maps to the user ID.

### Legacy

- `/api/evaluate` remains public; it maps to the default project/environment
  and uses the v1 bucket algorithm.
- `/api/flags` keeps the existing `ADMIN_TOKEN` contract and maps to the
  default environment.
- In v2 mode, legacy routes use a compatibility repository over the v2 schema.
  In v1 mode, they keep using the original SQLite repository.

## 4. Bucketing

- v2 projects: 100,000 buckets; `bucket < rollout_basis_points`; 0.001%
  precision.
- Hash: `SHA-256(projectKey + ":" + flagKey + ":" + targetingKey)`.
- Environment-independent: the same user keeps the same bucket across
  environments.
- Default/legacy project: the old `SHA-256(flagKey + ":" + userId)` and 100
  buckets stay unchanged.
- `%20 → %40` remains monotonic.

## 5. Package layout

```text
/                       # existing Fastify app
packages/
  sdk-node/             # TypeScript SDK
  openfeature-provider/ # OpenFeature provider
db/
  migrations/           # Kysely migrations
scripts/
  migrate-sqlite-to-postgres.mjs
examples/
  service-a/
  service-b/
```

The server remains JavaScript; SDK/provider are TypeScript. Package names are
provisional; v2.0 does not publish to npm.

## 6. Phases and tasks

### Phase 0 — Contracts and skeleton

| ID | Task | Acceptance |
|---|---|---|
| 0.1 | ADRs: Postgres/Kysely, API versioning, API keys, bucketing, OFREP scope | `docs/DECISIONS.md` updated |
| 0.2 | OFREP + management OpenAPI/contract fixtures | Contract examples prepared |
| 0.3 | Workspace skeleton + dual-dialect spike | Root `npm test` still green; minimal project read/write on Postgres and SQLite, or a documented fallback |

### Phase 1 — Postgres core and migration

| ID | Task | Acceptance |
|---|---|---|
| 1.1 | Docker Compose Postgres + migration runner | Postgres healthy; migrations run |
| 1.2 | Schema and migrations | Constraints/indexes; clean DB migrates |
| 1.3 | Project/environment/flag/config repositories | Isolation tests; SQL only in repositories |
| 1.4 | API key repository | Hash/prefix; secret once |
| 1.5 | SQLite → Postgres migration + legacy compatibility | Fixture flags move to default project/environment; legacy API results identical |

### Phase 2 — Management API

| ID | Task | Acceptance |
|---|---|---|
| 2.1 | Project/environment API | Create/list/get; `ADMIN_TOKEN`; 401/409 |
| 2.2 | Flag CRUD | Boolean; enabled/rollout; validation; 201/200/400/404 |
| 2.3 | API key management | Create/list/revoke; secret once; hash; 401 |
| 2.4 | Contract/error tests + OpenAPI validation | New endpoints tested; consistent error envelope |

### Phase 3 — OFREP evaluation

| ID | Task | Acceptance |
|---|---|---|
| 3.1 | Evaluation context and v2 bucket | `targetingKey`; 100k buckets; legacy bucket split |
| 3.2 | OFREP single/bulk endpoints | Spec-compliant responses; environment API key auth |
| 3.3 | OFREP contract + official provider test | OpenAPI fixtures; official OFREP provider evaluates |
| 3.4 | Isolation, monotonicity, security tests | Project A/B separation; revoked key 401; 20→40 subset |

### Phase 4 — SDK and OpenFeature provider

| ID | Task | Acceptance |
|---|---|---|
| 4.1 | `sdk-node` TypeScript scaffold + build | ESM exports; types; package build |
| 4.2 | SDK boolean evaluation + fallback/timeout | Mock server tests; 503/network fallback |
| 4.3 | OpenFeature provider | `targetingKey`/attributes; `@openfeature/server-sdk` test |
| 4.4 | Two example services + package READMEs | Two services use the same flag; same user same result |

### Phase 5 — Demo, Docker, documentation

| ID | Task | Acceptance |
|---|---|---|
| 5.1 | Admin UI: project/environment, API key display | Current demo works; key shown once |
| 5.2 | Full Docker Compose + smoke | Postgres + app; migration; health; restart/down-up |
| 5.3 | README, migration guide, OFREP/SDK docs | English; clean checkout works |
| 5.4 | 2–3 minute silent video + evidence | Two services, isolation, 20→40, legacy API |

### Phase 6 — Hardening and release

| ID | Task | Acceptance |
|---|---|---|
| 6.1 | Security/performance: key hash, scopes, body limits, leaks, indexes | Checklist + tests |
| 6.2 | Independent review + fixes | No blockers/majors; tests twice green |
| 6.3 | `v2.0.0` version + tag + push | Main clean; release evidence complete |

## 7. Acceptance criteria

- `npm test` (unit) + `npm run test:db` (Postgres) + `npm run test:contract`
  (OFREP) are green.
- Legacy `/api/evaluate` fixture results are identical to v1.
- Default project/environment migration preserves flag settings.
- Project/environment isolation: wrong API key `401`; cross-project access
  `403/404`.
- Revoked key `401`; no plaintext key in DB or logs.
- Official OFREP provider evaluates against the service.
- SDK 503/network fallback and timeout are tested.
- Two example services use the same flag; the same user gets the same result.
- `%20 → %40` preserves the previous included set.
- Docker Compose starts Postgres + app; restart/down-up persists data.
- README, migration guide, OFREP/SDK docs, and video are updated from real
  evidence.

## 8. Agents, review, and git

- Implementer A: Postgres, repositories, management API.
- Implementer B: SDK + OpenFeature provider after contracts freeze.
- Verifier: read-only, fresh context, per phase.
- Docs/demo: after API freeze.
- At most two parallel workers; DeepSeek V4.1 Flash `max`.
- Every task: commit SHA + diff + real test output. Orchestrator reviews,
  reruns tests, and pushes.
- Parallel work uses short-lived `task/<id>` branches; `main` stays green.
- Final `v2.0.0` tag.

## 9. Cost

| Item | Cost |
|---|---|
| Postgres/Docker/local | €0 |
| OpenFeature/OFREP/npm packages | €0 |
| Cloud/deploy | €0 (not in the first release) |
| Model | Existing Go subscription; no extra cash |
| Estimated effort | 6 phases, 27 small tasks; about 4–6 sessions |

If Go usage approaches the limit or the estimate exceeds $5, stop and ask.

## 10. Risks and out of scope

**Risks:** OFREP compliance, dual-dialect cost, API key security, legacy bucket
compatibility, migration, monorepo tooling, scope creep.

**Out of scope for v2.0:** targeting rules/segments, string/number/JSON flag
types, full admin dashboard, audit log, RBAC/SSO, browser SDK, A/B experiments,
SaaS billing, Kubernetes/Helm, streaming/SSE. These are v2.1+.

## 11. v2.1 performance/ops track (approved)

Small, purpose-safe performance and operations work that does not change the
evaluation contract or the v2.0 scope boundaries. Task brief:
`docs/tasks/082-perf-baseline-and-quickwins.md`.

| ID | Item | Acceptance |
|---|---|---|
| 11.1 | Load-test script + baseline | `npm run bench` prints real single/bulk numbers for SQLite (and Postgres with `DATABASE_URL`); baseline recorded in EVIDENCE before optimization |
| 11.2 | `/readyz` storage probe | 200 with storage up; 503 `EVALUATION_UNAVAILABLE` on storage failure; `/healthz` stays cheap |
| 11.3 | `DATABASE_POOL_MAX` | Integer `1..1000` configures the Postgres pool; invalid values fall back to the `pg` default |
| 11.4 | API-key prefix cache | Short-TTL in-memory cache, local invalidation on create/revoke; flag/config reads stay uncached (ADR-007 applies to them; ADR-023 covers auth lookups) |

Deferred until the benchmark proves a bottleneck: flag-config caching (needs an
ADR-007 revision), SDK bulk/ETag usage, rate limiting, metrics, and the v2.1
feature set above.

## 12. v2.1 SDK track (approved)

Task 083 (`docs/tasks/083-sdk-bulk-etag.md`) moves the client side to the bulk
OFREP endpoint that the server already supports:

| ID | Item | Acceptance |
|---|---|---|
| 12.1 | SDK bulk + per-context cache | `bulkEvaluation` option; one request for many flags; full-context cache key; bounded LRU (`maxCachedContexts`) |
| 12.2 | ETag conditional refresh | `If-None-Match` + `304` reuses the cache; `200` replaces it |
| 12.3 | Polling + retries | Opt-in background polling (`pollingIntervalMs`, default 0, unref'ed timers, `close()`), `cacheTtlMs` freshness, bounded retry/backoff on network/5xx only |
| 12.4 | Provider integration | Bulk enabled by default in `SwitchboardProvider`; `onClose()` clears timers |

Direct SDK users keep the single-flag path unless they opt in; the provider
opts in by default. No server changes, no persistent client cache, and no
stale-if-error policy in this task.

## 13. v2.1 portability track (approved)

Task 084 (`docs/tasks/084-config-export-import.md`) adds dependency-free
configuration transfer for backups and CI seeding.

| ID | Item | Acceptance |
|---|---|---|
| 13.1 | JSON export | Projects/environments/flags/configs in a versioned format; no API keys or secrets |
| 13.2 | Idempotent import | Create missing definitions, update configs, never delete/rename; one transaction |
| 13.3 | CLI + dry run | `export:config` / `import:config` use `DATABASE_URL` or `V2_DB_PATH`; dry run writes nothing |
| 13.4 | Validation | Reject unknown format/version, non-boolean types, invalid keys/rollout without partial writes |

Landed on `main` in `eb3e9d0`; see the task status for test evidence. No HTTP
endpoints, deletion, or secret export in this track.

Items 12.1–12.4 landed on `main` on 2026-10-21 (`9ab77b8`, `c367a82`,
`1b4d26d`); test evidence and the remaining out-of-scope list are recorded in
the task status at `docs/tasks/083-sdk-bulk-etag.md`.

## 14. v2.1 observability track (approved)

Task 085 (`docs/tasks/085-metrics.md`) adds a small, dependency-free Prometheus
endpoint.

| ID | Item | Acceptance |
|---|---|---|
| 14.1 | `GET /metrics` | Prometheus text 0.0.4 with HELP/TYPE; public, no-store |
| 14.2 | Bounded labels | Route templates, methods, statuses, evaluation reasons; no user/flag/key labels |
| 14.3 | Coverage | HTTP requests/latency histogram, evaluations, DB failures mapped to 503; tested without cross-app leakage |

Landed on `main` in `d5ccbba`; see the task status for test evidence. No
OpenTelemetry, dashboards, alert rules, persistent metrics, or `/metrics`
authentication in this track.

## 15. v2.1 lifecycle track (approved)

Task 086 (`docs/tasks/086-flag-deletion.md`) adds project-scoped flag deletion.

| ID | Item | Acceptance |
|---|---|---|
| 15.1 | Delete endpoint | `DELETE /api/v1/projects/:project/flags/:key`; 200/404/401 envelope |
| 15.2 | Cascade + isolation | All environment configs removed; same key in another project unaffected; API keys untouched |
| 15.3 | Lifecycle semantics | No rename/soft delete; recreation gets a new UUID and next per-project `legacy_id`; OFREP/legacy reads reflect deletion |

Landed on `main` in `6443faf`; see the task status for test evidence. Out of
scope: restore/audit, UI delete control, legacy DELETE, and project/environment
deletion.

## 16. v2.1 distribution track (approved)

Task 087 (`docs/tasks/087-package-install.md`) verifies that the SDK and
provider install outside the monorepo.

| ID | Item | Acceptance |
|---|---|---|
| 16.1 | Tarball verification | `npm run test:packages` builds, packs, installs both tarballs into a temp consumer, and evaluates via SDK + provider |
| 16.2 | Package metadata | `license`, `repository.directory`, `engines`, `files`; LICENSE in both tarballs; still `private: true` |
| 16.3 | Publish checklist | README documents the release steps and credentials requirement; actual publish remains out of scope |

Landed on `main` in `7d3f02f`; see the task status for test evidence. No
registry automation, provenance, signing, or GitHub Packages in this track.

## 17. v2.1 flag types track (approved)

Task 088 (`docs/tasks/088-flag-types-server.md`) and Task 089 extend flags
beyond boolean while keeping deterministic percentage rollout.

| ID | Item | Acceptance |
|---|---|---|
| 17.1 | Types + values | `boolean`, `string`, `number`, `json` (plain object); immutable type; onValue/offValue for non-boolean |
| 17.2 | Deterministic evaluation | Included → onValue, excluded/disabled → offValue; boolean semantics unchanged |
| 17.3 | OFREP + management | Typed values/reasons/variants; ETag includes type/values; validation envelopes |
| 17.4 | Legacy + transfer | Legacy stays boolean-only; export/import round-trips all types |
| 17.5 | SDK/provider | Typed getters and OpenFeature resolution for string/number/object |

Landed on `main` in `46a04f5` (server core) and `feat: add typed flag support to
sdk and provider` (SDK/provider); see the task statuses and `docs/EVIDENCE.md`
for test evidence. Out of scope: targeting rules, variants/weights, UI controls,
flag type changes, and non-boolean legacy API support.
