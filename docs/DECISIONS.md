# Decision Record (ADR-lite)

This file briefly records the important technical decisions in Switchboard and
their consequences. If a new decision supersedes an existing one, the old record
is not deleted; a new ADR is added and the relationship is stated.

## ADR-001 — SHA-256 for deterministic bucketing

**Context:** The same user must always get the same result for the same flag and
rollout settings. When the percentage increases, the previously included group
must be preserved.

**Decision:** The first 32 bits of the `SHA-256(flagKey + ":" + userId)` hash
are mapped to the 0–99 range. A user is included when
`bucket < rolloutPercentage`.

**Consequences:**
- Changing the percentage does not re-hash; on a `%20 → %40` move, the previous
  set is preserved.
- Node's built-in `crypto` module is sufficient; no extra dependency.
- `flagKey` is treated as immutable. Renaming changes groups.
- The algorithm version is fixed in code. Changing it redistributes user
  groups.

## ADR-002 — 200 + FLAG_NOT_FOUND for an unknown flag

**Context:** Calling applications may encounter an unknown flag. Is that a
service failure or a normal "off" state?

**Decision:** An unknown flag returns `200`; `enabled:false`,
`reason:"FLAG_NOT_FOUND"`, `bucket:null`, `rolloutPercentage:null`.

**Consequences:**
- There is a single success path on the client; 404 is not handled separately.
- A flag being deleted or never created does not stop the calling application.
- The admin API still returns `404` for an unknown flag; this distinction is
  explained in the README.

## ADR-003 — 503 on DB failure, no silent fallback

**Context:** If SQLite cannot be opened or a query fails, evaluation cannot
happen. Silently returning `true` or `false` could be misleading.

**Decision:** A DB failure during evaluation returns `503` +
`EVALUATION_UNAVAILABLE`. In that case the example client falls back to `false`
and logs it.

**Consequences:**
- Service failure is distinguished from "flag off".
- There is no fail-open; flags do not replace authorization.
- The calling application explicitly chooses its own fallback policy.

## ADR-004 — Single Bearer token for admin

**Context:** A user account system is unnecessary for a small,
single-environment demo service.

**Decision:** Admin endpoints are protected by the `ADMIN_TOKEN` environment
variable and `Authorization: Bearer`. Comparison uses `timingSafeEqual`.
`/api/evaluate` and `/healthz` remain public.

**Consequences:**
- Setup is simple; the token never enters the repository.
- This is not production-grade authentication; the README states this
  explicitly.
- Multi-user administration, RBAC, and audit logs are out of scope.

## ADR-005 — SQLite + better-sqlite3

**Context:** The target is a single instance, low traffic, persistence, and
simple setup.

**Decision:** SQLite file; `better-sqlite3` synchronous API; WAL mode; Docker
volume.

**Consequences:**
- No extra database server; local startup is easy.
- Synchronous queries are sufficient for a single instance; high concurrency is
  not a goal.
- The Docker image may need build tools for the native module; the smoke test
  verifies this. If problems arise, the `node:sqlite` alternative is evaluated.

## ADR-006 — flagKey immutable

**Context:** Bucketing is based on `flagKey`. If the key changes, every user's
bucket changes.

**Decision:** A flag key cannot be changed after creation; there is no rename
endpoint.

**Consequences:**
- Determinism is preserved.
- A user who wants to change the key creates a new flag; this resets rollout
  history.
- The README includes the "keep the key stable" warning.

## ADR-007 — No cache during evaluation

**Context:** There is a single instance and a small data set. A cache introduces
inconsistency after updates and additional complexity.

**Decision:** Every evaluation reads from SQLite; no cache.

**Consequences:**
- Updates are visible on the next request.
- SQLite read cost is acceptable at this scale.
- Horizontal scaling and caching are out of scope.

## ADR-008 — Trunk-based git and a push for every green task

**Context:** The user wants a push to GitHub for every meaningful change.
Progress should not skip review.

**Decision:** Small commits on `main` for sequential work; short-lived
`task/<id>` branches for parallel work. Subagents commit; the orchestrator
pushes after checking the diff + tests. Definition of Done includes the push.

**Consequences:**
- `main` always stays green.
- Push history stays small and understandable.
- Force-push and secret commits are forbidden.

## ADR-009 — Central docs + task briefs

**Context:** A small number of durable documents is more readable than many
scattered task reports.

**Decision:** `docs/PLAN.md`, `docs/DECISIONS.md`, and `docs/EVIDENCE.md` are
central; `docs/tasks/NN-*.md` is used only for the short briefs handed to
subagents.

**Consequences:**
- Durable knowledge lives in one place; task briefs are temporary.
- The README is the main gateway to the outside world.
- Every task brief includes acceptance criteria and file boundaries.

## ADR-010 — Silent video + on-screen captions

**Context:** The short demo video should be understandable without a voiceover.

**Decision:** A 1–2 minute silent screen recording; short on-screen text at
critical steps; command output and timestamped evidence in the README.

**Consequences:**
- Video production and viewing are easy.
- Technical detail stays in the README and `EVIDENCE.md`.
- A voiceover version can be added separately if requested.

## ADR-011 — Build fallback in the deps stage for better-sqlite3 in Docker

**Context:** `better-sqlite3` is a native module. In this environment, the
prebuilt binary could not be downloaded during the Docker build.

**Decision:** The Dockerfile first tries `npm ci --omit=dev`; if that fails, it
installs `python3 make g++` only in the deps stage, compiles, and removes them
in the same stage. The runtime image runs as the non-root `node` user.

**Consequences:**
- The first build may take longer; no build tools remain in the runtime image.
- The smoke test verifies build, health, restart, and volume persistence.
- If the prebuilt binary works in the future, the fallback is not triggered.

## ADR-012 — Dev-only Playwright-core for demo recording

**Context:** The demo video should show real UI interactions; application
dependencies should not grow.

**Decision:** `scripts/record-demo.mjs` uses the `playwright-core` devDependency
and system Chrome. Playwright's FFmpeg component is downloaded once for the
video codec; MP4 conversion uses system `ffmpeg`. Because the production Docker
image uses `npm ci --omit=dev`, Playwright does not enter the image.

**Consequences:**
- Video is produced from real browser interaction; there is no browser-panel
  dependency.
- Recording requires local Chrome and the one-time FFmpeg component.
- The video is added as evidence at `demo/switchboard-demo.mp4`.
