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
| 11.3 | `DATABASE_POOL_MAX` | Integer ≥1 configures the Postgres pool; invalid values fall back to the `pg` default |
| 11.4 | API-key prefix cache | Short-TTL in-memory cache, local invalidation on create/revoke; flag evaluation reads stay uncached (ADR-007 untouched) |

Deferred until the benchmark proves a bottleneck: flag-config caching (needs an
ADR-007 revision), SDK bulk/ETag usage, rate limiting, metrics, and the v2.1
feature set above.
