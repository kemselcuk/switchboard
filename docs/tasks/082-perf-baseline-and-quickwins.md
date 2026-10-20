# Task 082 — Performance baseline and quick wins

Small, scope-safe performance/ops track for Switchboard as a reusable,
self-hosted service. Read `AGENTS.md`, `docs/EXPANSION_PLAN.md`, and
`docs/DECISIONS.md` before changing code.

## Context

- v2.0.0 is tagged (`e597300`); `main` is green.
- Current OFREP request cost: API-key prefix lookup + one flags join;
  `last_used_at` writes are already throttled to once per minute.
- No cache anywhere in the evaluation path (ADR-007).
- `/healthz` does not ping the database. The Postgres pool size is not
  configurable. The Node SDK uses the single-flag endpoint per flag.

## Scope (approved by the user)

1. **P1 benchmark**: a repeatable load-test script and a recorded baseline
   for single-flag and bulk OFREP evaluation, on SQLite and (when
   `DATABASE_URL` is set) Postgres. Baseline numbers go into
   `docs/EVIDENCE.md` before any optimization lands.
2. **P5 readiness**: `/readyz` performs a storage ping and returns 503 when
   storage is unavailable; `/healthz` stays a cheap liveness probe.
3. **P6 pool sizing**: `DATABASE_POOL_MAX` (integer, ≥1) configures the
   Postgres pool; default stays the `pg` default.
4. **P2 API-key cache**: in-memory prefix cache with a short TTL plus local
   invalidation on create/revoke. Flag evaluation reads stay uncached
   (ADR-007 is untouched).

## Out of scope

- Flag-config caching (needs an ADR-007 revision; only if the benchmark
  proves a bottleneck).
- SDK bulk/ETag, rate limiting, metrics, new flag types, targeting rules,
  management OpenAPI, publishing packages.

## Acceptance criteria

- `npm run bench` runs against a temporary SQLite v2 database, prints
  requests/sec + latency percentiles for single and bulk evaluation, and
  exits non-zero on failure. Postgres mode runs with `DATABASE_URL` set.
- Baseline and post-change numbers are recorded in `docs/EVIDENCE.md` from
  real runs.
- `/readyz` returns 200 with storage up and 503 + `EVALUATION_UNAVAILABLE`
  when storage fails; `/healthz` behavior is unchanged. Both are tested.
- `DATABASE_POOL_MAX` is honored on Postgres; invalid values keep the
  default. Documented in `.env.example` and README.
- The API-key cache is invalidated locally on create/revoke and serves the
  same records; a repository unit test proves the second lookup skips the
  query and that revocation forces a fresh read.
- `npm test`, `test:contract`, `test:workspaces`, `test:db` (with Postgres)
  are green; the Docker smoke test runs at the end.

## Workflow

- Small commits, `npm test` per change, real output into EVIDENCE, push.
- New decision records for the readiness probe and the API-key cache.
