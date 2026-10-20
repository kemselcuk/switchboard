# Task 030 — Deterministic evaluation

## Goal

Add the SHA-256-based bucket algorithm, the `POST /api/evaluate` endpoint, and
determinism / monotonicity / persistence tests. The demo UI and Docker are out
of scope.

## Current state

- `buildApp({ dbPath, logger, repository, adminToken })` exists.
- `src/flags/routes.js` holds the admin routes; auth is attached to the plugin.
- `src/errors.js` contains `normalizeError`, which maps `SQLITE_` errors to
  `503 EVALUATION_UNAVAILABLE`.
- Repository: `getFlag(key)` returns `null` when the flag is not found.

## Files

- `src/flags/evaluator.js` (new)
- `src/flags/evaluate-routes.js` (new)
- `src/flags/schemas.js` (update: `evaluateBody`)
- `src/app.js` (update: register evaluate routes outside the auth plugin)
- `test/evaluator.test.js` (new)
- `test/evaluate.api.test.js` (new)
- `test/persistence.test.js` (new)
- `docs/EVIDENCE.md` (real test output)

## Algorithm

```text
u32    = SHA-256(flagKey + ":" + userId) first 4 bytes, big-endian
bucket = floor((u32 / 2^32) * 100)        // 0–99
open   = enabled && bucket < rolloutPercentage
```

- Export `BUCKET_ALGORITHM_VERSION = 1`.
- `bucketFor(flagKey, userId)` is a pure function.
- `evaluateFlag(flag, userId)` is a pure function; it returns:
  `{ bucket, enabled, reason }`.
- `!flag.enabled` → `enabled:false`, `reason:"FLAG_DISABLED"`.
- `enabled && bucket < rolloutPercentage` → `BUCKET_INCLUDED`.
- `enabled && bucket >= rolloutPercentage` → `BUCKET_EXCLUDED`.
- The bucket is computed and returned even when the flag is disabled.

## API

`POST /api/evaluate` is public; no auth.

Body:

```json
{ "flagKey": "new-checkout", "userId": "user-123" }
```

- `flagKey`: `^[a-z0-9][a-z0-9._-]{0,63}$`
- `userId`: string, 1–128, at least one non-whitespace character; not
  normalized, case-sensitive.
- Unknown but valid flag:
  `200 { flagKey, userId, enabled:false, reason:"FLAG_NOT_FOUND", bucket:null, rolloutPercentage:null }`.
- Known flag:
  `200 { flagKey, userId, enabled, reason, bucket, rolloutPercentage }`.
- Invalid body: `400 VALIDATION_ERROR`.
- DB failure (`SQLITE_` code): `503 EVALUATION_UNAVAILABLE`; no stack trace or
  DB path is leaked.
- Reason values: `FLAG_DISABLED`, `FLAG_NOT_FOUND`, `BUCKET_INCLUDED`,
  `BUCKET_EXCLUDED`.

## Tests

### `test/evaluator.test.js`

- At least 5 golden vectors: `(flagKey, userId) → bucket`.
- The same input gives the same bucket/enabled 100 times.
- Buckets are always 0–99.
- Rollout 0 → `BUCKET_EXCLUDED`; 100 → `BUCKET_INCLUDED`.
- `enabled:false` → `FLAG_DISABLED` (regardless of rollout).
- At least one example showing that different flagKeys can place the same user
  in different buckets (not left to chance; use computed values).

### `test/evaluate.api.test.js`

- Exact response shape and field types for a known flag.
- Included and excluded user examples (chosen by bucket).
- Disabled flag → `FLAG_DISABLED`.
- Unknown flag → `200` + `FLAG_NOT_FOUND`, bucket/rollout `null`.
- Invalid body: missing field, wrong type, invalid flagKey, whitespace userId.
- No auth required; a call without a token returns 200.
- Repository throwing `SQLITE_IOERR` returns `503` with no internal details in
  the message.
- No extra fields in the response.

### `test/persistence.test.js`

- Temporary file DB; `buildApp({ dbPath, adminToken })`.
- Create a flag, evaluate a fixed user.
- `app.close()`; call `buildApp` again with the same `dbPath`.
- Flag settings and the same user's evaluation result are identical.

### Monotonicity / distribution

In `evaluator.test.js`:

- For 1,000 fixed IDs (`user-0000` … `user-0999`), the `%20` included set is a
  subset of the `%40` included set.
- For 10,000 fixed IDs, the `%20` and `%40` ratios stay within ±2 points.
- The tests use fixed ID lists, so they must be deterministic; no randomness.

## Acceptance criteria

- `npm test` green; report the total test count and pass/fail.
- `POST /api/evaluate` works without auth; admin routes stay protected.
- `npm test` green at least 2 times in a row (not flaky).
- Focused `git diff`; commit, do not push.
- Commit message: `feat: add deterministic flag evaluation API`.

## Out of scope

Demo UI, example client, Docker, a new admin endpoint, cache, rate limiting,
custom rule language, flag rename/delete.
