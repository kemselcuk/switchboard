# Demo and Test Evidence

This file contains only output from commands that were actually run, plus demo
evidence. All sections are filled with real output.

> Note: Some transcript labels are in Turkish because the demo UI is Turkish.
> Literal command output is preserved exactly.

## Environment

- Date: 2026-10-20 (v2.0.0); 2026-10-21 (v2.1 quick wins)
- Machine: macOS (arm64), Node.js 22.23.2, Docker 29.8.1, SQLite 3.51.0
- Release: `v2.0.0` (tagged at `e597300`); v2.1 quick wins on `main` after it
- GitHub: https://github.com/kemselcuk/switchboard

## v2.0.0 review follow-up evidence (as recorded at release)

This section records the follow-up work that closed the independent v2 review
starting from commit `ae8e8fa`. Commands were run from the repository root on
2026-10-20.

### Unit and integration suite

```text
npm test
ℹ tests 106
ℹ suites 0
ℹ pass 103
ℹ fail 0
ℹ cancelled 0
ℹ skipped 3
ℹ todo 0
ℹ duration_ms 1513.45675
```

The skipped tests are the Postgres integration tests, which run when
`DATABASE_URL` is set. A second consecutive run produced the same counts.

### Postgres integration

```text
DATABASE_URL=postgres://switchboard:switchboard@127.0.0.1:5433/switchboard npm run test:db
✔ maps a Postgres storage failure to 503 (109.822459ms)
✔ Postgres migrations and v2 evaluation flow (62.503292ms)
✔ Postgres covers migration, legacy routes, isolation and revocation (66.919458ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

### OFREP contract and official provider

`npm run test:contract` now includes the official `@openfeature/ofrep-provider`
against a live local server, quoted ETag/304 handling, OFREP-shaped 400 errors,
and 500/503 general errors.

```text
npm run test:contract
✔ official OFREP provider evaluates against the service
✔ vendored OFREP contract exposes the required core paths
✔ single OFREP response matches the official schema
✔ bulk OFREP response matches the official schema
✔ OFREP not-found response matches the official schema
✔ quoted bulk ETag round-trips and is resent on 304
✔ bulk ETag is scoped to the project key
✔ single OFREP 400 matches the evaluationFailure schema
✔ bulk OFREP 400 matches the bulkEvaluationFailure schema
✔ OFREP storage failures use a general error body
✔ OFREP 500 uses the generalErrorResponse schema
ℹ tests 11
ℹ pass 11
```

### SDK and OpenFeature provider workspaces

```text
npm run test:workspaces
> @switchboard/openfeature-provider@2.0.0 test
# tests 3
# pass 3
> @switchboard/sdk@2.0.0 test
# tests 5
# pass 5
```

### Clean-checkout demo path

A copy without `.git`, `node_modules`, `data`, or `packages/*/dist` was created,
then `npm ci` was run. `npm run demo:v2` built both packages through
`predemo:v2` and ran both services:

```text
> switchboard@2.0.0 demo:v2
> node scripts/demo-v2.mjs

Project: demo
Environment: production
Flag: new-checkout (40%)
API key prefix: sb_srv_904a766c

{"service":"service-a","transport":"sdk","flag":"new-checkout","user":"demo-user-07","enabled":true,"reason":"SPLIT","errorCode":null}
{"service":"service-b","transport":"openfeature","flag":"new-checkout","user":"demo-user-07","enabled":true,"reason":"SPLIT","errorCode":null}
```

### Legacy numeric ID migration

The v1 → Postgres migration was rerun against a clean evidence database with a
v1 flag whose SQLite ID was `1`:

```text
DATABASE_URL=postgres://switchboard:switchboard@127.0.0.1:5433/switchboard_evidence \
SQLITE_PATH=$TMPDIR/legacy.db npm run migrate:legacy
Legacy migration complete: 1 migrated, 0 skipped, 1 total.
```

`GET /api/flags` returned the preserved numeric ID:

```json
{"flags":[{"id":1,"key":"cli-migrated","description":"","enabled":true,"rolloutPercentage":37,"createdAt":"2026-10-20T18:10:02.624Z","updatedAt":"2026-10-20T18:10:02.624Z"}]}
```

`POST /api/evaluate` kept the v1 bucket algorithm:

```json
{"flagKey":"cli-migrated","userId":"demo-user-07","enabled":false,"reason":"BUCKET_EXCLUDED","bucket":77,"rolloutPercentage":37}
```

### v2 video

- File: [`demo/switchboard-v2-demo.mp4`](../demo/switchboard-v2-demo.mp4)
- Duration: `136.8` seconds (2:17), silent, 1280×720.
- Size: `1,137,314` bytes.
- SHA-256: `f5c083707e8ed520bccbf7e2ac3f6b58ccc6b5c35576532ca7dd8da5a1f43768`.
- Covers: admin/project/environment/flag/API-key setup, OFREP evaluation,
  cross-project isolation (`404`), 20%→40% monotonicity over 500 fixed IDs
  (102 → 211 included, subset `true`), both example services, and the legacy
  numeric ID (`1`).
- Recorded with `npm run record:demo:v2` against a real local v2 SQLite server.

### Docker Compose smoke

Excerpt (health/readiness and build/teardown output omitted):

```text
npm run smoke
health: {"status":"ok"}
flag after down/up: {"id":1,"key":"smoke-flag","description":"Docker smoke test","enabled":true,"rolloutPercentage":20,"createdAt":"2026-10-20T18:32:06.855Z","updatedAt":"2026-10-20T18:32:06.855Z"}
v2 after down/up: {"key":"smoke-v2-flag","value":true,"reason":"SPLIT","variant":"enabled"}
OK: v2.down-up.value = true

Smoke test passed: legacy and v2 flags survived restart and down/up.
```

## v2.1 performance/ops track

`npm run bench` uses a dependency-free load driver (`node:http`, sequential
requests per connection) against a real locally started server. Baseline
below was recorded **before** the quick wins (`BENCH_DURATION=10`, `BENCH_CONNECTIONS=10`).

### Baseline — SQLite (before quick wins)

```text
npm run bench
Dialect: sqlite
Connections: 10, duration: 10s per scenario

Scenario: single-flag (bench-flag)
  Requests/sec: 6784.3
  Latency avg: 1.47 ms
  Latency p50: 1.35 ms
  Latency p99: 3.1 ms
  Errors: 0, non-2xx: 0

Scenario: bulk-flags
  Requests/sec: 6200.6
  Latency avg: 1.6 ms
  Latency p50: 1.44 ms
  Latency p99: 4.51 ms
  Errors: 0, non-2xx: 0
```

### Baseline — Postgres (before quick wins)

```text
BENCH_DURATION=10 DATABASE_URL=postgres://switchboard:switchboard@127.0.0.1:5433/switchboard npm run bench
Dialect: postgres
Connections: 10, duration: 10s per scenario

Scenario: single-flag (bench-flag)
  Requests/sec: 724.8
  Latency avg: 13.77 ms
  Latency p50: 9.49 ms
  Latency p99: 69.72 ms
  Errors: 0, non-2xx: 0

Scenario: bulk-flags
  Requests/sec: 1243
  Latency avg: 8.04 ms
  Latency p50: 7.56 ms
  Latency p99: 20.97 ms
  Errors: 0, non-2xx: 0
```

`npm audit`: `found 0 vulnerabilities` (the first attempt used `autocannon`
as a dev dependency; it pulled a vulnerable `uuid` and was replaced by the
built-in load driver before commit).

### What landed

The quick wins after that baseline are `/readyz`, which pings the configured
storage on every probe and answers `503` + `EVALUATION_UNAVAILABLE` when it
fails while `/healthz` stays a cheap liveness check (`9879c25`);
`DATABASE_POOL_MAX`, an optional integer `1..1000` that sizes the Postgres pool
and keeps the `pg` default when unset or invalid (`ccda627`); and a 5-second
in-memory API-key prefix cache that is invalidated locally on create and
revoke (`45f65de`). Flag-config reads are still uncached; ADR-007 remains in
force for them.

Review round 2 then tightened this work: the pool tests now assert
`pool.options.max` (and fail if the assignment is removed), `/readyz` has a
2-second timeout and a test for a hanging executor, the cache has a generation
counter against stale re-caching plus expired-entry sweeping, and the tests
were hardened (`3a833ef`, `e2f75d5`, `8434b62`).

### After quick wins — SQLite

Recorded on 2026-10-21, `BENCH_DURATION=10`, `BENCH_CONNECTIONS=10`, one run per scenario:

```text
BENCH_DURATION=10 npm run bench
Dialect: sqlite
Connections: 10, duration: 10s per scenario

Scenario: single-flag (bench-flag)
  Requests/sec: 7467.7
  Latency avg: 1.33 ms
  Latency p50: 1 ms
  Latency p99: 7.72 ms
  Errors: 0, non-2xx: 0

Scenario: bulk-flags
  Requests/sec: 9593.5
  Latency avg: 1.03 ms
  Latency p50: 0.97 ms
  Latency p99: 2.23 ms
  Errors: 0, non-2xx: 0
```

### After quick wins — Postgres

Recorded on 2026-10-21, `BENCH_DURATION=10`, `BENCH_CONNECTIONS=10`, one run per scenario:

```text
BENCH_DURATION=10 DATABASE_URL=postgres://switchboard:switchboard@127.0.0.1:5433/switchboard npm run bench
Dialect: postgres
Connections: 10, duration: 10s per scenario

Scenario: single-flag (bench-flag)
  Requests/sec: 2337.9
  Latency avg: 4.27 ms
  Latency p50: 3.74 ms
  Latency p99: 14.41 ms
  Errors: 0, non-2xx: 0

Scenario: bulk-flags
  Requests/sec: 2067.3
  Latency avg: 4.82 ms
  Latency p50: 4.25 ms
  Latency p99: 10.37 ms
  Errors: 0, non-2xx: 0
```

### v2.1 quick wins — final test suites

All suites below were run on 2026-10-21 after the review fixes
(`3a833ef`, `e2f75d5`, `8434b62`). Benchmark numbers above are single runs and
are directional; they are not a capacity guarantee.

```text
npm test
ℹ tests 122
ℹ suites 0
ℹ pass 119
ℹ fail 0
ℹ cancelled 0
ℹ skipped 3
ℹ todo 0
```

The 3 skipped tests are the Postgres integration tests, which run when
`DATABASE_URL` is set (see the `test:db` block below).

```text
npm run test:contract
ℹ tests 11
ℹ pass 11
ℹ fail 0
```

`npm run test:workspaces` builds both packages and runs their TAP suites; the
real tails of that single run are:

```text
> @switchboard/openfeature-provider@2.0.0 test
1..3
# tests 3
# suites 0
# pass 3
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 298.498708
```

```text
> @switchboard/sdk@2.0.0 test
1..5
# tests 5
# suites 0
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 397.878916
```

```text
DATABASE_URL=postgres://switchboard:switchboard@127.0.0.1:5433/switchboard npm run test:db
✔ maps a Postgres storage failure to 503 (167.724875ms)
✔ Postgres migrations and v2 evaluation flow (66.546667ms)
✔ Postgres covers migration, legacy routes, isolation and revocation (72.384333ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

```text
npm audit --omit=dev
found 0 vulnerabilities

npm audit
found 0 vulnerabilities
```

### Docker smoke — including readiness

`npm run smoke` was run on the final commit. Docker Compose now healthchecks
`/readyz`, and the smoke script checks it after the first start, the restart,
and the down/up cycle. Excerpt below (the real run repeats health/readiness for
each phase and includes Docker build/teardown output that is omitted here):

```text
npm run smoke
health: {"status":"ok"}
readiness: {"status":"ready"}
health: {"status":"ok"}
readiness: {"status":"ready"}
health: {"status":"ok"}
readiness: {"status":"ready"}
v2 after down/up: {"key":"smoke-v2-flag","value":true,"reason":"SPLIT","variant":"enabled"}
OK: v2.down-up.value = true
Smoke test passed: legacy and v2 flags survived restart and down/up.
```

### v2.1 SDK bulk + ETag

Task 083 adds opt-in bulk mode to the Node SDK; the OpenFeature provider
enables it by default. The SDK adds a bounded per-context cache, `ETag` /
`If-None-Match` / `304` conditional refresh, opt-in polling, `close()`, and
bounded retries; the provider keeps polling off unless `pollingIntervalMs` is
set. The commands below were run from the repository root on 2026-10-21 after
`npm ci`; the workspace totals include the review fixes (`95952e8`, `1fc0544`,
`5b5f222`, `67ef664`).

```text
npm test
✔ default project and environment seeding is idempotent under concurrency (41.472ms)
ℹ tests 122
ℹ suites 0
ℹ pass 119
ℹ fail 0
ℹ cancelled 0
ℹ skipped 3
ℹ todo 0
ℹ duration_ms 2217.176417
```

The 3 skipped tests are the Postgres integration tests, which run when
`DATABASE_URL` is set.

```text
npm run test:contract
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 510.792083
```

```text
npm run test:workspaces
> @switchboard/openfeature-provider@2.0.0 test
> tsx --test test/*.test.ts
...
1..6
# tests 6
# suites 0
# pass 6
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 286.210375
```

```text
> @switchboard/sdk@2.0.0 test
> tsx --test test/*.test.ts
...
1..28
# tests 28
# suites 0
# pass 28
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2917.937875
```

### v2.1 configuration transfer

Task 084 adds `npm run export:config` and `npm run import:config` (Task 084).
The core tests cover export shape/no secrets, round-trip, idempotency, changed
configs, dry run, validation without partial writes, API-key preservation, and
per-project legacy IDs; a separate test drives both CLI scripts against a
temporary SQLite database.

```text
node --test test/v2/transfer.test.js
✔ exports projects, environments, flags and configs without secrets
✔ round-trips into a fresh database with new IDs and matching values
✔ is idempotent on a second import
✔ applies changed descriptions and configs from a new export
✔ dry run reports changes without writing anything
✔ rejects invalid exports without partial writes
✔ never touches existing API keys
✔ assigns per-project numeric legacy ids to imported flags
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

```text
node --test test/v2/transfer-cli.test.js
✔ export/import CLI round-trips a SQLite database
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Full suite after the change:

```text
npm test
ℹ tests 133
ℹ suites 0
ℹ pass 129
ℹ fail 0
ℹ cancelled 0
ℹ skipped 4
ℹ todo 0
```

The 4 skips are the Postgres-only tests (`DATABASE_URL` unset). The same
migration was verified on Postgres:

```text
DATABASE_URL=postgres://switchboard:switchboard@127.0.0.1:5433/switchboard npm run test:db
✔ maps a Postgres storage failure to 503
✔ Postgres migrations and v2 evaluation flow
✔ Postgres covers migration, legacy routes, isolation and revocation
✔ Postgres exports and re-imports configuration
ℹ tests 4
ℹ pass 4
```

### v2.1 metrics endpoint

Task 085 adds a dependency-free Prometheus endpoint with bounded labels.

```text
node --test test/metrics.test.js
✔ exposes Prometheus text with help, type, counters and histogram
✔ records OFREP and legacy evaluation results
✔ counts storage failures mapped to 503
✔ counts OFREP storage failures and readiness failures
✔ counts bulk results once and not on 304
✔ counts OFREP FLAG_NOT_FOUND like the legacy route
✔ uses route templates and exposes no tenant data
✔ keeps metrics isolated per app instance
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

Real scrape after one `/healthz` request (verbatim):

```text
GET /metrics
text/plain; version=0.0.4; charset=utf-8
# HELP switchboard_http_requests_total HTTP responses by method, route template and status.
# TYPE switchboard_http_requests_total counter
switchboard_http_requests_total{method="GET",route="/healthz",status="200"} 1
# HELP switchboard_http_request_duration_seconds HTTP response time in seconds.
# TYPE switchboard_http_request_duration_seconds histogram
switchboard_http_request_duration_seconds_bucket{method="GET",route="/healthz",status="200",le="0.001"} 0
switchboard_http_request_duration_seconds_bucket{method="GET",route="/healthz",status="200",le="0.005"} 1
switchboard_http_request_duration_seconds_bucket{method="GET",route="/healthz",status="200",le="0.01"} 1
switchboard_http_request_duration_seconds_bucket{method="GET",route="/healthz",status="200",le="0.025"} 1
switchboard_http_request_duration_seconds_bucket{method="GET",route="/healthz",status="200",le="0.05"} 1
switchboard_http_request_duration_seconds_bucket{method="GET",route="/healthz",status="200",le="0.1"} 1
switchboard_http_request_duration_seconds_bucket{method="GET",route="/healthz",status="200",le="0.25"} 1
switchboard_http_request_duration_seconds_bucket{method="GET",route="/healthz",status="200",le="0.5"} 1
switchboard_http_request_duration_seconds_bucket{method="GET",route="/healthz",status="200",le="1"} 1
switchboard_http_request_duration_seconds_bucket{method="GET",route="/healthz",status="200",le="2.5"} 1
switchboard_http_request_duration_seconds_bucket{method="GET",route="/healthz",status="200",le="5"} 1
switchboard_http_request_duration_seconds_bucket{method="GET",route="/healthz",status="200",le="10"} 1
switchboard_http_request_duration_seconds_bucket{method="GET",route="/healthz",status="200",le="+Inf"} 1
switchboard_http_request_duration_seconds_sum{method="GET",route="/healthz",status="200"} 0.002093
switchboard_http_request_duration_seconds_count{method="GET",route="/healthz",status="200"} 1
# HELP switchboard_flag_evaluations_total Flag evaluations by result reason.
# TYPE switchboard_flag_evaluations_total counter
# HELP switchboard_db_failures_total Responses mapped to 503 EVALUATION_UNAVAILABLE.
# TYPE switchboard_db_failures_total counter
```

Full suite after the change:

```text
npm test
ℹ tests 141
ℹ suites 0
ℹ pass 137
ℹ fail 0
ℹ cancelled 0
ℹ skipped 4
ℹ todo 0
```

### v2.1 flag deletion

Task 086 adds project-scoped flag deletion. Deleting removes every environment
config via the FK cascade, leaves API keys intact, and never reuses numeric
legacy IDs (per-project sequence). Cascade assertions query `flag_configs`
directly (not through a join that could hide orphans); a separate test covers
sequence monotonicity after reserves and deletions.

```text
node --test test/v2/flags.test.js
✔ creates and lists flags with percentage precision
✔ supports the same flag key in two environments
✔ exposes per-project numeric legacy ids on the legacy API
✔ patches flag description, enabled state and rollout
✔ rejects duplicate flags in the same environment
✔ isolates flags by project
✔ does not mutate another environment on a failed description-only PATCH
✔ validates rollout precision and unknown flags
✔ deletes a flag and all environment configs without touching other projects
✔ validates flag deletion requests
ℹ tests 10
ℹ pass 10
ℹ fail 0
```

```text
DATABASE_URL=postgres://switchboard:switchboard@127.0.0.1:5433/switchboard npm run test:db
✔ maps a Postgres storage failure to 503
✔ Postgres migrations and v2 evaluation flow
✔ Postgres covers migration, legacy routes, isolation and revocation
✔ Postgres exports and re-imports configuration
✔ Postgres flag deletion removes every environment config
ℹ tests 5
ℹ pass 5
```

```text
npm test
ℹ tests 146
ℹ suites 0
ℹ pass 141
ℹ fail 0
ℹ cancelled 0
ℹ skipped 5
ℹ todo 0
```

## Historical v1 evidence

## 1. Automated tests

Initial storage-core tests (commit `586dfad`):

```text
✔ buildApp accepts an injected repository without opening a database
✔ app.close() closes the owned database
✔ createFlag stores a flag and returns it in camelCase
✔ createFlag applies defaults for optional fields
✔ getFlag returns null for an unknown key
✔ listFlags returns flags in creation order
✔ updateFlag only changes the provided fields
✔ updateFlag with an empty patch returns the current flag
✔ createFlag rejects a duplicate key
✔ updateFlag rejects an unknown key
✔ schema enforces the rollout percentage bounds
✔ file database keeps flags after close and reopen

ℹ tests 13
ℹ pass 13
ℹ fail 0
```

Admin API, auth, and error-envelope tests (Task 020):

```text
✔ admin routes reject a request without a token
✔ admin routes reject a wrong token
✔ admin routes reject a token of a different length
✔ admin routes reject a malformed authorization header
✔ auth runs before body validation
✔ admin routes accept the configured bearer token
✔ admin routes reject every token when no token is configured
✔ health check stays public
✔ POST /api/flags creates a flag and returns the planned fields
✔ POST /api/flags applies defaults for optional fields
✔ POST /api/flags rejects a duplicate key
✔ POST /api/flags rejects invalid keys
✔ POST /api/flags rejects invalid rollout percentages
✔ POST /api/flags rejects invalid enabled and description values
✔ POST /api/flags rejects unknown body fields
✔ GET /api/flags lists flags in creation order
✔ GET /api/flags/:key returns a flag or FLAG_NOT_FOUND
✔ PATCH /api/flags/:key updates only the provided fields
✔ PATCH /api/flags/:key rejects empty and unknown fields
✔ PATCH /api/flags/:key rejects an unknown key
✔ unknown routes return the NOT_FOUND envelope
✔ repository SQLite errors become 503 without internal details
✔ unexpected errors become 500 without internal details

ℹ tests 36
ℹ pass 36
ℹ fail 0
```

Deterministic evaluation tests (Task 030, two consecutive `npm test` runs):

```text
✔ known flag returns the exact evaluation contract
✔ users are included or excluded according to their bucket
✔ disabled flag returns FLAG_DISABLED with the computed bucket
✔ unknown flag returns 200 with FLAG_NOT_FOUND and null fields
✔ invalid bodies return VALIDATION_ERROR
✔ evaluation is public while admin routes stay protected
✔ repository SQLITE errors become 503 without internal details
✔ bucketFor matches the golden vectors
✔ the same input returns the same bucket and decision 100 times
✔ buckets always stay within 0-99
✔ rollout 0 excludes everyone and rollout 100 includes everyone
✔ a disabled flag is FLAG_DISABLED regardless of rollout
✔ different flag keys can place the same user in different buckets
✔ the 20 percent set is a subset of the 40 percent set for 1000 IDs
✔ rollout ratios stay within 2 points for 10000 fixed IDs
✔ flag settings and evaluation survive close and reopen

ℹ tests 52
ℹ pass 52
ℹ fail 0
```

Both consecutive `npm test` runs produced the same result (52/52).

End-to-end server check with a temporary DB (`PORT=4317`, local test token):

```text
health: {"status":"ok"}
unauthorized: 401
{"error":{"code":"UNAUTHORIZED","message":"Missing or invalid bearer token"}}
create: 201
{"id":1,"key":"server-check","description":"wiring","enabled":true,"rolloutPercentage":20,"createdAt":"2026-10-20T14:07:27.807Z","updatedAt":"2026-10-20T14:07:27.807Z"}
patch: 200
{"id":1,"key":"server-check","description":"wiring","enabled":true,"rolloutPercentage":40,"createdAt":"2026-10-20T14:07:27.807Z","updatedAt":"2026-10-20T14:07:27.817Z"}
token in log: no
```

Server startup check without `ADMIN_TOKEN`:

```text
exit=1
ADMIN_TOKEN is required. Copy .env.example to .env and set a token.
```

## 2. Demo UI, example client, and demo script (Task 040)

Static files were requested from a local server running with a temporary
database (`PORT=3100`):

```text
HTTP/1.1 200 OK
content-type: text/html; charset=utf-8
app.js:200 application/javascript; charset=utf-8
styles.css:200 text/css; charset=utf-8
api-unknown:404 application/json; charset=utf-8
{"error":{"code":"NOT_FOUND","message":"Route not found"}}
```

The `GET /` response contains no admin token or default token value; the token
is held only in `sessionStorage` in the browser. The token value did not appear
in server logs either (`grep -c 'dev-token-change-me'` → `0`).

`npm test` after Task 040:

```text
✔ GET / serves the single-page demo
✔ GET /app.js serves the demo script without innerHTML user data
✔ GET /styles.css serves the demo stylesheet
✔ unknown API routes keep the JSON NOT_FOUND envelope
✔ unknown static paths fall back to the JSON NOT_FOUND envelope

ℹ tests 58
ℹ pass 58
ℹ fail 0
```

`npm run demo` (local server `http://127.0.0.1:3100`, temporary DB):

```text
> switchboard@0.1.0 demo
> node scripts/demo.mjs

Switchboard demo — %20 → %40 rollout
Servis: http://127.0.0.1:3100
Flag: demo-checkout (enabled=true, rollout=20%)

USER          BUCKET  %20     %40     DURUM
------------  ------  ------  ------  -----------
demo-user-01  4       açık    açık    korundu
demo-user-02  48      kapalı  kapalı  kapalı
demo-user-04  70      kapalı  kapalı  kapalı
demo-user-05  67      kapalı  kapalı  kapalı
demo-user-06  93      kapalı  kapalı  kapalı
demo-user-09  17      açık    açık    korundu
demo-user-14  37      kapalı  açık    yeni açıldı
demo-user-17  28      kapalı  açık    yeni açıldı
demo-user-19  15      açık    açık    korundu
demo-user-21  21      kapalı  açık    yeni açıldı
demo-user-25  3       açık    açık    korundu
demo-user-33  35      kapalı  açık    yeni açıldı

Özet: %20'de 4/12 açık, %40'ta 8/12 açık, 4 korundu, 4 yeni açıldı.
Demo sonunda flag %40 rollout ile açık bırakıldı.
```

When the same script was run a second time, it updated the existing
`demo-checkout` flag via `PATCH /api/flags/demo-checkout` and produced the same
result.

Example client with the `demo-checkout` flag (`enabled=true`,
`rolloutPercentage=40`):

```text
$ node examples/client.mjs --url http://127.0.0.1:3100 --flag demo-checkout \
    --users demo-user-01,demo-user-14,demo-user-02

USER          ENABLED  REASON           BUCKET  ROLLOUT
------------  -------  ---------------  ------  -------
demo-user-01  true     BUCKET_INCLUDED  4       40%
demo-user-14  true     BUCKET_INCLUDED  37      40%
demo-user-02  false    BUCKET_EXCLUDED  48      40%
exit=0
```

`--help` output and exit code:

```text
$ node examples/client.mjs --help
Switchboard örnek istemcisi

Kullanım:
  node examples/client.mjs --flag <key> --users <id1,id2,...> [--url <baseUrl>]

Seçenekler:
  --url    Servis adresi (varsayılan: http://127.0.0.1:3000)
  --flag   Değerlendirilecek flag anahtarı
  --users  Virgülle ayrılmış kullanıcı ID'leri
  --help   Bu yardımı göster

Ortam değişkenleri:
  SWITCHBOARD_URL, SWITCHBOARD_FLAG, SWITCHBOARD_USERS

Çıkış kodları:
  0  Tüm değerlendirmeler başarılı
  1 HTTP veya ağ hatası
  2  Servis 503 döndürdü; enabled=false fallback kullanıldı
exit=0
```

Fallback behavior against a local mock server returning 503:

```text
$ node examples/client.mjs --url http://127.0.0.1:4320 --flag demo-checkout \
    --users demo-user-01,demo-user-02

UYARI: demo-user-01 için servis 503 döndürdü; enabled=false fallback kullanıldı.
UYARI: demo-user-02 için servis 503 döndürdü; enabled=false fallback kullanıldı.
USER          ENABLED  REASON                           BUCKET  ROLLOUT
------------  -------  -------------------------------  ------  -------
demo-user-01  false    EVALUATION_UNAVAILABLE_FALLBACK  —       —
demo-user-02  false    EVALUATION_UNAVAILABLE_FALLBACK  —       —
Servis geçici olarak kullanılamıyor; fallback sonuçları gösterildi.
exit=2
```

Exit code `1` for an unreachable server:

```text
$ node examples/client.mjs --url http://127.0.0.1:4399 --flag demo-checkout \
    --users demo-user-01

Hata: http://127.0.0.1:4399 adresine ulaşılamadı: fetch failed
exit=1
```

Note: The 12 demo users were chosen to produce a 4/4/4 split for
`demo-checkout`: 4 included at %20, 8 included at %40 (4 preserved, 4 newly
opened), and 4 excluded. The buckets are 4, 48, 70, 67, 93, 17, 37, 28, 15, 21,
3, and 35. Exact percentages are not expected in a small sample; this set is
used for deterministic evidence.

## 3. Determinism and monotonicity

The `demo-checkout` flag was first set to `%20`, then `%40`. The same users'
buckets did not change; a user included at `%20` stayed included at `%40`, and a
user excluded at `%20` was included at `%40`:

```text
--- at20 user01
{"flagKey":"demo-checkout","userId":"demo-user-01","enabled":true,"reason":"BUCKET_INCLUDED","bucket":4,"rolloutPercentage":20}
--- at20 user14
{"flagKey":"demo-checkout","userId":"demo-user-14","enabled":false,"reason":"BUCKET_EXCLUDED","bucket":37,"rolloutPercentage":20}
--- at40 user01
{"flagKey":"demo-checkout","userId":"demo-user-01","enabled":true,"reason":"BUCKET_INCLUDED","bucket":4,"rolloutPercentage":40}
--- at40 user14
{"flagKey":"demo-checkout","userId":"demo-user-14","enabled":true,"reason":"BUCKET_INCLUDED","bucket":37,"rolloutPercentage":40}
```

The `bucket` values remained fixed at `4` and `37`. The `%20 → %40` move did not
re-hash; only the threshold changed.

## 4. API contract

Real `curl` responses (`demo-checkout`, `%40`):

```text
$ curl -sS http://127.0.0.1:3100/healthz
{"status":"ok"}

$ curl -sS -X POST -H 'content-type: application/json' \
    -d '{"flagKey":"demo-checkout","userId":"demo-user-01"}' \
    http://127.0.0.1:3100/api/evaluate
{"flagKey":"demo-checkout","userId":"demo-user-01","enabled":true,"reason":"BUCKET_INCLUDED","bucket":4,"rolloutPercentage":40}

$ curl -sS -X POST -H 'content-type: application/json' \
    -d '{"flagKey":"missing-flag","userId":"demo-user-01"}' \
    http://127.0.0.1:3100/api/evaluate
{"flagKey":"missing-flag","userId":"demo-user-01","enabled":false,"reason":"FLAG_NOT_FOUND","bucket":null,"rolloutPercentage":null}

$ curl -sS -X POST -H 'content-type: application/json' \
    -d '{"flagKey":"DEMO","userId":""}' \
    http://127.0.0.1:3100/api/evaluate
{"error":{"code":"VALIDATION_ERROR","message":"body/flagKey must match pattern \"^[a-z0-9][a-z0-9._-]{0,63}$\""}}
status=400

$ curl -sS http://127.0.0.1:3100/api/flags
{"error":{"code":"UNAUTHORIZED","message":"Missing or invalid bearer token"}}
status=401
```

Example admin call:

```text
$ curl -sS -H 'Authorization: Bearer dev-token-change-me' \
    http://127.0.0.1:3100/api/flags/demo-checkout
{"id":1,"key":"demo-checkout","description":"Demo: 20 → 40 rollout karşılaştırması","enabled":true,"rolloutPercentage":40,"createdAt":"2026-10-20T14:17:56.611Z","updatedAt":"2026-10-20T14:24:29.353Z"}
```

## 5. Restart / persistence

The restart step in `npm run smoke`; flag settings and the same user's result
are preserved:

```text
== 6. Restart and re-evaluate ==
$ docker compose -p switchboard-smoke restart
 Container switchboard-smoke-switchboard-1 Restarting
 Container switchboard-smoke-switchboard-1 Started
health: {"status":"ok"}
flag after restart: {"id":1,"key":"smoke-flag","description":"Docker smoke test","enabled":true,"rolloutPercentage":20,"createdAt":"2026-10-20T14:21:29.914Z","updatedAt":"2026-10-20T14:21:29.914Z"}
OK: restart.enabled = true
OK: restart.rolloutPercentage = 20
evaluate after restart: {"flagKey":"smoke-flag","userId":"user-123","enabled":false,"reason":"BUCKET_EXCLUDED","bucket":76,"rolloutPercentage":20}
OK: restart.bucket = 76
OK: restart.enabled = false
OK: restart.reason = BUCKET_EXCLUDED
```

Same result after `down` (volume kept) + `up -d`:

```text
$ docker compose -p switchboard-smoke down
 Container switchboard-smoke-switchboard-1 Stopping
 Container switchboard-smoke-switchboard-1 Stopped
 Container switchboard-smoke-switchboard-1 Removing
 Container switchboard-smoke-switchboard-1 Removed
 Network switchboard-smoke_default Removing
 Network switchboard-smoke_default Removed
$ docker compose -p switchboard-smoke up -d
 Network switchboard-smoke_default Creating
 Network switchboard-smoke_default Created
 Container switchboard-smoke-switchboard-1 Creating
 Container switchboard-smoke-switchboard-1 Created
 Container switchboard-smoke-switchboard-1 Starting
 Container switchboard-smoke-switchboard-1 Started
health: {"status":"ok"}
flag after down/up: {"id":1,"key":"smoke-flag","description":"Docker smoke test","enabled":true,"rolloutPercentage":20,"createdAt":"2026-10-20T14:21:29.914Z","updatedAt":"2026-10-20T14:21:29.914Z"}
OK: down-up.enabled = true
OK: down-up.rolloutPercentage = 20
evaluate after down/up: {"flagKey":"smoke-flag","userId":"user-123","enabled":false,"reason":"BUCKET_EXCLUDED","bucket":76,"rolloutPercentage":20}
OK: down-up.bucket = 76
OK: down-up.enabled = false
OK: down-up.reason = BUCKET_EXCLUDED
```

## 6. Docker smoke test

`npm run smoke` (clean `down -v`, build, health, flag, restart, down/up, and
`down -v` again). Build layer logs were shortened; application output is
verbatim:

```text
> switchboard@0.1.0 smoke
> bash scripts/smoke-docker.sh

Switchboard Docker smoke test
Project: switchboard-smoke
Base URL: http://127.0.0.1:3101
Token: smoke-only (smoke-token)

== 1. Clean start ==
$ docker compose -p switchboard-smoke down -v
time="2026-10-20T16:21:25+02:00" level=warning msg="Warning: No resource found to remove for project \"switchboard-smoke\"."

== 2. Build and start ==
$ docker compose -p switchboard-smoke up -d --build
 Image switchboard-smoke-switchboard Building
 Image switchboard-smoke-switchboard Built
 Network switchboard-smoke_default Creating
 Volume switchboard-smoke_switchboard-data Creating
 Volume switchboard-smoke_switchboard-data Created
 Network switchboard-smoke_default Created
 Container switchboard-smoke-switchboard-1 Creating
 Container switchboard-smoke-switchboard-1 Created
 Container switchboard-smoke-switchboard-1 Starting
 Container switchboard-smoke-switchboard-1 Started

== 3. Wait for health ==
health: {"status":"ok"}

== 4. Create flag ==
create: {"id":1,"key":"smoke-flag","description":"Docker smoke test","enabled":true,"rolloutPercentage":20,"createdAt":"2026-10-20T14:21:29.914Z","updatedAt":"2026-10-20T14:21:29.914Z"}
OK: create.key = smoke-flag
OK: create.enabled = true
OK: create.rolloutPercentage = 20

== 5. Evaluate user-123 ==
evaluate: {"flagKey":"smoke-flag","userId":"user-123","enabled":false,"reason":"BUCKET_EXCLUDED","bucket":76,"rolloutPercentage":20}
bucket=76 enabled=false reason=BUCKET_EXCLUDED

== 6. Restart and re-evaluate ==
$ docker compose -p switchboard-smoke restart
 Container switchboard-smoke-switchboard-1 Restarting
 Container switchboard-smoke-switchboard-1 Started
health: {"status":"ok"}
flag after restart: {"id":1,"key":"smoke-flag","description":"Docker smoke test","enabled":true,"rolloutPercentage":20,"createdAt":"2026-10-20T14:21:29.914Z","updatedAt":"2026-10-20T14:21:29.914Z"}
OK: restart.enabled = true
OK: restart.rolloutPercentage = 20
evaluate after restart: {"flagKey":"smoke-flag","userId":"user-123","enabled":false,"reason":"BUCKET_EXCLUDED","bucket":76,"rolloutPercentage":20}
OK: restart.bucket = 76
OK: restart.enabled = false
OK: restart.reason = BUCKET_EXCLUDED

== 7. down (volume kept) + up and re-evaluate ==
$ docker compose -p switchboard-smoke down
 Container switchboard-smoke-switchboard-1 Stopping
 Container switchboard-smoke-switchboard-1 Stopped
 Container switchboard-smoke-switchboard-1 Removing
 Container switchboard-smoke-switchboard-1 Removed
 Network switchboard-smoke_default Removing
 Network switchboard-smoke_default Removed
$ docker compose -p switchboard-smoke up -d
 Network switchboard-smoke_default Creating
 Network switchboard-smoke_default Created
 Container switchboard-smoke-switchboard-1 Creating
 Container switchboard-smoke-switchboard-1 Created
 Container switchboard-smoke-switchboard-1 Starting
 Container switchboard-smoke-switchboard-1 Started
health: {"status":"ok"}
flag after down/up: {"id":1,"key":"smoke-flag","description":"Docker smoke test","enabled":true,"rolloutPercentage":20,"createdAt":"2026-10-20T14:21:29.914Z","updatedAt":"2026-10-20T14:21:29.914Z"}
OK: down-up.enabled = true
OK: down-up.rolloutPercentage = 20
evaluate after down/up: {"flagKey":"smoke-flag","userId":"user-123","enabled":false,"reason":"BUCKET_EXCLUDED","bucket":76,"rolloutPercentage":20}
OK: down-up.bucket = 76
OK: down-up.enabled = false
OK: down-up.reason = BUCKET_EXCLUDED

Smoke test passed: flag and evaluation survived restart and down/up.

== 8. Clean up (down -v via EXIT trap) ==

$ docker compose -p switchboard-smoke down -v
 Container switchboard-smoke-switchboard-1 Stopping
 Container switchboard-smoke-switchboard-1 Stopped
 Container switchboard-smoke-switchboard-1 Removing
 Container switchboard-smoke-switchboard-1 Removed
 Network switchboard-smoke_default Removing
 Volume switchboard-smoke_switchboard-data Removing
 Volume switchboard-smoke_switchboard-data Removed
 Network switchboard-smoke_default Removed
```

Healthcheck and non-root user:

```text
$ docker compose -p switchboard-smoke ps
NAME                              IMAGE                           COMMAND                  SERVICE       CREATED         STATUS                   PORTS
switchboard-smoke-switchboard-1   switchboard-smoke-switchboard   "docker-entrypoint.s…"   switchboard   6 seconds ago   Up 6 seconds (healthy)   0.0.0.0:3101->3000/tcp, [::]:3101->3000/tcp
$ docker compose -p switchboard-smoke exec switchboard id
uid=1000(node) gid=1000(node) groups=1000(node)
$ docker image inspect switchboard-smoke-switchboard --format '{{.Config.User}}'
node
```

Compose fails clearly without `ADMIN_TOKEN` (there is no hidden default token):

```text
$ env -u ADMIN_TOKEN docker compose --env-file /dev/null config
error while interpolating services.switchboard.environment.ADMIN_TOKEN: required variable ADMIN_TOKEN is missing a value: ADMIN_TOKEN is required. Set it in .env or the environment.
exit=1
```

After `down -v` no volume remained, and the fresh start opened an empty
database:

```text
$ docker volume ls --filter name=switchboard-smoke
DRIVER    VOLUME NAME
$ curl -s -H 'Authorization: Bearer smoke-token' http://127.0.0.1:3101/api/flags
{"flags":[]}
```

## 7. Demo video

- File: [`demo/switchboard-demo.mp4`](../demo/switchboard-demo.mp4)
- Duration: 62.68 seconds
- Format: 1280×720, H.264, silent
- Recording command: `npm run record:demo`
- Flow shown:
  1. Service health and connecting with the admin token.
  2. Creating the `demo-checkout` flag with a `%20` rollout.
  3. Same bucket/result for `demo-user-01`.
  4. Excluded result at `%20` for `demo-user-14`.
  5. `%20 → %40` comparison: 4/12 included → 8/12 included, 4 preserved,
     4 newly opened.
  6. After the server process restarts, `bucket 4 → 4` and status
     `Open → Open` (Turkish UI: `Açık → Açık`) for the same user.
  7. `npm test`: 58/58 pass.

## 8. Git evidence

```text
$ git log --oneline -12
382213c docs: align demo video and evidence with 1.0.0
4da3d94 chore: release 1.0.0
fce9100 fix: return 503 when evaluation storage is unavailable
75aa3f5 docs: add independent final review brief
2489e8e docs: finalize delivery documentation
3e4e1c8 feat: add reproducible demo video recording
307a4bc fix: keep flag list status in sync after creation
f8208f5 chore: add Docker setup and smoke test
1b17235 docs: add Docker task brief
34104db fix: show preserved and newly opened users in demo
9819367 feat: add demo UI and example client
a38cdec docs: add demo and client task brief

$ git remote -v
origin  https://github.com/kemselcuk/switchboard.git (fetch)
origin  https://github.com/kemselcuk/switchboard.git (push)

$ git tag -l
v1.0.0

$ git status --short
(boş)
```

Release tag: `v1.0.0` (code release). English documentation is on `main` after the release commit.

## 9. v2 expansion evidence

The v2 work keeps the v1 API available and adds projects, environments, API
keys, OFREP and the Node/OpenFeature clients.

### Local test suite

```text
npm test
ℹ tests 91
ℹ pass 90
ℹ fail 0
ℹ skipped 1
```

The skipped test is the Postgres integration test, which runs when
`DATABASE_URL` is set.

### Postgres integration

```text
DATABASE_URL=postgres://postgres:switchboard@127.0.0.1:55432/switchboard npm run test:db
✔ Postgres migrations and v2 evaluation flow
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

### OFREP contract tests

```text
npm run test:contract
✔ vendored OFREP contract exposes the required core paths
✔ single OFREP response matches the official schema
✔ bulk OFREP response matches the official schema
✔ OFREP not-found response matches the official schema
ℹ tests 4
ℹ pass 4
```

### SDK and OpenFeature provider

```text
npm run test:workspaces
@switchboard/openfeature-provider: tests 3, pass 3
@switchboard/sdk: tests 5, pass 5
```

### Two-service v2 demo

```text
npm run demo:v2
Project: demo
Environment: production
Flag: new-checkout (40%)
{"service":"service-a","transport":"sdk","flag":"new-checkout","user":"demo-user-07","enabled":true,"reason":"SPLIT","errorCode":null}
{"service":"service-b","transport":"openfeature","flag":"new-checkout","user":"demo-user-07","enabled":true,"reason":"SPLIT","errorCode":null}
```

### SQLite → Postgres migration

```text
npm run migrate:legacy
Legacy migration complete: 1 migrated, 0 skipped, 1 total.
```

The migrated legacy flag was then read through `/api/flags`. This early run
predates the numeric `legacy_id` compatibility work; the current evidence
section above records the preserved numeric ID.

### Docker Compose v2 smoke

`npm run smoke` builds the Postgres-backed stack, waits for health, creates a
legacy flag and a v2 project/environment/flag/API key, evaluates both, restarts
the stack, runs `down`/`up`, and verifies the same results. Result:

```text
v2 ofrep: {"key":"smoke-v2-flag","value":true,"reason":"SPLIT","variant":"enabled"}
OK: v2.first.value = true
v2 after restart: {"key":"smoke-v2-flag","value":true,"reason":"SPLIT","variant":"enabled"}
OK: v2.restart.value = true
v2 after down/up: {"key":"smoke-v2-flag","value":true,"reason":"SPLIT","variant":"enabled"}
OK: v2.down-up.value = true
Smoke test passed: legacy and v2 flags survived restart and down/up.
```

### v2 UI

`GET /v2.html` is covered by the static tests; it provides project,
environment, flag, API-key and OFREP evaluation forms. The admin token and API
key are stored in `sessionStorage` only, never in HTML.
