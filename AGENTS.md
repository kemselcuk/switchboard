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
- Postgres primary; Kysely for the v2 repositories
- SQLite + `better-sqlite3` for legacy/local/test
- `@fastify/static` (single-page demo)
- `node:test` + Fastify `inject`
- npm workspaces: `packages/sdk-node`, `packages/openfeature-provider`

## Commands

```bash
npm ci              # install dependencies
npm test            # unit/legacy tests
npm run test:db     # Postgres integration tests
npm run test:contract # OFREP contract tests
npm run migrate     # run database migrations
npm run dev         # local development (watch)
npm start           # run locally
npm run smoke       # Docker smoke test
```

## Code rules

- ESM (`import`/`export`), 2 spaces, semicolons, single quotes.
- Route handlers stay thin; business rules live under `src/flags/`.
- SQL only in `src/db.js` and `src/flags/repository.js`.
- Errors use the shared `{ error: { code, message } }` envelope.
- User input is validated with JSON schema; `userId` is not normalized.
- Secrets, tokens, and `.env` contents are never logged or committed.

## Scope boundaries

v2.0 includes projects, environments, environment server API keys, OFREP
evaluation, a Node/TS SDK, and an OpenFeature provider. Still out of scope for
v2.0: custom rule language, targeting segments, A/B experiments, user
accounts/RBAC/SSO, audit log, browser SDK, rate limiting, caching, streaming,
Kubernetes/Helm, SaaS billing, flag deletion/renaming, and authorization via
flags. If a new need arises, update `docs/EXPANSION_PLAN.md` first and ask the
user.

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
- `docs/PLAN.md` — v1 scope, phases, acceptance criteria.
- `docs/EXPANSION_PLAN.md` — current v2 plan and acceptance criteria.
- `docs/DECISIONS.md` — ADR-lite decisions.
- `docs/EVIDENCE.md` — real test/demo evidence.
- `docs/tasks/` — short task briefs.

## Security

- `ADMIN_TOKEN` is read only from an environment variable.
- Token comparison is constant-time.
- Environment API keys are returned once, stored as SHA-256 hashes with a
  lookup prefix, and never logged.
- Error responses contain no stack trace, file path, token, or API key.
- The demo page does not embed the token in HTML; it uses `sessionStorage`.
- Flags are not used for authorization; this warning stays in the README.
