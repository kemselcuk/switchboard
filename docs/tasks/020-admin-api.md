# Task 020 — Admin API, auth, and error envelope

## Goal

Add flag CRUD endpoints, Bearer token protection, and a consistent error
envelope. The evaluator, demo, and Docker are out of scope for this task.

## Current state

- `src/db.js` and `src/flags/repository.js` are ready.
- `buildApp({ dbPath, logger, repository })` exists; `/healthz` is available.
- Repository error classes: `FlagExistsError` (`FLAG_EXISTS`),
  `FlagNotFoundError` (`FLAG_NOT_FOUND`).
- `src/server.js` checks for a missing `ADMIN_TOKEN` but does not pass it to
  `buildApp` yet.

## Files

- `src/errors.js` (new)
- `src/auth.js` (new)
- `src/flags/schemas.js` (new)
- `src/flags/routes.js` (new)
- `src/app.js` (update)
- `src/server.js` (update)
- `test/auth.api.test.js` (new)
- `test/flags.api.test.js` (new)
- `test/health.test.js` (update if needed)

## API

### `POST /api/flags` (admin)

Body:

```json
{
  "key": "new-checkout",
  "description": "New checkout flow",
  "enabled": true,
  "rolloutPercentage": 20
}
```

- `key` is required; `^[a-z0-9][a-z0-9._-]{0,63}$`.
- `description` is optional, max 280, default `''`.
- `enabled` is an optional boolean, default `false`.
- `rolloutPercentage` is an optional integer 0–100, default `0`.
- Success: `201` + flag.
- Duplicate: `409` + `FLAG_EXISTS`.
- Invalid body: `400` + `VALIDATION_ERROR`.

### `GET /api/flags` (admin)

- Success: `200 { "flags": [...] }`.

### `GET /api/flags/:key` (admin)

- Success: `200` + flag.
- Missing: `404` + `FLAG_NOT_FOUND`.

### `PATCH /api/flags/:key` (admin)

- Body with at least one field: `description`, `enabled`, `rolloutPercentage`.
- Unknown field: `400`.
- Empty body: `400`.
- Success: `200` + updated flag.
- Missing: `404` + `FLAG_NOT_FOUND`.

There is no `DELETE` and no rename.

## Auth

- `ADMIN_TOKEN` environment variable; `Authorization: Bearer <token>`.
- Comparison must be constant-time. Hashing tokens with SHA-256 and using
  `timingSafeEqual` is allowed; a length mismatch must not throw.
- Missing/wrong token: `401` + `UNAUTHORIZED`; `WWW-Authenticate: Bearer`.
- `/healthz` stays public; `/api/evaluate` does not exist in this task.
- The token must never appear in any log or error response.

## Error envelope

All errors:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

- Fastify validation → `400` + `VALIDATION_ERROR`.
- Unknown route → `404` + `NOT_FOUND`.
- Unexpected error → `500` + `INTERNAL_ERROR`, message
  `"Internal server error"`; no stack trace.
- Errors starting with `SQLITE_` → `503` + `EVALUATION_UNAVAILABLE`
  (also used for evaluate later; consistent on admin routes too).
- `FlagExistsError` → `409`; `FlagNotFoundError` → `404`.

## Acceptance criteria

- `npm test` green.
- Auth tests: missing/wrong/correct token; health public.
- CRUD tests: create/list/get/patch; duplicate; invalid key; invalid rollout;
  empty patch; unknown field; unknown key.
- Response schemas match the planned fields exactly.
- No stack trace/token in error responses.
- Focused `git diff`; commit, do not push.

## Out of scope

Evaluator, `/api/evaluate`, demo UI, Docker, rate limiting, CORS, audit log,
delete/rename, user accounts.
