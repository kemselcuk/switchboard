<img src="assets/icon.svg" width="64" height="64" alt="">

# Switchboard

A small, self-hosted feature flag service with projects, environments,
deterministic percentage rollouts, and an **OpenFeature/OFREP-compatible**
evaluation API.

The v1 single-environment API remains available. v2 adds projects,
environments, environment API keys, OFREP, and a Node/TypeScript SDK with an
OpenFeature provider.

[Watch the 2:17 silent v2 demo](demo/switchboard-v2-demo.mp4) — projects,
project isolation, 20%→40% monotonicity, two services, and the legacy API.

> This is a demo/portfolio project evolving into a reusable platform. Feature
> flags are not an authorization mechanism and should not replace production
> auth.

## What works today

- v1 legacy: single-environment flags, admin token, SQLite.
- v2 projects and environments.
- v2 environment server API keys (hashed at rest, shown once).
- v2 management API under `/api/v1`.
- OFREP single and bulk evaluation under `/ofrep/v1`.
- Node/TypeScript SDK and OpenFeature provider packages.
- Postgres primary; SQLite remains for local/test and legacy mode.
- Legacy `/api/flags` and `/api/evaluate` continue to work.
- SQLite → Postgres migration for existing flags.
- Versioned JSON configuration export/import (API keys excluded).
- Dependency-free Prometheus `/metrics` endpoint.

Targeting rules/segments, string/number/JSON flag types, a full admin dashboard,
audit/RBAC, browser SDK, and streaming are planned for later versions.

## Quick start

### Docker: v2 with Postgres

```bash
cp .env.example .env
# Change ADMIN_TOKEN and POSTGRES_PASSWORD in .env
docker compose up --build
```

The stack starts Postgres, runs migrations, and serves:

- Legacy demo UI: http://localhost:3000
- v2 projects/OFREP demo: http://localhost:3000/v2.html
- Health (liveness): http://localhost:3000/healthz
- Readiness (storage ping): http://localhost:3000/readyz
- Metrics (Prometheus text): http://localhost:3000/metrics
- Management API: http://localhost:3000/api/v1
- OFREP: http://localhost:3000/ofrep/v1

`/healthz` is a cheap liveness probe and does not touch storage. `/readyz`
pings storage and returns `503` with the shared
`{ "error": { "code": "EVALUATION_UNAVAILABLE", "message": ... } }` envelope
when storage is unavailable.

On Postgres, `DATABASE_POOL_MAX` (integer `1..1000`) sets the `pg` pool size.
Unset or invalid values keep the `pg` default of 10. `/readyz` bounds the probe
to 2 seconds, so a partitioned database cannot hang the readiness check.

`docker compose down` keeps the Postgres volume. `docker compose down -v`
removes it. Both ports bind to `127.0.0.1` by default; override `BIND_ADDRESS`
or `POSTGRES_BIND` only when external access is intended.

### Local: v2 with SQLite

```bash
cp .env.example .env
# set SWITCHBOARD_V2=true in .env
npm ci
npm start
```

Then create a project/environment/flag/API key through the management API or
run the demo setup:

```bash
# ADMIN_TOKEN must match the running server (see .env)
ADMIN_TOKEN="$ADMIN_TOKEN" npm run demo:v2
```

`demo:v2` runs `npm run build` first, so the SDK/provider `dist` directories are
created on a fresh `npm ci` checkout.

### Local: v1 legacy mode

Leave `SWITCHBOARD_V2=false` and run `npm start`; this uses the original SQLite
`data/switchboard.db` and the legacy API only.

## v2 integration

### Node/TypeScript SDK

```js
import { SwitchboardClient } from '@switchboard/sdk';

const client = new SwitchboardClient({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.SWITCHBOARD_API_KEY,
  timeoutMs: 1000,
});

const enabled = await client.getBooleanValue(
  'new-checkout',
  false,
  { targetingKey: userId },
);
```

The SDK uses one request per flag by default. `bulkEvaluation: true` uses the
bulk OFREP endpoint with a per-context cache; `cacheTtlMs` (default 10s),
`pollingIntervalMs` (background refresh, off by default), and
`maxRetries`/`retryBaseDelayMs` (bounded retries for network errors and `5xx`
only) tune freshness and transport behavior. See
[`packages/sdk-node/README.md`](packages/sdk-node/README.md) for the options
table and the polling/staleness trade-off.

### OpenFeature provider

```js
import { OpenFeature } from '@openfeature/server-sdk';
import { SwitchboardProvider } from '@switchboard/openfeature-provider';

await OpenFeature.setProviderAndWait(
  new SwitchboardProvider({
    baseUrl: 'http://localhost:3000',
    apiKey: process.env.SWITCHBOARD_API_KEY,
  }),
);

const client = OpenFeature.getClient();
const enabled = await client.getBooleanValue(
  'new-checkout',
  false,
  { targetingKey: userId },
);
```

The provider enables bulk evaluation by default, so one request serves all
flags for a context; polling stays off unless `pollingIntervalMs` is set.
Pass `bulkEvaluation: false` to return to single-flag requests.

### Two-service demo

With a v2 server running locally:

```bash
ADMIN_TOKEN="$ADMIN_TOKEN" npm run demo:v2
```

This creates `demo` / `production` / `new-checkout`, creates an environment API
key, and runs:

- `examples/service-a` using the SDK.
- `examples/service-b` using the OpenFeature provider.

Both should return the same result for the same user.

## v2 API

Management endpoints require `Authorization: Bearer <ADMIN_TOKEN>`.

| Method | Path | Purpose |
|---|---|---|
| `POST/GET` | `/api/v1/projects` | Create/list projects |
| `POST/GET` | `/api/v1/projects/:project/environments` | Create/list environments |
| `POST/GET` | `/api/v1/projects/:project/environments/:env/flags` | Create/list flags |
| `GET/PATCH` | `/api/v1/projects/:project/environments/:env/flags/:key` | Get/update a flag |
| `POST/GET` | `/api/v1/projects/:project/environments/:env/api-keys` | Create/list API keys |
| `DELETE` | `/api/v1/projects/:project/environments/:env/api-keys/:id` | Revoke an API key |

### Create project, environment, flag, and key

```bash
set -a
. ./.env
set +a
export BASE=http://localhost:3000

curl -sS -X POST "$BASE/api/v1/projects" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"key":"checkout","name":"Checkout"}'

curl -sS -X POST "$BASE/api/v1/projects/checkout/environments" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"key":"production","name":"Production"}'

curl -sS -X POST "$BASE/api/v1/projects/checkout/environments/production/flags" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"key":"new-checkout","enabled":true,"rolloutPercentage":20.5}'

curl -sS -X POST "$BASE/api/v1/projects/checkout/environments/production/api-keys" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"checkout service"}'
```

The API key response contains `key` once; store it as a secret. Only the prefix
and a SHA-256 hash are stored in the database.

### OFREP evaluation

```bash
curl -sS -X POST "$BASE/ofrep/v1/evaluate/flags/new-checkout" \
  -H "X-API-Key: $SWITCHBOARD_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"context":{"targetingKey":"user-123","plan":"premium"}}'
```

Response:

```json
{
  "key": "new-checkout",
  "value": true,
  "reason": "SPLIT",
  "variant": "enabled"
}
```

Bulk:

```bash
curl -sS -X POST "$BASE/ofrep/v1/evaluate/flags" \
  -H "X-API-Key: $SWITCHBOARD_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"context":{"targetingKey":"user-123"}}'
```

OFREP 404 responses use `FLAG_NOT_FOUND`; invalid/revoked keys return `401`.
The vendored contract is in [`docs/contracts/ofrep-openapi.yaml`](docs/contracts/ofrep-openapi.yaml).

Validation errors use OFREP failure bodies: a single evaluation returns
`{key, errorCode: "INVALID_CONTEXT", errorDetails}`, and bulk evaluation
returns `{errorCode: "INVALID_CONTEXT", errorDetails}`. Unexpected `500`
responses and storage `503` responses use `{errorDetails}`; storage failures
never fall back to a flag value. Bulk responses include a quoted `ETag`;
send it back as `If-None-Match` to receive `304 Not Modified` (the `ETag` is
repeated on the 304).

## Legacy v1 API

The original API is unchanged:

- `POST/GET/PATCH /api/flags`
- `POST /api/evaluate`

In v2 mode, legacy routes map to the seeded `default` / `production`
project/environment and keep the v1 bucket algorithm. In v1 mode, they use the
original SQLite repository.

`/api/flags` keeps the numeric `id` used by v1 clients. The `flags` table has a
nullable `legacy_id` compatibility column: existing SQLite integer IDs are
preserved by the migration, and new flags receive the next numeric ID in their
project. v2 management responses keep the UUID `id`.

## Deterministic algorithm

### v2 projects

```text
u32    = SHA-256(projectKey + ":" + flagKey + ":" + targetingKey) first 4 bytes
bucket = floor((u32 / 2^32) * 100000)          // 0-99999
open   = enabled && bucket < rolloutBasisPoints
```

- `rolloutBasisPoints` is `0..100000`; API percentages support up to three
  decimal places (e.g. `20.125`).
- The environment is not part of the hash: the same user keeps the same bucket
  across staging and production for the same project/flag.
- Increasing the rollout only raises the threshold; the previous included set
  is preserved.

### Legacy v1

The legacy project keeps `SHA-256(flagKey + ":" + userId)` and 100 buckets, so
existing users do not move after the upgrade.

## Migration from v1 SQLite

The old database is never deleted automatically. Run:

```bash
DATABASE_URL=postgres://switchboard:switchboard@localhost:5432/switchboard \
SQLITE_PATH=./data/switchboard.db \
npm run migrate:legacy
```

The script copies flags into the default project/environment, preserves
settings and timestamps, and is idempotent. See
[`docs/MIGRATION.md`](docs/MIGRATION.md) for the full procedure.

## Configuration export/import

Project, environment, flag, and rollout definitions can be exported as
versioned JSON for backups, CI seeding, or copying staging to production. API
keys are never exported.

```bash
# SQLite (uses V2_DB_PATH; defaults to ./data/switchboard-v2.db)
V2_DB_PATH=./data/switchboard-v2.db npm run export:config -- --file backup.json
V2_DB_PATH=./data/switchboard-v2.db npm run import:config -- --file backup.json --dry-run
V2_DB_PATH=./data/switchboard-v2.db npm run import:config -- --file backup.json

# Postgres
DATABASE_URL=postgres://... npm run export:config -- --file backup.json
```

To write JSON to stdout instead of a file, use
`npm run --silent export:config` (the npm banner would otherwise corrupt the
JSON) or call `node scripts/export-config.mjs` directly.

Import is additive and idempotent: it creates missing projects, environments,
and flags, updates flag descriptions and configs, and never deletes or renames
anything. API keys must be recreated on the target instance. `--dry-run`
validates and reports counts without persisting configuration rows; on a fresh
path the database file/schema and default project may still be bootstrapped.
The format is
`switchboard-v2-export` version `1`; flags are listed per environment only when
a config exists there.

## Metrics

`GET /metrics` exposes Prometheus text format 0.0.4 for self-hosted monitoring.
It is public like `/healthz` and contains no tenant data, API keys, flag keys,
or raw paths.

- `switchboard_http_requests_total{method,route,status}` — response counter; the
  route label is the Fastify template (for example `/api/flags/:key`).
- `switchboard_http_request_duration_seconds` — histogram with fixed buckets.
- `switchboard_flag_evaluations_total{result}` — OFREP and legacy evaluation
  reasons (`SPLIT`, `DISABLED`, `BUCKET_INCLUDED`, ...); `FLAG_NOT_FOUND` is
  counted for legacy and single-flag OFREP lookups.
- `switchboard_db_failures_total` — responses mapped to `503`.

Example scrape:

```text
curl -sS http://localhost:3000/metrics
# HELP switchboard_http_requests_total HTTP responses by method, route template and status.
# TYPE switchboard_http_requests_total counter
switchboard_http_requests_total{method="GET",route="/healthz",status="200"} 1
```

Add a Prometheus scrape target for `/metrics`; there is no authentication,
persistence, OpenTelemetry, or per-user labeling.

## Tests

```bash
npm test              # v1 + v2 SQLite tests
npm run test:db       # Postgres integration (requires DATABASE_URL)
npm run test:contract # OFREP contract + official @openfeature/ofrep-provider test
npm run test:workspaces # SDK/provider build + tests
npm run smoke         # Docker Compose + Postgres smoke test
npm run bench         # OFREP load benchmark (see below)
```

`npm run bench` is a dependency-free load driver. It starts a local server on a
free port, creates a benchmark project/flag/API key, and reports requests/sec
plus average, p50, and p99 latency for single-flag and bulk OFREP evaluation.
Defaults are 10 connections and 10s per scenario; override them with
`BENCH_CONNECTIONS` and `BENCH_DURATION`. SQLite mode uses a temporary database
that is removed afterwards. To run against Postgres instead, set
`DATABASE_URL`:

```bash
DATABASE_URL=postgres://... npm run bench
```

Postgres mode writes the benchmark project, environment, flag, and API key to
that database and does not delete them (v2.0 has no project/flag deletion);
point it at a dedicated benchmark database. Numbers are from one run and are
directional, not a capacity guarantee.

Current local suite: 141 tests, 137 pass, 4 skipped when `DATABASE_URL` is not
set.

Real outputs: [`docs/EVIDENCE.md`](docs/EVIDENCE.md)

## Architecture

```text
src/
  app.js                 # Fastify app factory
  server.js              # env, v1/v2 selection, graceful shutdown
  db.js                  # v1 SQLite
  metrics.js             # dependency-free Prometheus registry
  flags/                 # v1 legacy routes/repository/evaluator
  v2/
    db.js                # Kysely Postgres/SQLite + migrations
    evaluator.js         # v2 100k bucket evaluator
    repositories/        # projects, flags, API keys
    routes/              # management + OFREP
    legacy-repository.js # v1 API over the v2 schema
db/migrations/           # Kysely migrations
packages/
  sdk-node/              # Node/TypeScript SDK
  openfeature-provider/  # OpenFeature provider
examples/
  service-a/             # SDK example
  service-b/             # OpenFeature example
```

## Documentation

- [v1 implementation plan](docs/PLAN.md)
- [v2 expansion plan](docs/EXPANSION_PLAN.md)
- [Decision record](docs/DECISIONS.md)
- [Test/demo evidence](docs/EVIDENCE.md)
- [v2 review and closure](docs/REVIEW-v2.md)
- [v1 review and closure](docs/REVIEW.md)
- [Migration guide](docs/MIGRATION.md)

## Limitations

- `ADMIN_TOKEN` is still the bootstrap admin credential; project-scoped admin
  keys and RBAC/SSO are later work.
- v2.0 supports boolean flags only; targeting rules, segments, and
  string/number/JSON flags are later work.
- Server API keys only; browser/client keys and a browser SDK are later work.
- Single Postgres instance target; server-side flag/config evaluation reads
  are uncached. The only server-side cache is a process-local 5s API-key prefix
  cache (multi-instance revocation may lag up to 5s; an in-flight lookup can
  still complete with the pre-revocation row). The SDK's optional bulk cache is
  process-local to the calling service (ADR-024). No streaming or rate limiting
  yet.
- The v1 browser demo and video are in Turkish; the v2 demo video and the v2
  API/docs are in English.
- Feature flags must not replace authorization.

## License

MIT. See [`LICENSE`](LICENSE).
