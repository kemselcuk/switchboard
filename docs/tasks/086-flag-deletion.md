# Task 086 — Flag deletion (v2.1)

Follow-up to the v2.1 lifecycle decision. Read `AGENTS.md`,
`docs/EXPANSION_PLAN.md` section 15, and the v2 flag repository/routes first.

## Goal

Allow an operator to delete a flag and all of its environment configs with one
project-scoped admin call. Flag keys remain immutable; there is no rename and
no soft delete.

## API

```http
DELETE /api/v1/projects/:project/flags/:key
Authorization: Bearer <ADMIN_TOKEN>
```

- 200 `{ "key": "<key>", "deleted": true }` on success.
- 404 `PROJECT_NOT_FOUND` for an unknown project.
- 404 `FLAG_NOT_FOUND` for an unknown flag.
- 401 without a valid admin token.
- Deletes the `flags` row; FK cascade removes every `flag_configs` row in all
  environments. API keys are untouched.
- Deleting a flag makes OFREP single evaluation return 404 `FLAG_NOT_FOUND`,
  bulk evaluation omit it, and legacy `/api/flags` no longer list it.
- Recreating the same key creates a new flag with a new UUID and the next
  per-project `legacy_id` (IDs are never reused).

## Files

- `src/v2/repositories/flags.js` (delete method)
- `src/v2/routes/management.js` (route)
- `src/v2/schemas.js` (project+key params)
- `test/v2/flags.test.js` (HTTP/repository coverage)
- `test/db/postgres.test.js` (cascade on Postgres)
- `README.md`, `docs/DECISIONS.md` (ADR-027), `docs/EVIDENCE.md`,
  `docs/tasks/086-flag-deletion.md`, `docs/EXPANSION_PLAN.md`

## Out of scope

Renaming keys (ADR-006), soft delete/restore, audit log, UI delete control,
legacy `/api/flags` DELETE, project/environment deletion, and API-key changes.

## Acceptance criteria

- Deleting a flag removes it and all configs in every environment; the same key
  in another project is unaffected.
- Unknown project/flag, missing auth, and invalid keys return the documented
  statuses/envelopes.
- OFREP and legacy reads reflect the deletion; existing API keys still
  authenticate (unknown flag is 404, not 401).
- Recreating the key works and gets a new UUID and the next `legacy_id`.
- Postgres cascade is covered by `test:db`.
- Full suites green; README/ADR/EVIDENCE/task status updated.

## Workflow

Implement directly; small commits; independent review round if the provider
cooperates.

## Status (2026-10-21)

Landed on `main` in `6443faf`: repository delete + cascade, project-scoped
route, project/key schema, per-project legacy-ID sequence (migration 005),
SQLite/Postgres/HTTP tests, and docs.

Tests: flags 10/10, Postgres 5/5, full suite 144 (139 pass, 5 Postgres skips).
Real output is recorded in `docs/EVIDENCE.md` under "v2.1 flag deletion".

Still out of scope: rename, soft delete/restore, audit log, UI delete control,
legacy DELETE, project/environment deletion, and API-key changes.
