# Task 085 — Dependency-free metrics endpoint

Follow-up to the performance/ops research (F2). Read `AGENTS.md`,
`docs/EXPANSION_PLAN.md` section 14, and `src/app.js` first.

## Goal

Expose a small Prometheus-compatible `GET /metrics` endpoint so self-hosted
users can see request volume, latency, evaluations, and storage failures without
adding a metrics SDK or a sidecar. Keep cardinality bounded and expose no tenant
data or secrets.

## Metrics

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `switchboard_http_requests_total` | counter | `method`, `route`, `status` | HTTP responses; `route` is the Fastify route template (e.g. `/api/flags/:key`), never the raw path |
| `switchboard_http_request_duration_seconds` | histogram | `method`, `route`, `status` | Response time with fixed buckets |
| `switchboard_flag_evaluations_total` | counter | `result` | OFREP and legacy evaluations by reason (`SPLIT`, `DISABLED`, `BUCKET_INCLUDED`, `FLAG_NOT_FOUND`, ...) |
| `switchboard_db_failures_total` | counter | none | Responses mapped to 503 `EVALUATION_UNAVAILABLE` |

- Histogram buckets: `0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10` seconds.
- Exposition: Prometheus text format 0.0.4, `HELP`/`TYPE`, `_bucket`/`_sum`/`_count`.
- `/metrics` itself is public like `/healthz`, returns `text/plain`, and sets
  `Cache-Control: no-store`. It must not contain API keys, user IDs, flag keys,
  or raw request paths.
- Metrics are per `buildApp` instance (tests can inspect one app without
  cross-test leakage).

## Implementation

- New `src/metrics.js`: a tiny registry (counters, histogram, labels sorted) and
  `renderMetrics`; no new dependencies.
- `buildApp` creates the registry, decorates it on the app, records HTTP
  onResponse hooks, serves `/metrics`, and increments the DB-failure counter
  from the error handler when the mapped status is 503.
- `src/flags/evaluate-routes.js` and `src/v2/routes/ofrep.js` record each
  evaluation result on `app.metrics`.
- Do not instrument SQL or add a `/metrics` admin auth path.

## Tests

- `GET /metrics` returns 200, Prometheus content type, HELP/TYPE lines.
- A request increments `switchboard_http_requests_total` with the route template;
  a raw path/flag key/user ID does not appear in the output.
- An OFREP single evaluation increments `flag_evaluations_total{result="SPLIT"}`;
  a legacy evaluation increments its own result.
- A storage failure mapped to 503 increments `db_failures_total`.
- Histogram exposes `_bucket`, `_sum`, `_count` with finite values.
- Existing suites stay green; Docker smoke is not required to change.

## Out of scope

OpenTelemetry, push gateways, per-flag/per-user labels, persistent metrics,
dashboards, alert rules, rate limiting, and authentication for `/metrics`.

## Acceptance criteria

- `npm test` is green; new metrics tests cover the bullets above.
- README documents the endpoint, its public nature, bounded labels, and an
  example scrape; ADR-026 records the decision; EVIDENCE records real output.
- No new dependencies; `npm audit` stays clean.

## Workflow

Implement directly (provider blocking on this task family); run tests; update
docs; one independent review round if available.

## Status (2026-10-21)

Landed on `main`:

- `d5ccbba` — dependency-free metrics registry, `/metrics`, HTTP hooks,
  evaluation counters, 503 failure counter, and tests.

`npm test`: 138 tests (134 pass, 4 Postgres skips); metrics tests 5/5. Real
output is recorded in `docs/EVIDENCE.md` under "v2.1 metrics endpoint".

Still out of scope: OpenTelemetry, persistence, dashboards, alert rules,
per-user/per-flag labels, `/metrics` authentication, and rate limiting.
