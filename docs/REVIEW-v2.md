# v2 Review and Closure

## Verdict

Independent v2 review (fresh context, starting from `ae8e8fa`): **NOT READY**.
The legacy API's numeric `id`, OFREP error/ETag behavior, clean-checkout demo
path, official OFREP provider coverage, and v2 video/evidence were incomplete.

After the follow-up work below: **findings closed**, subject to the final
release checks at the end of this document.

## Scope

The review covered the v2 expansion plan, decisions, README, legacy
compatibility, OFREP, the Node SDK, the OpenFeature provider, Docker/Postgres,
migration, security, and evidence. B1 (cross-environment mutation on a failed
`PATCH`) was already fixed in `7adfa2b` before this follow-up.

## Findings and closure

| ID | Finding | Closure |
|---|---|---|
| B1 | Failed cross-environment `PATCH` mutated another environment | Closed in `7adfa2b` before this follow-up |
| M1 | Legacy `/api/flags` lost the numeric v1 `id` | Closed in `3bb5a1e`: nullable per-project `legacy_id`, migration `002_flag_legacy_id.mjs`, preserved SQLite IDs, numeric legacy responses |
| M2 | OFREP 400/500 shapes and unquoted ETag/304 behavior | Closed in `e66adaa`: scoped OFREP error handler, `evaluationFailure`/`bulkEvaluationFailure`/`errorDetails`, 503 storage representation, quoted ETag with `projectKey`, quoted/unquoted `If-None-Match`, ETag on 304 |
| M3 | Clean `npm ci` checkout could not run `demo:v2` without `dist` | Closed in `13fd8a7`: `predemo:v2` build hook, package READMEs, `.env`-aware token examples |
| M4 | Only the local OpenFeature provider was tested | Closed in `90ac9c0`: official `@openfeature/ofrep-provider` integration test against a live local server |
| M5 | No 2–3 minute v2 video and stale v2 evidence | Closed in `98c4e5d`: 2:17 silent video, current evidence section, README video link |
| m1 | Postgres/storage failures were not mapped consistently | Closed in `c24d924`: storage error classifier (SQLite, network, Postgres SQLSTATE) plus a Postgres failure test |
| m2 | Default project/environment seeding could race | Closed in `ea91af7`: insert-on-conflict + read-back, concurrency test |
| m3 | `npm run migrate` used the v1 SQLite path | Closed in `feae0c6`: uses `V2_DB_PATH` |
| m4 | `context.targetingKey` was not validated as a string | Closed in `feae0c6`: JSON schema property plus a 400 test |
| m5 | No DB checks for `enabled`/`rollout_basis_points` | Closed in `00fadfb`: migration `003_flag_config_checks.mjs` for both dialects, SQLite/PG tests |
| m6 | Postgres tests were too narrow | Closed in `826c643`: migration, legacy routes, revocation, isolation, and check constraints |
| m7 | Management OpenAPI missing | Explicitly deferred in ADR-021; OFREP is the OpenAPI contract |
| m8 | README linked the stale v1 review | This document; README links both v1 and v2 reviews |
| m9 | Migration rollback mentioned `DATABASE_URL` ambiguously | Fixed in `docs/MIGRATION.md` |
| m10 | Compose default password/port exposure | Fixed in `feae0c6`: required `POSTGRES_PASSWORD`, localhost bindings |
| m11 | EVIDENCE browser-storage wording and release metadata | Fixed in `98c4e5d`: `sessionStorage`, v2 release metadata, current outputs |
| n1 | Optional API-key prefix collision handling | Closed in `a3884e2`: insert retries with a fresh prefix; duplicate prefix index removed in migration `004_drop_duplicate_prefix_index.mjs` |
| n2 | Optional last-used write reduction | Closed in `a3884e2`: `last_used_at` is refreshed at most once per minute per key |
| n3 | Optional URL-encoded Postgres password | Documented deployment caveat; Compose requires an explicit password and binds to localhost |

## Final verification

```text
npm test                 # twice: 106 tests, 103 pass, 3 skipped
npm run test:contract    # 11 pass
npm run test:workspaces  # sdk 5/5, provider 3/3
npm run test:db          # 3 pass with Postgres
npm run smoke            # legacy + v2 survived restart and down/up
npm run migrate          # creates the V2_DB_PATH SQLite database
```

The `v2.0.0` tag is created only after these checks and the final docs commit.
