# Switchboard — Agent Rules

This file contains the binding project rules for every agent working in this
repository. Read it together with `docs/PLAN.md` and `docs/DECISIONS.md`.

## Project

Switchboard is a small, single-environment feature flag service. It supports
boolean flags, full on/off control, and deterministic percentage rollouts.
Flags are not an authorization mechanism.

## Stack

- Node.js 22+ (ESM)
- Fastify 5
- SQLite + `better-sqlite3`
- `@fastify/static` (single-page demo)
- `node:test` + Fastify `inject`

## Commands

```bash
npm ci            # install dependencies
npm test          # run all tests
npm run dev       # local development (watch)
npm start         # run locally
npm run smoke     # Docker smoke test
```

## Code rules

- ESM (`import`/`export`), 2 spaces, semicolons, single quotes.
- Route handlers stay thin; business rules live under `src/flags/`.
- SQL only in `src/db.js` and `src/flags/repository.js`.
- Errors use the shared `{ error: { code, message } }` envelope.
- User input is validated with JSON schema; `userId` is not normalized.
- Secrets, tokens, and `.env` contents are never logged or committed.

## Scope boundaries

Do not add: a custom rule language, segments, A/B analysis, user accounts/RBAC,
an audit log, multiple environments, SDKs, rate limiting, caching,
multi-instance support, Postgres, cloud deployment, flag deletion/renaming, or
authorization via flags. If a new need arises, update `docs/PLAN.md` first and
ask the user.

## Workflow

1. Read the task brief; do not start coding without one.
2. Make a small, single-purpose change.
3. Run `npm test`; run the Docker smoke test when relevant.
4. Add real output to `docs/EVIDENCE.md` (fabricated output is forbidden).
5. Commit. Subagents do not push; the orchestrator pushes.
6. Do not say "done" without a diff and test results.

## Git

- `main` always stays green.
- Every meaningful task aims for a commit and push.
- Parallel work uses short-lived `task/<id>` branches.
- Force-pushing, deleting others' work with `git reset --hard`, and committing
  secrets are forbidden.
- Commit messages: `feat:`, `fix:`, `test:`, `docs:`, `chore:`.

## Test expectations

- Determinism, monotonicity, bounds, contract, auth, DB failure, and persistence
  tests are required.
- Statistical tests use fixed ID lists; exact percentages are not asserted for
  small samples.
- Tests use `:memory:` or a temporary file database; they never touch the real
  `data/` directory.

## Documentation

- `README.md` — entry point, setup, API, and integration for external users.
- `docs/PLAN.md` — scope, phases, acceptance criteria.
- `docs/DECISIONS.md` — ADR-lite decisions.
- `docs/EVIDENCE.md` — real test/demo evidence.
- `docs/tasks/` — short task briefs.

## Security

- `ADMIN_TOKEN` is read only from an environment variable.
- Token comparison is constant-time.
- Error responses contain no stack trace, file path, or token.
- The demo page does not embed the token in HTML; it uses `sessionStorage`.
- Flags are not used for authorization; this warning stays in the README.
