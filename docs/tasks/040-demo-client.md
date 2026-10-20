# Task 040 — Single-page demo and example client

## Goal

Add a single-page demo UI with `@fastify/static`, a small Node example client,
and a reproducible demo script. Docker and the final README are out of scope.

## Current state

- `buildApp({ dbPath, logger, repository, adminToken })` exists.
- `/healthz`, `/api/flags` (admin), and `/api/evaluate` (public) work.
- The `@fastify/static` dependency is already in `package.json`.
- `public/` does not exist yet.

## Files

- `src/app.js` (static file serving)
- `public/index.html` (new)
- `public/styles.css` (new)
- `public/app.js` (new)
- `examples/client.mjs` (new)
- `scripts/demo.mjs` (new)
- `test/static.test.js` (new)
- `package.json` (`demo` script)
- `docs/EVIDENCE.md` (real output)

## Demo UI requirements

Single page, no framework, no build step. It must be served at
`http://localhost:3000/`.

### Sections

1. **Header / status**
   - App name, short description.
   - `/healthz` status badge.

2. **Connection**
   - Admin token input (`type="password"`).
   - The token is kept in `sessionStorage`; it is not embedded in HTML.
   - "Save" button; without a token, no admin calls are made and a warning is
     shown.

3. **Create flag**
   - `key`, `description`, `enabled` checkbox, `rolloutPercentage` number.
   - `POST /api/flags`; on success the list refreshes; an error message is
     shown.

4. **Flag list**
   - For each flag: key, description, enabled toggle, rollout slider/number,
     "Save" button.
   - `PATCH /api/flags/:key`.
   - Rollout 0–100; client-side validation before saving.

5. **Evaluate**
   - Flag selection, `userId` input, "Evaluate" button.
   - `POST /api/evaluate` (no token required).
   - Result card: enabled, reason, bucket, rolloutPercentage.
   - Last 10 evaluations table: time, flag, userId, enabled, reason, bucket.

6. **20 → 40 comparison panel**
   - 12 fixed demo users for the selected flag (IDs chosen for bucket
     distribution; same list as `public/app.js` and `scripts/demo.mjs`).
   - First set rollout to 20 with `PATCH`, evaluate the users.
   - Then set rollout to 40 with `PATCH`, evaluate the same users.
   - Table: userId, bucket, 20% result, 40% result, "preserved" / "newly
     opened".
   - If the flag is off, the panel shows the message "Flag off; turn it on
     first".
   - The panel may leave the flag on at 40% at the end; this demo behavior is
     stated in the README.

### UI quality

- Vanilla JS; `fetch`; `async/await`.
- User data is rendered with `textContent`; user data is not injected with
  `innerHTML`.
- Error messages are visible and in Turkish.
- 401 → "Admin token invalid"; 503 → "Service temporarily unavailable".
- Simple responsive grid; accessible labels/buttons.
- Dark/light preference is optional; do not expand scope.

## Example client — `examples/client.mjs`

- Node 22 `fetch`; no extra dependencies.
- Usage:

```bash
node examples/client.mjs \
  --url http://127.0.0.1:3000 \
  --flag new-checkout \
  --users user-0000,user-0005,user-123
```

- `SWITCHBOARD_URL`, `SWITCHBOARD_FLAG`, `SWITCHBOARD_USERS` environment
  alternatives.
- `POST /api/evaluate` for each user; print the results as JSON lines or a
  readable table.
- 503 → `enabled:false` fallback for each user and log
  `reason:"EVALUATION_UNAVAILABLE_FALLBACK"`; exit code `2`.
- Other HTTP/network errors → clear error message; exit code `1`.
- `--help` support.

## Demo script — `scripts/demo.mjs`

- `ADMIN_TOKEN` (default `dev-token-change-me`) and `BASE_URL` (default
  `http://127.0.0.1:3000`).
- Creates the `demo-checkout` flag; updates it if it already exists.
- Evaluates 12 fixed users first at `%20`, then at `%40`.
- Table: userId, bucket, 20%, 40%, preserved/new.
- Summary: how many users are included at 20, how many at 40, how many were
  preserved.
- Clear message and exit code 1 on error.
- Add `"demo": "node scripts/demo.mjs"` to `package.json`.

## Tests

`test/static.test.js`:

- `GET /` → 200, `text/html`, contains `Switchboard`.
- `GET /app.js` → 200, JavaScript content.
- `GET /styles.css` → 200, CSS content.
- Unknown `/api/...` still returns the JSON `NOT_FOUND` envelope.

Additionally, manual checks against a real server:
- The demo page opens with `npm start`.
- `node examples/client.mjs ...` works.
- `npm run demo` prints the 20→40 table.

## Acceptance criteria

- `npm test` green; static tests included.
- The demo page makes no admin calls without a token; the token is not in the
  HTML.
- `npm run demo` produces real output; the output is added to `EVIDENCE.md`.
- `examples/client.mjs --help` works; example output is in `EVIDENCE.md`.
- Focused `git diff`; commit, do not push.
- Commit message: `feat: add demo UI and example client`.

## Out of scope

Docker, final README, video, a new API endpoint, framework/build step, user
accounts, rate limiting.
