# Task 010 — Storage core

## Goal

Add the SQLite schema, the flag repository, and a testable `buildApp()` skeleton.
Do not add HTTP routes, auth, the evaluator, or the demo yet.

## Files

- `src/db.js` (new)
- `src/flags/repository.js` (new)
- `src/app.js` (update)
- `src/server.js` (update)
- `test/repository.test.js` (new)
- `test/health.test.js` (update if needed)

## Requirements

### `src/db.js`

- A function such as `openDatabase({ dbPath = ':memory:' })`.
- If `dbPath` is a file path, create its parent directory.
- `PRAGMA journal_mode = WAL` (for a file DB), `foreign_keys = ON`,
  `busy_timeout = 5000`.
- `flags` table:
  - `id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `key TEXT NOT NULL UNIQUE`
  - `description TEXT NOT NULL DEFAULT ''`
  - `enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1))`
  - `rollout_percentage INTEGER NOT NULL DEFAULT 0 CHECK (rollout_percentage BETWEEN 0 AND 100)`
  - `created_at TEXT NOT NULL`
  - `updated_at TEXT NOT NULL`
- The schema must be idempotent (`CREATE TABLE IF NOT EXISTS`).
- `PRAGMA user_version = 1`.
- Must be closable via `close()` or `db.close()`.

### `src/flags/repository.js`

- `createFlag({ key, description, enabled, rolloutPercentage })`
- `listFlags()`
- `getFlag(key)`
- `updateFlag(key, patch)` — updates only the provided fields.
- Return objects are camelCase: `{ id, key, description, enabled, rolloutPercentage, createdAt, updatedAt }`.
- `enabled` must be returned as a boolean.
- Use meaningful error classes/throws for a duplicate key and a missing record.
  The route layer will map these to HTTP; there are no routes in this task.
- SQL only in this file and `src/db.js`.

### `src/app.js`

- `buildApp({ dbPath = ':memory:', logger = false, repository } = {})`.
- Wire the DB/repository into the app; `app.close()` closes the DB.
- `/healthz` keeps its current behavior.
- Allow `repository` injection for tests (for a future DB-failure test).
- Redact the `authorization` header in the logger (auth does not exist yet, but
  this is the groundwork).

### `src/server.js`

- `process.exit(1)` with a clear message if `ADMIN_TOKEN` is missing.
- Use the `PORT`, `HOST`, `DB_PATH`, `LOG_LEVEL` environment variables.
- Call `app.close()` on SIGINT/SIGTERM.

## Acceptance criteria

- `npm test` green.
- Repository tests: create/get/list/update, duplicate, not found, boolean
  conversion, record preserved after close/reopen on a temp file DB.
- `buildApp()` health test green.
- `git diff` small and focused.
- Commit; do not push.

## Out of scope

HTTP routes, auth, evaluator, demo, Docker, documentation changes (unless
needed).
