<img src="assets/icon.svg" width="64" height="64" alt="">

# Switchboard

A small, single-environment **feature flag** service. Boolean flags, full
on/off control, and deterministic percentage rollouts.

The same `flagKey` + `userId` + settings always produce the same result. When
the rollout moves from `20%` to `40%`, the previously included group stays
included; new users are added, existing users are never dropped.

> This is a demo/portfolio project. Feature flags are not an authorization
> mechanism and should not replace production auth.

## What it does

- Creates and updates boolean feature flags.
- Turns a flag fully on/off or exposes it to a percentage of users.
- Evaluates a flag by `flagKey` + `userId` through a public API.
- Assigns users to a stable bucket with SHA-256.
- Persists settings and results in SQLite across restarts.

## Quick start

### Docker (recommended)

```bash
cp .env.example .env
# Change ADMIN_TOKEN in .env
docker compose up --build
```

Demo: http://localhost:3000

### Local Node

Requires Node.js 22+.

```bash
cp .env.example .env
npm ci
npm start
```

Tests:

```bash
npm test
```

Docker smoke test (clean volume, build, health, restart, down/up):

```bash
npm run smoke
```

## Demo

### Single-page UI

At `http://localhost:3000`:

1. Enter the admin token and save it.
2. Create a flag (e.g. `new-checkout`, `20%`, enabled).
3. Evaluate the same user several times; the result and bucket stay the same.
4. Run the **20 → 40 comparison** panel. It evaluates 12 fixed users at `20%`
   and then at `40%`, and marks preserved and newly opened users separately.
5. Refresh the page and evaluate the same user again; the result is unchanged.

The comparison panel intentionally leaves the flag at `40%` at the end.

### Reproducible demo script

```bash
ADMIN_TOKEN=dev-token-change-me npm run demo
```

Key output:

```text
At 20%: 4/12 open
At 40%: 8/12 open
4 preserved, 4 newly opened
```

Small samples do not need to match the exact percentage. What matters is that
the same user keeps the same bucket and that the previous included set is
preserved.

### Example client

```bash
node examples/client.mjs \
  --url http://127.0.0.1:3000 \
  --flag new-checkout \
  --users user-0000,user-0005,user-123
```

Output:

```text
USER       ENABLED  REASON           BUCKET  ROLLOUT
---------  -------  ---------------  ------  -------
user-0000  true     BUCKET_INCLUDED  3       40%
user-0005  true     BUCKET_INCLUDED  30      40%
user-123   false    BUCKET_EXCLUDED  65      40%
```

### Video

Short silent demo: [`demo/switchboard-demo.mp4`](demo/switchboard-demo.mp4)

The video shows flag creation, repeated evaluation of the same user, the
`20% → 40%` comparison, the same result after a server restart, and the test
summary.

To regenerate the video with the system Chrome browser:

```bash
npx playwright install ffmpeg   # Playwright video codec (one-time)
# MP4 conversion also needs system ffmpeg: brew install ffmpeg
npm run record:demo
```

## API

Admin endpoints require `Authorization: Bearer <ADMIN_TOKEN>`. Evaluation and
health endpoints are public.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/flags` | Bearer | Create a flag |
| `GET` | `/api/flags` | Bearer | List flags |
| `GET` | `/api/flags/:key` | Bearer | Get one flag |
| `PATCH` | `/api/flags/:key` | Bearer | Update `enabled`, `rolloutPercentage`, `description` |
| `POST` | `/api/evaluate` | Public | Evaluate `flagKey` + `userId` |
| `GET` | `/healthz` | Public | Health check |

### Create a flag

```bash
curl -sS -X POST http://localhost:3000/api/flags \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "key": "new-checkout",
    "description": "New checkout flow",
    "enabled": true,
    "rolloutPercentage": 20
  }'
```

```json
{
  "id": 1,
  "key": "new-checkout",
  "description": "New checkout flow",
  "enabled": true,
  "rolloutPercentage": 20,
  "createdAt": "2026-10-20T14:17:56.611Z",
  "updatedAt": "2026-10-20T14:17:56.611Z"
}
```

### Update a flag

```bash
curl -sS -X PATCH http://localhost:3000/api/flags/new-checkout \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"enabled": true, "rolloutPercentage": 40}'
```

A flag key is immutable after creation; there is no rename endpoint.

### Evaluate

```bash
curl -sS -X POST http://localhost:3000/api/evaluate \
  -H 'content-type: application/json' \
  -d '{"flagKey": "new-checkout", "userId": "user-0000"}'
```

```json
{
  "flagKey": "new-checkout",
  "userId": "user-0000",
  "enabled": true,
  "reason": "BUCKET_INCLUDED",
  "bucket": 3,
  "rolloutPercentage": 40
}
```

Unknown flag:

```json
{
  "flagKey": "missing-flag",
  "userId": "user-0000",
  "enabled": false,
  "reason": "FLAG_NOT_FOUND",
  "bucket": null,
  "rolloutPercentage": null
}
```

Reason values:

| Reason | Meaning |
|---|---|
| `FLAG_DISABLED` | Flag is off; rollout is ignored |
| `FLAG_NOT_FOUND` | Flag does not exist; `enabled:false` |
| `BUCKET_INCLUDED` | Bucket is below the rollout threshold |
| `BUCKET_EXCLUDED` | Bucket is at or above the rollout threshold |

### Errors

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

Codes: `UNAUTHORIZED`, `VALIDATION_ERROR`, `FLAG_EXISTS`,
`FLAG_NOT_FOUND`, `EVALUATION_UNAVAILABLE`, `NOT_FOUND`, `INTERNAL_ERROR`.

- Invalid body/field: `400`
- Missing/wrong admin token: `401`
- Unknown admin flag: `404`
- Duplicate flag: `409`
- DB/SQLite failure: `503 EVALUATION_UNAVAILABLE`

## Integration

Calling the evaluation API from another application:

```js
const BASE_URL = process.env.SWITCHBOARD_URL ?? 'http://localhost:3000';

export async function isEnabled(flagKey, userId) {
  const response = await fetch(`${BASE_URL}/api/evaluate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ flagKey, userId }),
    signal: AbortSignal.timeout(1000),
  });

  if (response.status === 503) {
    // Evaluation storage is unavailable. Choose your own fallback policy.
    return { enabled: false, fallback: true };
  }

  if (!response.ok) {
    throw new Error(`Switchboard HTTP ${response.status}`);
  }

  const result = await response.json();

  // Unknown flags also return 200 + enabled:false.
  return { enabled: result.enabled, fallback: false, result };
}
```

Integration rules:

- `userId` must be opaque and **stable**. It is not normalized and is
  case-sensitive. Always send the same ID for the same user.
- A `flagKey` must not change after creation. Changing the key changes every
  user's bucket.
- Unknown flag returns `200 + enabled:false`; it does not stop the caller.
- `503` is a service failure. Do not silently return `true`; choose an explicit
  fallback policy.
- A 500 ms–1 s timeout is recommended for evaluation calls.
- Feature flags must not be used for authorization.

## Deterministic algorithm

```text
u32    = SHA-256(flagKey + ":" + userId) first 4 bytes, big-endian
bucket = floor((u32 / 2^32) * 100)        // 0–99
open   = enabled && bucket < rolloutPercentage
```

- The hash input is UTF-8.
- `bucket` is in the `0–99` range.
- Changing the rollout does not re-hash users; only the threshold changes.
- On `20% → 40%`, everyone with `bucket < 20` also satisfies `bucket < 40`.
  The previous included set is therefore preserved.
- Small samples do not need to match `20%`/`40%` exactly; that is expected.
- The algorithm version is fixed in code as `BUCKET_ALGORITHM_VERSION = 1`.
  Changing it redistributes users.
- Why SHA-256? It is deterministic across platforms with Node's built-in
  `crypto` module, needs no extra dependency, and is sufficiently uniform.
- Why not random assignment? Random assignment can change results on every
  request or deploy; a hash-based bucket is stable.

## Persistence

The SQLite file is selected by `DB_PATH`; in Docker it lives in the
`switchboard-data:/app/data` named volume.

- `docker compose down`: removes the container, keeps the volume.
- `docker compose up`: flags and results remain.
- `docker compose down -v`: also removes the volume; clean start.

SQLite runs in `WAL` mode. The service targets a single instance; horizontal
scaling is out of scope.

## Tests

```bash
npm test
npm run smoke
```

`npm test` runs 58 tests:

- Determinism and golden vectors.
- Bucket bounds (`0–99`), rollout `0`/`100`.
- The `20%` set is a subset of the `40%` set for 1,000 fixed IDs.
- `20%`/`40%` distribution stays within ±2 points for 10,000 fixed IDs.
- API contract, unknown flags, validation, auth, and `503`.
- Flag settings and evaluation results remain identical after close/reopen.
- Static demo files and the JSON 404 envelope.

`npm run smoke` builds the Docker image and verifies health, flag creation,
restart, persistence after `down`/`up`, and `down -v` cleanup.

Real outputs: [`docs/EVIDENCE.md`](docs/EVIDENCE.md)

## Decisions

Key decisions are recorded as ADR-lite entries in
[`docs/DECISIONS.md`](docs/DECISIONS.md):

- SHA-256 deterministic buckets and monotonicity.
- `200 + FLAG_NOT_FOUND` for unknown flags.
- `503` on DB failure; no silent fail-open.
- Single `ADMIN_TOKEN` + Bearer; demo-grade admin security.
- SQLite + `better-sqlite3`; single instance.
- Immutable `flagKey`; no rename.
- No cache during evaluation.
- Trunk-based git with a push after every green task.
- Central docs + short task briefs.
- Silent video with on-screen captions.

## Documentation

- [Implementation plan](docs/PLAN.md)
- [Decision record](docs/DECISIONS.md)
- [Test/demo evidence](docs/EVIDENCE.md)
- [Independent review and closure](docs/REVIEW.md)

## Project structure

```text
src/
  app.js                 # buildApp(): testable Fastify application
  server.js              # env, listen, graceful shutdown
  db.js                  # SQLite connection and schema
  auth.js                # Bearer token verification
  errors.js              # error envelope and mappings
  flags/
    repository.js        # flag CRUD
    evaluator.js         # SHA-256 bucket + decision
    routes.js            # admin routes
    evaluate-routes.js   # public evaluate route
    schemas.js           # JSON schemas
public/                  # single-page demo
examples/client.mjs      # example client
scripts/demo.mjs         # 20 → 40 demo script
scripts/smoke-docker.sh  # Docker smoke test
test/                    # node:test tests
docs/                    # plan, decisions, evidence, task briefs
```

## Limitations

- `ADMIN_TOKEN` is demo-grade; there are no user accounts, RBAC, audit log, or
  token rotation.
- Single instance and SQLite; high concurrency/horizontal scaling is not a
  target.
- No rate limiting, cache, or multiple environments.
- No custom rule language, segments, or A/B analysis.
- No flag deletion/rename.
- Small samples may not match the exact percentage; that is statistical
  reality.
- Feature flags must not replace authorization.
- The browser demo and demo video are in Turkish; the API and documentation are
  in English.

## License

MIT. See [`LICENSE`](LICENSE).
