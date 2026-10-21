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

## Status (2026-10-21)

Implemented and landed on `main`:

- `fa7dc07` — dependency-free benchmark (`scripts/benchmark.mjs`) and the
  before-quick-wins baseline in `docs/EVIDENCE.md`.
- `9879c25` — `/readyz` pings the configured storage (Postgres via Kysely,
  SQLite via a `SELECT 1`) and returns `503` + `EVALUATION_UNAVAILABLE` when
  the probe fails or exceeds its 2-second timeout; `/healthz` stays a cheap
  liveness check.
- `ccda627` — `DATABASE_POOL_MAX` (integer `1..1000`) sizes the Postgres pool;
  missing or invalid values keep the `pg` default.
- `45f65de` — 5-second in-memory API-key prefix cache with local invalidation
  on create/revoke; only found records are cached, and flag-config reads stay
  uncached (ADR-007 untouched).

Evidence from the recording run (`docs/EVIDENCE.md`):

- `npm test`: 122 tests, 119 pass, 3 skipped (the Postgres tests without
  `DATABASE_URL`), 0 fail (final state after review fixes).
- SQLite, `DURATION=10`, `CONNECTIONS=10`: single-flag 6784.3 → 7467.7 req/s;
  bulk 6200.6 → 9593.5 req/s.
- Postgres, `DURATION=10`, `CONNECTIONS=10`: single-flag 724.8 → 2337.9 req/s;
  bulk 1243 → 2067.3 req/s.
- Also green: `test:contract` 11/11, `test:workspaces` 3/3 (provider) and 5/5
  (SDK), `test:db` 3/3, Docker smoke (including `/readyz`); `npm audit` and
  `npm audit --omit=dev` both report `found 0 vulnerabilities`.

Still out of this task: flag-config caching (needs an ADR-007 revision), SDK
bulk/ETag, rate limiting, metrics, and the remaining v2.1 features; each needs
its own task brief and, where required, an expansion-plan update first.

Review fixes after round 2: `3a833ef` (pool proof + strict parsing), `e2f75d5`
(readiness timeout + injected-repository test), `8434b62` (cache generation
counter, expired sweep, hardened tests). Compose now healthchecks `/readyz`
and the smoke script checks it explicitly.
