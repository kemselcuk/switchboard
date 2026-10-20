# Task 050 — Docker, volume, and smoke test

## Goal

Run the service in Docker with a single command; verify persistence across
restart and down/up with a SQLite volume. Do not change application behavior
(unless required).

## Files

- `Dockerfile` (new)
- `compose.yaml` (new)
- `.dockerignore` (new)
- `scripts/smoke-docker.sh` (new)
- `package.json` (the `smoke` script already exists; fix it if needed)
- `README.md` (Docker quick start section)
- `docs/EVIDENCE.md` (real Docker output)

## Docker requirements

- Multi-stage build based on `node:22-bookworm-slim`.
- `npm ci --omit=dev`; production dependencies.
- If the `better-sqlite3` native module causes problems during build, use the
  required build tools only in the deps stage; do not bloat the runtime image.
- Non-root `node` user.
- Create the `/app/data` directory and give it to the `node` user.
- `EXPOSE 3000`; `CMD ["node", "src/server.js"]`.
- `.dockerignore`: `node_modules`, `data`, `.git`, `.env`, logs, and unnecessary
  files that are not tests/demo.

## Compose requirements

- `switchboard` service; `build: .`.
- Port: `${PORT:-3000}:3000`.
- Env: `ADMIN_TOKEN` required; `DB_PATH=/app/data/switchboard.db`;
  `HOST=0.0.0.0`; `LOG_LEVEL`.
- Named volume: `switchboard-data:/app/data`.
- Healthcheck: Node fetch against `/healthz`; interval 5s, retries 10.
- `init: true`.
- Compose must fail clearly when `ADMIN_TOKEN` is missing; no hidden default
  token.

## Smoke test — `scripts/smoke-docker.sh`

`set -euo pipefail`; project name `switchboard-smoke`; port `3101`; token
`smoke-token` (smoke only).

Flow:

1. Clean start with `docker compose -p switchboard-smoke down -v`.
2. `docker compose -p switchboard-smoke up -d --build`.
3. Wait up to 30 s for `/healthz`.
4. Create `smoke-flag` (`enabled=true`, `rolloutPercentage=20`).
5. Evaluate the fixed `user-123`; store the result.
6. `docker compose restart`; wait for health; evaluate the same user again;
   `bucket` and `enabled` must be the same.
7. `down` (without deleting the volume) + `up -d`; wait for health; the flag and
   result must still be the same.
8. Clean up with `down -v` (also clean up on error via a trap).
9. Print every step with real output.

Use `node -e` for JSON parsing; do not assume `jq` is available.

## README

- Docker quick start:
  ```bash
  cp .env.example .env
  docker compose up --build
  ```
- Explain that `docker compose down` does not delete data, while `down -v` does.

## Acceptance criteria

- `docker compose up --build` succeeds; healthcheck is healthy.
- `npm run smoke` succeeds and the real output is in `EVIDENCE.md`.
- Flag settings and the same user's result are preserved after restart and
  down/up.
- Clean start after `docker compose down -v`.
- The image runs non-root (`docker compose exec switchboard id`).
- `npm test` still green.
- Commit; do not push. Commit message: `chore: add Docker setup and smoke test`.

## Out of scope

CI, cloud deployment, Postgres, multi-instance, auth changes, new API.
