# Task 081 — v2 review follow-up

This thread starts with a clean context. Read this file, `docs/EXPANSION_PLAN.md`,
`docs/DECISIONS.md`, and `README.md` before changing code.

## Current state

- Repo: `/Users/kemalselcuk/.t3/projects/switchboard`
- v2.0.0 work is complete; findings are closed in `docs/REVIEW-v2.md`.
- B1 (cross-environment mutation on failed PATCH) was fixed in `7adfa2b`.
- `npm test`: 106 tests, 103 pass, 3 skipped (Postgres without `DATABASE_URL`).
- Independent v2 review verdict at handoff: NOT READY; all required findings
  below are now closed, and the remaining optional items are documented.

## User decisions

- Preserve the legacy numeric `id`: add a numeric `legacy_id` compatibility
  column/sequence; do not accept a breaking UUID change.
- Keep the DeepSeek V4.1 Flash `max` model.
- Work in small steps; report after each meaningful item; ask when a decision is
  needed.
- `v2.0.0` tag only after the review findings are closed and all suites pass.

## Required fixes

### M1 — Legacy numeric `id` (approved)

- Add `legacy_id` (nullable integer) to `flags`; migration for both SQLite and
  Postgres.
- Preserve old SQLite integer IDs during migration.
- Assign a stable per-project numeric ID to new flags created through the
  legacy API and to default-project v2 flags when needed.
- Legacy `/api/flags` must return that numeric `id`; v2 management responses may
  keep UUID `id`.
- Add migration/regression tests and update README/MIGRATION.

### M2 — OFREP error envelopes and ETag

- Single 400 must use `evaluationFailure`-shaped body; bulk 400 must use
  `bulkEvaluationFailure`; 500 should use OFREP `errorDetails`.
- Decide and document 503 representation for storage failures.
- Quote ETag values, compare quoted `If-None-Match`, resend `ETag` on 304, and
  include `projectKey` in the ETag input.
- Add contract tests for 400, 500/503, quoted conditional requests, and 304.

### M3 — Clean-checkout SDK/demo path

- `npm ci` followed by `npm start` must not make `demo:v2` fail because
  `packages/*/dist` is missing.
- Add a build step to the documented demo path (e.g. `npm run build` before
  `npm run demo:v2`) or a safe prepare script.
- Add `packages/sdk-node/README.md` and
  `packages/openfeature-provider/README.md`; state that packages are local,
  private, and not published to npm.
- Replace hardcoded `ADMIN_TOKEN=dev-token-change-me` examples with
  `$ADMIN_TOKEN` or a `.env`-aware command.

### M4 — Official OFREP provider test

- Add an integration test using the official `@openfeature/ofrep-provider`
  (or the official OFREP provider package appropriate for Node) against the
  local service, not only the local provider.
- Add the dependency as a dev dependency if needed.

### M5 — v2 video/evidence

- Record a 2–3 minute silent v2 video covering two services, project isolation,
  20→40 monotonicity, and legacy API compatibility, **or** get explicit user
  approval to descope it.
- Update `docs/EVIDENCE.md` and the README video link accordingly.

## Minor fixes

- Map Postgres/storage failures consistently; add a Postgres failure test.
- Make default project/environment seeding race-safe.
- Make `npm run migrate` use the v2 SQLite path (`V2_DB_PATH`) for local v2.
- Validate `context.targetingKey` as a string.
- Add DB CHECK constraints for `enabled` and `rollout_basis_points`.
- Extend Postgres tests: migration, legacy routes, revocation, isolation.
- Add a management OpenAPI contract or explicitly descope it.
- Replace the stale v1 review link / add a v2 review document.
- Fix migration rollback wording (remove `DATABASE_URL`).
- Tighten Compose defaults (password/port exposure).
- Correct EVIDENCE browser-storage wording and release metadata.
- Optional: API-key prefix collision retry; duplicate prefix index; last-used
  write reduction; URL-encode the Postgres password.

## Workflow

- Small commits; run `npm test` per change.
- Before release: `npm test` twice, `npm run test:contract`,
  `npm run test:workspaces`, `npm run test:db` with Postgres, and `npm run smoke`.
- Subagents may be used; the orchestrator reviews diffs, reruns tests, and
  pushes.
- Do not produce giant responses; keep context and outputs small.
