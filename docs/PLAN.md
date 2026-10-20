# Switchboard — Implementation Plan

This document is the detailed implementation plan for the approved approach.
Coding proceeds in small tasks after this plan is approved.

## 1. Product scope

Switchboard is a small feature flag service:

- Create and update boolean flags.
- Turn a flag fully on/off or expose it to a percentage of users.
- Deterministic evaluation by `flagKey` + `userId`.
- The same settings always produce the same result for the same user.
- Persistence across restarts with SQLite.

Out of scope: custom rule language, segments, A/B analysis, user accounts,
RBAC, audit log, multiple environments, SDKs, rate limiting, caching,
multi-instance, Postgres, cloud deployment, authorization via flags, flag
deletion/renaming.

## 2. Approved decisions

| Topic | Decision |
|---|---|
| Evaluation contract | `200` + `flagKey, userId, enabled, reason, bucket, rolloutPercentage`; invalid input `400`; unknown flag `200` + `FLAG_NOT_FOUND` |
| Errors/outage | DB failure `503` + `EVALUATION_UNAVAILABLE`; no silent fail-open |
| Admin | `ADMIN_TOKEN` + `Authorization: Bearer`; evaluate/health public |
| Demo | 1–2 min silent video + short on-screen captions + README evidence |
| Learning | 5–10 min walkthrough in Turkish of decisions and trade-offs at each milestone |
| Documentation | README + `docs/PLAN.md`, `DECISIONS.md`, `EVIDENCE.md` + short task briefs |
| Subagents | 3 roles, at most 2 at a time; implementer + fresh-context verifier + docs/demo |
| Model | DeepSeek V4.1 Flash `max`; coding and tests on this model |
| Budget | Existing Go subscription, additional model budget €0; additional infrastructure €0 |
| Git | Commit + push on every green, meaningful task |

## 3. Architecture

**Stack:** Node.js 22+, ESM, Fastify 5, `better-sqlite3`, `@fastify/static`,
`node:test`.

```text
src/
  app.js                 # buildApp(): test edilebilir Fastify uygulaması
  server.js              # env okuma, dinleme, graceful shutdown
  db.js                  # SQLite bağlantısı, şema, PRAGMA'lar
  auth.js                # Bearer token doğrulama
  errors.js              # ortak hata zarfı ve hata sınıfları
  flags/
    repository.js        # flag CRUD
    evaluator.js         # saf deterministik değerlendirme
    routes.js            # admin + evaluate route'ları
    schemas.js           # JSON schema'lar
public/
  index.html             # tek sayfalık demo
  app.js
  styles.css
examples/
  client.mjs             # küçük örnek istemci
test/
  evaluator.test.js
  flags.api.test.js
  evaluate.api.test.js
  persistence.test.js
scripts/
  demo.sh                # tekrarlanabilir demo adımları
  smoke-docker.sh        # Docker smoke testi
docs/
  PLAN.md
  DECISIONS.md
  EVIDENCE.md
  tasks/
```

**Data model — `flags`:**

| Field | Type / rule |
|---|---|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `key` | TEXT NOT NULL UNIQUE, immutable, `^[a-z0-9][a-z0-9._-]{0,63}$` |
| `description` | TEXT NOT NULL DEFAULT '', max 280 |
| `enabled` | INTEGER NOT NULL DEFAULT 0, CHECK 0/1 |
| `rollout_percentage` | INTEGER NOT NULL DEFAULT 0, CHECK 0–100 |
| `created_at`, `updated_at` | TEXT NOT NULL, ISO 8601 |

SQLite settings: `journal_mode = WAL`, `foreign_keys = ON`,
`busy_timeout = 5000`, `user_version = 1`.

## 4. API contract

### Admin endpoints

| Method | Path | Auth | Success |
|---|---|---|---|
| `POST` | `/api/flags` | Bearer | `201` flag |
| `GET` | `/api/flags` | Bearer | `200 { flags: [...] }` |
| `GET` | `/api/flags/:key` | Bearer | `200` flag, otherwise `404` |
| `PATCH` | `/api/flags/:key` | Bearer | `200` updated flag |

`POST /api/flags` body:

```json
{
  "key": "new-checkout",
  "description": "Yeni ödeme akışı",
  "enabled": true,
  "rolloutPercentage": 20
}
```

`PATCH /api/flags/:key` body (at least one field):

```json
{ "enabled": true, "rolloutPercentage": 40 }
```

### Evaluation

`POST /api/evaluate` (public):

```json
{ "flagKey": "new-checkout", "userId": "user-123" }
```

Known flag:

```json
{
  "flagKey": "new-checkout",
  "userId": "user-123",
  "enabled": true,
  "reason": "BUCKET_INCLUDED",
  "bucket": 37,
  "rolloutPercentage": 40
}
```

Unknown flag:

```json
{
  "flagKey": "missing",
  "userId": "user-123",
  "enabled": false,
  "reason": "FLAG_NOT_FOUND",
  "bucket": null,
  "rolloutPercentage": null
}
```

Reason values: `FLAG_DISABLED`, `FLAG_NOT_FOUND`, `BUCKET_INCLUDED`,
`BUCKET_EXCLUDED`.

### Error envelope

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

Codes: `UNAUTHORIZED`, `VALIDATION_ERROR`, `FLAG_EXISTS`, `FLAG_NOT_FOUND`,
`EVALUATION_UNAVAILABLE`, `NOT_FOUND`, `INTERNAL_ERROR`.

## 5. Deterministic algorithm

```text
u32    = SHA-256(flagKey + ":" + userId) ilk 4 byte, big-endian
bucket = floor((u32 / 2^32) * 100)        // 0–99
açık   = enabled && bucket < rolloutPercentage
```

- `flagKey` is immutable; there is no rename.
- Changing the percentage does not re-hash users. On a `%20 → %40` move, the
  previously included set is preserved.
- `userId` is opaque and case-sensitive; it is not normalized. The client is
  responsible for sending a stable ID.
- `BUCKET_ALGORITHM_VERSION = 1` is fixed in code. If the algorithm changes,
  groups are redistributed; the README carries a warning.
- Exact percentages are not expected in a small sample; tests assert set
  inclusion and determinism.

## 6. Phases and tasks

> Acceptance for every task: tests green + diff review + commit + push. WIP
> commits stay only on the short-lived task branch; broken code is never pushed
> to `main`.

### Phase 0 — Plan, repo, and skeleton

| ID | Task | Acceptance criterion |
|---|---|---|
| 0.1 | Documentation and `AGENTS.md` | Consistent with the approved decisions; commands, scope, and push rule documented |
| 0.2 | Git remote HTTPS + first push | `git ls-remote --heads origin` shows main; repo is not empty |
| 0.3 | Project skeleton + `/healthz` | `npm ci`, `npm test`, `npm start` work; no secrets |

### Phase 1 — Data and service core

| ID | Task | Acceptance criterion |
|---|---|---|
| 1.1 | SQLite schema | Idempotent; constraints; data survives reopen |
| 1.2 | Repository | CRUD tests; persistence; no SQL in routes |
| 1.3 | `buildApp()` + health + shutdown | Health 200; env validation; DB closes on SIGTERM |

### Phase 2 — Admin API

| ID | Task | Acceptance criterion |
|---|---|---|
| 2.1 | Bearer auth | 401/200; token never logged; public endpoints stay open |
| 2.2 | Flag CRUD + validation | 201/200/400/401/404/409; no delete |
| 2.3 | Shared error envelope | No stack leaks; consistent codes |

### Phase 3 — Deterministic evaluation

| ID | Task | Acceptance criterion |
|---|---|---|
| 3.1 | Evaluator | Golden vectors; determinism; 0/100; disabled |
| 3.2 | Evaluate route | Contract; unknown 200; DB failure 503 |
| 3.3 | Monotonicity + distribution | 1,000 IDs subset; 10,000 IDs ±2 points |
| 3.4 | Restart/persistence | Settings and results identical |

### Phase 4 — Demo and example client

| ID | Task | Acceptance criterion |
|---|---|---|
| 4.1 | Single-page demo | End to end; token not in HTML; 20→40 panel |
| 4.2 | Example client + demo script | Multiple users; JSON; 503 fallback |

### Phase 5 — Docker, tests, and security

| ID | Task | Acceptance criterion |
|---|---|---|
| 5.1 | Dockerfile + compose | Build/health/restart/down-up; volume persists |
| 5.2 | Full test suite | `npm test` repeatedly green; smoke green |
| 5.3 | Security/hygiene | No secrets; audit; body limit; timing-safe |

### Phase 6 — Documentation, video, and final

| ID | Task | Acceptance criterion |
|---|---|---|
| 6.1 | Final README + DECISIONS + EVIDENCE | Clean checkout; links; real outputs |
| 6.2 | Video + evidence | 20→40 subset, restart, same result, tests |
| 6.3 | Independent review + tag | All acceptance criteria; `v1.0.0` |

## 7. Test acceptance criteria

- Determinism: same input → same `bucket` and `enabled`.
- Monotonicity: the `%20` included set is a subset of the `%40` included set.
- Distribution: ±2 point tolerance for %20/%40 across 10,000 fixed IDs.
- Bounds: rollout `0` → nobody; `100` → everyone; `enabled:false` → everyone
  off.
- Contract: unknown `200` + `FLAG_NOT_FOUND`; invalid `400`; DB failure `503`.
- Auth: missing/wrong admin token → `401`; evaluate is public.
- Persistence: settings and results identical after close/reopen.
- Docker: build, health, restart, down/up, volume.

## 8. Demo acceptance criteria

- Create a flag, turn it on/off, and move rollout `20 → 40` in the UI.
- Repeated evaluation for the same user and a page refresh → same result.
- The same settings and result after `docker compose restart`.
- Examples with an unknown flag and an admin request without a token.
- `npm test` output and a 1–2 min silent video.

## 9. Git/push workflow

- `origin` will be switched to HTTPS; the `gh` credential helper will be used.
- Trunk-based `main`; small commits for sequential work, short-lived
  `task/<id>` branches for parallel work.
- Subagents commit; the orchestrator checks the diff + tests and pushes.
- Definition of Done: acceptance + tests green + docs/evidence + commit + push.
- No force-push to `main`; no secret commits; no pushing with failing tests.
- The `v1.0.0` tag is pushed at the end.

## 10. Cost

| Item | Cost | Note |
|---|---|---|
| Infrastructure | €0 | Local Docker, SQLite, public GitHub repo, local video |
| Model | €0 extra | Existing OpenCode Go; DeepSeek V4.1 Flash max |
| Estimated marginal tokens | ~$1–5 | Within the Go limit; includes review/retry margin |
| Video/CI | €0 | Local recording; CI optional |
| **Total additional cash** | **€0** | Excluding the Go subscription |

Budget guard: if usage approaches 10% of the Go limit or the estimate exceeds
$5, stop and ask the user.

## 11. Assumptions

- The GitHub repository stays public.
- The video is a local file linked from the README; a YouTube upload is done
  only if separately requested.
- CI is not required; it is optional to avoid expanding scope.
- `better-sqlite3` is the default; if it causes problems in Docker, switch to
  the `node:sqlite` alternative and record the decision in `DECISIONS.md`.
- The push workflow is trunk-based `main`; PRs are not required.
