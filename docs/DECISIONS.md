# Decision Record (ADR-lite)

This file briefly records the important technical decisions in Switchboard and
their consequences. If a new decision supersedes an existing one, the old record
is not deleted; a new ADR is added and the relationship is stated.

## ADR-001 — SHA-256 for deterministic bucketing

**Context:** The same user must always get the same result for the same flag and
rollout settings. When the percentage increases, the previously included group
must be preserved.

**Decision:** The first 32 bits of the `SHA-256(flagKey + ":" + userId)` hash
are mapped to the 0–99 range. A user is included when
`bucket < rolloutPercentage`.

**Consequences:**
- Changing the percentage does not re-hash; on a `%20 → %40` move, the previous
  set is preserved.
- Node's built-in `crypto` module is sufficient; no extra dependency.
- `flagKey` is treated as immutable. Renaming changes groups.
- The algorithm version is fixed in code. Changing it redistributes user
  groups.

## ADR-002 — 200 + FLAG_NOT_FOUND for an unknown flag

**Context:** Calling applications may encounter an unknown flag. Is that a
service failure or a normal "off" state?

**Decision:** An unknown flag returns `200`; `enabled:false`,
`reason:"FLAG_NOT_FOUND"`, `bucket:null`, `rolloutPercentage:null`.

**Consequences:**
- There is a single success path on the client; 404 is not handled separately.
- A flag being deleted or never created does not stop the calling application.
- The admin API still returns `404` for an unknown flag; this distinction is
  explained in the README.

## ADR-003 — 503 on DB failure, no silent fallback

**Context:** If SQLite cannot be opened or a query fails, evaluation cannot
happen. Silently returning `true` or `false` could be misleading.

**Decision:** A DB failure during evaluation returns `503` +
`EVALUATION_UNAVAILABLE`. In that case the example client falls back to `false`
and logs it.

**Consequences:**
- Service failure is distinguished from "flag off".
- There is no fail-open; flags do not replace authorization.
- The calling application explicitly chooses its own fallback policy.

## ADR-004 — Single Bearer token for admin

**Context:** A user account system is unnecessary for a small,
single-environment demo service.

**Decision:** Admin endpoints are protected by the `ADMIN_TOKEN` environment
variable and `Authorization: Bearer`. Comparison uses `timingSafeEqual`.
`/api/evaluate` and `/healthz` remain public.

**Consequences:**
- Setup is simple; the token never enters the repository.
- This is not production-grade authentication; the README states this
  explicitly.
- Multi-user administration, RBAC, and audit logs are out of scope.

## ADR-005 — SQLite + better-sqlite3

**Context:** The target is a single instance, low traffic, persistence, and
simple setup.

**Decision:** SQLite file; `better-sqlite3` synchronous API; WAL mode; Docker
volume.

**Consequences:**
- No extra database server; local startup is easy.
- Synchronous queries are sufficient for a single instance; high concurrency is
  not a goal.
- The Docker image may need build tools for the native module; the smoke test
  verifies this. If problems arise, the `node:sqlite` alternative is evaluated.

## ADR-006 — flagKey immutable

**Context:** Bucketing is based on `flagKey`. If the key changes, every user's
bucket changes.

**Decision:** A flag key cannot be changed after creation; there is no rename
endpoint.

**Consequences:**
- Determinism is preserved.
- A user who wants to change the key creates a new flag; this resets rollout
  history.
- The README includes the "keep the key stable" warning.

## ADR-007 — No cache during evaluation

**Context:** There is a single instance and a small data set. A cache introduces
inconsistency after updates and additional complexity.

**Decision:** Every flag/config evaluation reads from SQLite; no cache.
(ADR-023 adds a short-TTL cache for API-key authentication lookups only; flag
and config reads stay uncached.)

**Consequences:**
- Updates are visible on the next request.
- SQLite read cost is acceptable at this scale.
- Horizontal scaling and flag-config caching are out of scope.

## ADR-008 — Trunk-based git and a push for every green task

**Context:** The user wants a push to GitHub for every meaningful change.
Progress should not skip review.

**Decision:** Small commits on `main` for sequential work; short-lived
`task/<id>` branches for parallel work. Subagents commit; the orchestrator
pushes after checking the diff + tests. Definition of Done includes the push.

**Consequences:**
- `main` always stays green.
- Push history stays small and understandable.
- Force-push and secret commits are forbidden.

## ADR-009 — Central docs + task briefs

**Context:** A small number of durable documents is more readable than many
scattered task reports.

**Decision:** `docs/PLAN.md`, `docs/DECISIONS.md`, and `docs/EVIDENCE.md` are
central; `docs/tasks/NN-*.md` is used only for the short briefs handed to
subagents.

**Consequences:**
- Durable knowledge lives in one place; task briefs are temporary.
- The README is the main gateway to the outside world.
- Every task brief includes acceptance criteria and file boundaries.

## ADR-010 — Silent video + on-screen captions

**Context:** The short demo video should be understandable without a voiceover.

**Decision:** A 1–2 minute silent screen recording; short on-screen text at
critical steps; command output and timestamped evidence in the README.

**Consequences:**
- Video production and viewing are easy.
- Technical detail stays in the README and `EVIDENCE.md`.
- A voiceover version can be added separately if requested.

## ADR-011 — Build fallback in the deps stage for better-sqlite3 in Docker

**Context:** `better-sqlite3` is a native module. In this environment, the
prebuilt binary could not be downloaded during the Docker build.

**Decision:** The Dockerfile first tries `npm ci --omit=dev`; if that fails, it
installs `python3 make g++` only in the deps stage, compiles, and removes them
in the same stage. The runtime image runs as the non-root `node` user.

**Consequences:**
- The first build may take longer; no build tools remain in the runtime image.
- The smoke test verifies build, health, restart, and volume persistence.
- If the prebuilt binary works in the future, the fallback is not triggered.

## ADR-012 — Dev-only Playwright-core for demo recording

**Context:** The demo video should show real UI interactions; application
dependencies should not grow.

**Decision:** `scripts/record-demo.mjs` uses the `playwright-core` devDependency
and system Chrome. Playwright's FFmpeg component is downloaded once for the
video codec; MP4 conversion uses system `ffmpeg`. Because the production Docker
image uses `npm ci --omit=dev`, Playwright does not enter the image.

**Consequences:**
- Video is produced from real browser interaction; there is no browser-panel
  dependency.
- Recording requires local Chrome and the one-time FFmpeg component.
- The video is added as evidence at `demo/switchboard-demo.mp4`.

## ADR-013 — OpenFeature/OFREP as the integration contract

**Context:** Other projects need a vendor-neutral way to consume Switchboard.
A bespoke SDK alone would lock integrations to this repository.

**Decision:** Implement the OFREP 0.4 core API and provide a thin Node/TS SDK
plus an OpenFeature provider. OFREP is the evaluation boundary; the management
API remains a normal REST API.

**Consequences:**
- Existing OFREP providers can talk to Switchboard without custom code.
- The OpenFeature provider and SDK share the same evaluation contract.
- The OFREP OpenAPI spec becomes the source of truth for contract tests.
- SSE/event streams are out of scope for v2.0; polling/per-request evaluation
  remains available.

## ADR-014 — Project/environment model with environment API keys

**Context:** A single global flag namespace cannot safely serve multiple
projects or separate staging from production.

**Decision:** Add `projects` → `environments` → `flags` → `flag_configs`.
Evaluation requests authenticate with environment-scoped server API keys.
Secrets are returned once and stored as SHA-256 hashes with a lookup prefix.

**Consequences:**
- Project and environment isolation becomes a first-class invariant.
- The legacy API maps to a seeded `default` project and `production`
  environment.
- Client/browser keys and scopes are deferred to v2.1; server keys only in
  v2.0.
- `ADMIN_TOKEN` remains the bootstrap/admin credential in v2.0; RBAC/SSO is
  deferred.

## ADR-015 — Postgres primary, Kysely dual dialect for the portable core

**Context:** The demo used SQLite. Other projects need concurrent access and
a realistic self-hosted deployment, but tests should stay fast.

**Decision:** Postgres is the production target. Kysely provides a shared
repository layer; the v2 core schema is portable enough to run on SQLite for
local/test usage. Advanced features such as targeting JSON may become
Postgres-first in v2.1.

**Consequences:**
- Production deployments can use multiple app instances.
- SQLite remains useful for local demos and fast tests.
- Dual-dialect SQL must be covered by integration tests; a feasibility spike
  happens before committing to it.
- If dual-dialect cost becomes disproportionate, the fallback is documented:
  Postgres-only v2 with SQLite retained for the legacy v1 path.

## ADR-016 — 100,000 v2 buckets, legacy bucketing unchanged

**Context:** The v1 algorithm used 100 buckets and integer percentages.
Increasing precision requires more buckets, but changing the hash would
reshuffle existing users.

**Decision:** v2 projects use 100,000 buckets and
`rollout_basis_points` (0–100,000), with hash input
`projectKey + ":" + flagKey + ":" + targetingKey`. The default/legacy project
keeps the v1 `flagKey + ":" + userId` hash and 100 buckets.

**Consequences:**
- v2 supports 0.001% rollout precision.
- The same user stays in the same bucket across environments.
- v1 users do not move when the platform is upgraded.
- The algorithm version boundary is explicit and tested.

## ADR-017 — Backward-compatible API and one-way data migration

**Context:** Existing clients and demos use `/api/flags` and `/api/evaluate`.
The expansion must not break them.

**Decision:** Keep the legacy routes and response shapes. In v2 mode, a
compatibility repository maps them to the default project/environment. Provide
a SQLite → Postgres migration script that copies v1 flags into the default
project/environment; the old database file is left untouched as a backup.

**Consequences:**
- Existing integrations keep working after the upgrade.
- The migration is one-way and explicit; it does not silently delete v1 data.
- Legacy evaluation uses the v1 bucket algorithm, while new projects use v2
  bucketing.
- Documentation must state which surface is legacy and which is current.

## ADR-018 — Root app plus npm workspaces for SDK packages

**Context:** A reusable SDK and provider should be installable independently,
without moving the existing Fastify application and its tests.

**Decision:** Keep the Fastify app at the repository root. Add
`packages/sdk-node` and `packages/openfeature-provider` as npm workspaces. The
server stays JavaScript; SDK/provider are TypeScript.

**Consequences:**
- The root app and Docker image remain simple.
- SDK packages can be built and tested independently.
- Package names are provisional in v2.0; npm publishing is not required for the
  first release.
- Workspace builds/tests become part of the root test pipeline.

## ADR-019 — Numeric `legacy_id` compatibility column

**Context:** v1 `/api/flags` exposed an auto-increment integer `id`. v2 uses
UUIDs internally, but existing clients may store or compare the numeric ID.

**Decision:** `flags.legacy_id` is a nullable integer, unique per project.
Migration 002 backfills existing rows; the v1→v2 migration preserves the old
SQLite `id`; new flags receive `max(legacy_id) + 1` inside the project
transaction, with retry on a concurrent unique conflict. Legacy responses use
`legacy_id`; v2 management responses keep the UUID `id`.

**Consequences:**
- Legacy clients keep the same numeric IDs after the upgrade.
- Per-project numbering means two projects can both start at `1`; the legacy
  API only exposes the default project.
- A pre-existing default-project v2 flag can occupy a number before a legacy
  import; the import then allocates the next free number instead of
  overwriting rows.
- `legacy_id` is not a v2 public identifier and is not used for evaluation.

## ADR-020 — OFREP-native error bodies and quoted ETags

**Context:** OFREP clients parse failure responses and conditional bulk
responses. The generic `{error:{code,message}}` envelope and an unquoted ETag
are not OFREP-shaped.

**Decision:** The OFREP plugin installs its own error handler:
- single `400` → `evaluationFailure` (`key`, `errorCode`, `errorDetails`);
- bulk `400` → `bulkEvaluationFailure` (`errorCode`, `errorDetails`);
- `500` and storage `503` → `generalErrorResponse` (`errorDetails`).
OFREP has no 503 in the vendored spec; storage failures intentionally use
`503` with `errorDetails` so callers can distinguish availability from a flag
decision. Bulk ETags are quoted, based on project key, flag keys, targeting key,
rollout, and enabled state; `If-None-Match` accepts quoted or unquoted values,
and `304` repeats the `ETag` header.

**Consequences:**
- Official OFREP providers can parse errors and cache validators.
- Authentication responses keep the shared envelope because the key hook sends
  them directly.
- ETag is a cache validator, not a security boundary; project key is included
  to prevent cross-project validator reuse.

## ADR-021 — Management API OpenAPI is deferred

**Context:** The OFREP contract is the external integration boundary and has a
vendored OpenAPI document plus contract tests. The `/api/v1` management API is
used by the demo UI and operators, and its request bodies are already validated
by Fastify JSON schemas.

**Decision:** v2.0 does not ship a separate management OpenAPI document. The
README endpoint table, JSON schemas in `src/v2/schemas.js`, and route tests are
the management contract. OFREP remains the only OpenAPI-driven contract.

**Consequences:**
- There is no second spec to drift from the route schemas before the API
  surface stabilizes.
- A management OpenAPI document can be generated or written in v2.1 when
  project-scoped admin keys and more flag types exist.
- This deferral is explicit, not an accidental omission.

## ADR-022 — Readiness probe separated from liveness

**Context:** Container orchestrators and Compose need to know whether storage is
usable, not merely whether the process is running. `/healthz` must stay cheap and
independent so a storage problem does not cause the process to be restarted.

**Decision:** `GET /readyz` performs a storage ping (`select 1` through Kysely in
v2, `SELECT 1` on `better-sqlite3` in v1) bounded by a 2-second timeout. On
failure or timeout it returns `503` with the shared
`{ error: { code: 'EVALUATION_UNAVAILABLE', message: 'Flag storage is unavailable' } }`
envelope, logs only the error code at warn level, and never leaks internals.
`/healthz` remains `{ status: 'ok' }` with no I/O. With an injected repository
and no owned storage there is nothing to probe, so the endpoint reports ready.
The endpoint is public like `/healthz`.

**Consequences:**
- Readiness reflects storage, not just process liveness.
- A partitioned database cannot hang the probe indefinitely.
- A failing probe does not change evaluation semantics.
- No auth is added because the probe exposes no tenant data.

## ADR-023 — Short-TTL API-key prefix cache

**Context:** Every OFREP evaluation looked up the API key prefix in the database,
adding one query per request on top of the flag/config read.

**Decision:** Cache found api-key lookup rows in memory per Kysely db instance,
using a module-level `WeakMap` so the auth hook and management routes share
entries. The TTL is 5000 ms and only positive entries are cached; unknown
prefixes are not cached. The whole cache is invalidated on create and revoke, and
cached `last_used_at` is refreshed when the throttled touch writes. A per-cache
generation counter prevents an in-flight lookup from re-caching a row after an
invalidation, and expired entries are swept on access. Flag/config evaluation
reads stay uncached; ADR-007 remains in force for them.

**Consequences:**
- One fewer DB query per evaluation.
- Revocation invalidates the local cache immediately; a lookup already in
  flight may still return its pre-revocation row to that request.
- Multi-instance deployments may serve a revoked key for up to 5 seconds.
- The cache is process-local and disappears on restart.
- Newly created keys are never shadowed by a negative cache.
- Expired entries no longer accumulate indefinitely.

## ADR-024 — Client-side bulk cache and conditional refresh

**Context:** The server already supports bulk OFREP evaluation and quoted ETags
with `304 Not Modified` (ADR-020). A per-flag client multiplies network calls by
the number of flags a service evaluates for one context, even though the same
flag set is usually evaluated repeatedly for that context.

**Decision:** The Node SDK offers opt-in bulk mode (`bulkEvaluation`, default
`false`). In bulk mode it calls `POST /ofrep/v1/evaluate/flags`, caches the flag
set per evaluation context (keyed by the full context in stable key order), and
treats entries as fresh for `cacheTtlMs` (default 10000 ms; `0` forces a
conditional refresh on every evaluation, and a `304` may still reuse the last
fetched flag set). A stale entry is refreshed with `If-None-Match`: `304`
refreshes the timestamp and keeps the cached flags, `200` replaces the entry.
The cache is bounded by `maxCachedContexts` (default 1000) with LRU eviction that
also clears the entry's polling timer. One request is in flight per context. Background
polling is opt-in (`pollingIntervalMs`, default `0`; timers are `unref()`ed),
and `close()` clears all timers and cache entries. Transport retries are bounded
(`maxRetries`, default 2, exponential backoff with jitter) and apply only to
network errors, timeouts, and 5xx responses, never 4xx. On final failure the
client returns the default with an error code; it does not serve stale values.
The OpenFeature provider enables bulk by default (explicit `bulkEvaluation:
false` wins) and leaves polling off.

**Consequences:**
- One bulk request serves many flag evaluations for the same context.
- Staleness is bounded by `cacheTtlMs`; polling is only needed for long-lived,
  stable contexts.
- Cache state is process-local and disappears on restart; multiple service
  instances do not share it.
- Memory and timer count are bounded by `maxCachedContexts`.
- Polling and shorter TTLs trade request volume for freshness.
- There is no stale-if-error behavior; callers keep their own fallback policy
  (ADR-003).
- Per-flag mode remains the default for direct SDK users, so existing behavior
  is unchanged unless bulk is requested.

## ADR-025 — Versioned JSON configuration transfer

**Context:** Self-hosted users need to back up flag definitions, seed CI/test
instances, and copy a project between environments without hand-editing SQL.
Copying API keys would move secrets between instances and is not acceptable.

**Decision:** Provide a dependency-free JSON export/import format
(`switchboard-v2-export`, version `1`) implemented in
`src/v2/repositories/transfer.js` and exposed through
`npm run export:config` / `npm run import:config`. Keys are the identity; UUIDs
and legacy IDs are not exported. Import is additive and idempotent inside one
transaction: it creates missing projects/environments/flags, updates flag
descriptions and configs, and never deletes or renames. A `--dry-run` performs
validation and counts, then rolls back the configuration writes; on a fresh path
the schema and default project may still be bootstrapped. No API-key, hash,
prefix, or secret field is exported or imported. This is a CLI, not an HTTP
endpoint.

**Consequences:**
- Backups and CI seeds are portable between SQLite and Postgres instances;
  both dialects are covered by tests.
- API keys must be created separately on the target instance.
- Imports do not remove definitions that are absent from the file.
- The format is versioned; incompatible versions are rejected before any write.
- The CLI reads `DATABASE_URL` or `V2_DB_PATH`, matching the server.
- Export runs per-environment read queries without a repeatable-read snapshot;
  a backup taken during concurrent writes may mix slightly different moments.
- Import is not safe for two concurrent imports of the same new flag: the
  per-project legacy-id allocation can race (the import fails rather than
  corrupting data).

## ADR-026 — Dependency-free Prometheus metrics

**Context:** Self-hosted operators need request, latency, evaluation, and
storage-failure visibility. Adding an OpenTelemetry SDK or a sidecar would grow
the dependency and deployment surface of a deliberately small service.

**Decision:** Implement a tiny in-process registry (`src/metrics.js`) and expose
`GET /metrics` in Prometheus text format 0.0.4. Metrics cover HTTP responses and
latency (route templates, methods, statuses), evaluation reasons, and 503
storage failures. Labels are bounded; user IDs, flag keys, API keys, and raw
request paths are never used. The endpoint is public like `/healthz`, returns
`Cache-Control: no-store`, and each `buildApp` instance owns its registry.

**Consequences:**
- Operators can scrape the service without new dependencies or a sidecar.
- Metrics are process-local and reset on restart; there is no persistence or
  aggregation.
- Cardinality stays bounded even with many flags/users, at the cost of losing
  per-flag/per-user breakdowns.
- The public endpoint reveals aggregate traffic volume but no tenant data.
- OpenTelemetry, dashboards, alert rules, exemplars, and tracing remain out of
  scope.
