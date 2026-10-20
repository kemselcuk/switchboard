# Task 080 — Independent v2 review

Read-only review of the v2 expansion. Do not modify files, commit, or push.

## Scope

- `docs/EXPANSION_PLAN.md`
- `README.md`, `docs/DECISIONS.md`, `docs/MIGRATION.md`, `docs/EVIDENCE.md`
- `src/`, especially `src/v2/`
- `db/migrations/`
- `packages/sdk-node/`, `packages/openfeature-provider/`
- `test/v2/`, `test/db/`, `test/contract/`
- `Dockerfile`, `compose.yaml`, `scripts/smoke-docker.sh`
- `public/v2.html`, `public/v2.js`
- `examples/service-a`, `examples/service-b`

## Checks

- v2 project/environment isolation and API-key security.
- OFREP single/bulk contract and authentication.
- v1 legacy API compatibility and SQLite → Postgres migration.
- v2 100,000-bucket monotonicity and legacy 100-bucket stability.
- Postgres/SQLite migration correctness.
- SDK and OpenFeature provider fallback/timeout behavior.
- Docker Compose v2, health, restart, down/up persistence.
- README/migration/SDK docs accuracy.
- Scope boundaries: no targeting rules, RBAC, streaming, browser SDK, etc.
- Secrets: no real tokens in repo; API keys returned once and hashed.

## Commands

```bash
npm test
npm run test:contract
npm run test:workspaces
# Optional if Docker is available:
# DATABASE_URL=... npm run test:db
# npm run smoke
git status --short
git log --oneline -12
```

## Output

Report Blockers / Major / Minor / Nit with file/line references, then
`READY` or `NOT READY`, and list anything required before `v2.0.0`.
