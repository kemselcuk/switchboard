# Demo and Test Evidence

This file contains only output from commands that were actually run, plus demo
evidence. All sections are filled with real output.

> Note: Some transcript labels are in Turkish because the demo UI is Turkish.
> Literal command output is preserved exactly.

## Environment

- Date: 2026-10-20
- Machine: macOS (arm64), Node.js 22.23.2, Docker 29.8.1, SQLite 3.51.0
- Release tag: `v1.0.0` (code release; English docs on main)
- GitHub: https://github.com/kemselcuk/switchboard

## 1. Automated tests

Initial storage-core tests (commit `586dfad`):

```text
✔ buildApp accepts an injected repository without opening a database
✔ app.close() closes the owned database
✔ createFlag stores a flag and returns it in camelCase
✔ createFlag applies defaults for optional fields
✔ getFlag returns null for an unknown key
✔ listFlags returns flags in creation order
✔ updateFlag only changes the provided fields
✔ updateFlag with an empty patch returns the current flag
✔ createFlag rejects a duplicate key
✔ updateFlag rejects an unknown key
✔ schema enforces the rollout percentage bounds
✔ file database keeps flags after close and reopen

ℹ tests 13
ℹ pass 13
ℹ fail 0
```

Admin API, auth, and error-envelope tests (Task 020):

```text
✔ admin routes reject a request without a token
✔ admin routes reject a wrong token
✔ admin routes reject a token of a different length
✔ admin routes reject a malformed authorization header
✔ auth runs before body validation
✔ admin routes accept the configured bearer token
✔ admin routes reject every token when no token is configured
✔ health check stays public
✔ POST /api/flags creates a flag and returns the planned fields
✔ POST /api/flags applies defaults for optional fields
✔ POST /api/flags rejects a duplicate key
✔ POST /api/flags rejects invalid keys
✔ POST /api/flags rejects invalid rollout percentages
✔ POST /api/flags rejects invalid enabled and description values
✔ POST /api/flags rejects unknown body fields
✔ GET /api/flags lists flags in creation order
✔ GET /api/flags/:key returns a flag or FLAG_NOT_FOUND
✔ PATCH /api/flags/:key updates only the provided fields
✔ PATCH /api/flags/:key rejects empty and unknown fields
✔ PATCH /api/flags/:key rejects an unknown key
✔ unknown routes return the NOT_FOUND envelope
✔ repository SQLite errors become 503 without internal details
✔ unexpected errors become 500 without internal details

ℹ tests 36
ℹ pass 36
ℹ fail 0
```

Deterministic evaluation tests (Task 030, two consecutive `npm test` runs):

```text
✔ known flag returns the exact evaluation contract
✔ users are included or excluded according to their bucket
✔ disabled flag returns FLAG_DISABLED with the computed bucket
✔ unknown flag returns 200 with FLAG_NOT_FOUND and null fields
✔ invalid bodies return VALIDATION_ERROR
✔ evaluation is public while admin routes stay protected
✔ repository SQLITE errors become 503 without internal details
✔ bucketFor matches the golden vectors
✔ the same input returns the same bucket and decision 100 times
✔ buckets always stay within 0-99
✔ rollout 0 excludes everyone and rollout 100 includes everyone
✔ a disabled flag is FLAG_DISABLED regardless of rollout
✔ different flag keys can place the same user in different buckets
✔ the 20 percent set is a subset of the 40 percent set for 1000 IDs
✔ rollout ratios stay within 2 points for 10000 fixed IDs
✔ flag settings and evaluation survive close and reopen

ℹ tests 52
ℹ pass 52
ℹ fail 0
```

Both consecutive `npm test` runs produced the same result (52/52).

End-to-end server check with a temporary DB (`PORT=4317`, local test token):

```text
health: {"status":"ok"}
unauthorized: 401
{"error":{"code":"UNAUTHORIZED","message":"Missing or invalid bearer token"}}
create: 201
{"id":1,"key":"server-check","description":"wiring","enabled":true,"rolloutPercentage":20,"createdAt":"2026-10-20T14:07:27.807Z","updatedAt":"2026-10-20T14:07:27.807Z"}
patch: 200
{"id":1,"key":"server-check","description":"wiring","enabled":true,"rolloutPercentage":40,"createdAt":"2026-10-20T14:07:27.807Z","updatedAt":"2026-10-20T14:07:27.817Z"}
token in log: no
```

Server startup check without `ADMIN_TOKEN`:

```text
exit=1
ADMIN_TOKEN is required. Copy .env.example to .env and set a token.
```

## 2. Demo UI, example client, and demo script (Task 040)

Static files were requested from a local server running with a temporary
database (`PORT=3100`):

```text
HTTP/1.1 200 OK
content-type: text/html; charset=utf-8
app.js:200 application/javascript; charset=utf-8
styles.css:200 text/css; charset=utf-8
api-unknown:404 application/json; charset=utf-8
{"error":{"code":"NOT_FOUND","message":"Route not found"}}
```

The `GET /` response contains no admin token or default token value; the token
is held only in `sessionStorage` in the browser. The token value did not appear
in server logs either (`grep -c 'dev-token-change-me'` → `0`).

`npm test` after Task 040:

```text
✔ GET / serves the single-page demo
✔ GET /app.js serves the demo script without innerHTML user data
✔ GET /styles.css serves the demo stylesheet
✔ unknown API routes keep the JSON NOT_FOUND envelope
✔ unknown static paths fall back to the JSON NOT_FOUND envelope

ℹ tests 58
ℹ pass 58
ℹ fail 0
```

`npm run demo` (local server `http://127.0.0.1:3100`, temporary DB):

```text
> switchboard@0.1.0 demo
> node scripts/demo.mjs

Switchboard demo — %20 → %40 rollout
Servis: http://127.0.0.1:3100
Flag: demo-checkout (enabled=true, rollout=20%)

USER          BUCKET  %20     %40     DURUM
------------  ------  ------  ------  -----------
demo-user-01  4       açık    açık    korundu
demo-user-02  48      kapalı  kapalı  kapalı
demo-user-04  70      kapalı  kapalı  kapalı
demo-user-05  67      kapalı  kapalı  kapalı
demo-user-06  93      kapalı  kapalı  kapalı
demo-user-09  17      açık    açık    korundu
demo-user-14  37      kapalı  açık    yeni açıldı
demo-user-17  28      kapalı  açık    yeni açıldı
demo-user-19  15      açık    açık    korundu
demo-user-21  21      kapalı  açık    yeni açıldı
demo-user-25  3       açık    açık    korundu
demo-user-33  35      kapalı  açık    yeni açıldı

Özet: %20'de 4/12 açık, %40'ta 8/12 açık, 4 korundu, 4 yeni açıldı.
Demo sonunda flag %40 rollout ile açık bırakıldı.
```

When the same script was run a second time, it updated the existing
`demo-checkout` flag via `PATCH /api/flags/demo-checkout` and produced the same
result.

Example client with the `demo-checkout` flag (`enabled=true`,
`rolloutPercentage=40`):

```text
$ node examples/client.mjs --url http://127.0.0.1:3100 --flag demo-checkout \
    --users demo-user-01,demo-user-14,demo-user-02

USER          ENABLED  REASON           BUCKET  ROLLOUT
------------  -------  ---------------  ------  -------
demo-user-01  true     BUCKET_INCLUDED  4       40%
demo-user-14  true     BUCKET_INCLUDED  37      40%
demo-user-02  false    BUCKET_EXCLUDED  48      40%
exit=0
```

`--help` output and exit code:

```text
$ node examples/client.mjs --help
Switchboard örnek istemcisi

Kullanım:
  node examples/client.mjs --flag <key> --users <id1,id2,...> [--url <baseUrl>]

Seçenekler:
  --url    Servis adresi (varsayılan: http://127.0.0.1:3000)
  --flag   Değerlendirilecek flag anahtarı
  --users  Virgülle ayrılmış kullanıcı ID'leri
  --help   Bu yardımı göster

Ortam değişkenleri:
  SWITCHBOARD_URL, SWITCHBOARD_FLAG, SWITCHBOARD_USERS

Çıkış kodları:
  0  Tüm değerlendirmeler başarılı
  1 HTTP veya ağ hatası
  2  Servis 503 döndürdü; enabled=false fallback kullanıldı
exit=0
```

Fallback behavior against a local mock server returning 503:

```text
$ node examples/client.mjs --url http://127.0.0.1:4320 --flag demo-checkout \
    --users demo-user-01,demo-user-02

UYARI: demo-user-01 için servis 503 döndürdü; enabled=false fallback kullanıldı.
UYARI: demo-user-02 için servis 503 döndürdü; enabled=false fallback kullanıldı.
USER          ENABLED  REASON                           BUCKET  ROLLOUT
------------  -------  -------------------------------  ------  -------
demo-user-01  false    EVALUATION_UNAVAILABLE_FALLBACK  —       —
demo-user-02  false    EVALUATION_UNAVAILABLE_FALLBACK  —       —
Servis geçici olarak kullanılamıyor; fallback sonuçları gösterildi.
exit=2
```

Exit code `1` for an unreachable server:

```text
$ node examples/client.mjs --url http://127.0.0.1:4399 --flag demo-checkout \
    --users demo-user-01

Hata: http://127.0.0.1:4399 adresine ulaşılamadı: fetch failed
exit=1
```

Note: The 12 demo users were chosen to produce a 4/4/4 split for
`demo-checkout`: 4 included at %20, 8 included at %40 (4 preserved, 4 newly
opened), and 4 excluded. The buckets are 4, 48, 70, 67, 93, 17, 37, 28, 15, 21,
3, and 35. Exact percentages are not expected in a small sample; this set is
used for deterministic evidence.

## 3. Determinism and monotonicity

The `demo-checkout` flag was first set to `%20`, then `%40`. The same users'
buckets did not change; a user included at `%20` stayed included at `%40`, and a
user excluded at `%20` was included at `%40`:

```text
--- at20 user01
{"flagKey":"demo-checkout","userId":"demo-user-01","enabled":true,"reason":"BUCKET_INCLUDED","bucket":4,"rolloutPercentage":20}
--- at20 user14
{"flagKey":"demo-checkout","userId":"demo-user-14","enabled":false,"reason":"BUCKET_EXCLUDED","bucket":37,"rolloutPercentage":20}
--- at40 user01
{"flagKey":"demo-checkout","userId":"demo-user-01","enabled":true,"reason":"BUCKET_INCLUDED","bucket":4,"rolloutPercentage":40}
--- at40 user14
{"flagKey":"demo-checkout","userId":"demo-user-14","enabled":true,"reason":"BUCKET_INCLUDED","bucket":37,"rolloutPercentage":40}
```

The `bucket` values remained fixed at `4` and `37`. The `%20 → %40` move did not
re-hash; only the threshold changed.

## 4. API contract

Real `curl` responses (`demo-checkout`, `%40`):

```text
$ curl -sS http://127.0.0.1:3100/healthz
{"status":"ok"}

$ curl -sS -X POST -H 'content-type: application/json' \
    -d '{"flagKey":"demo-checkout","userId":"demo-user-01"}' \
    http://127.0.0.1:3100/api/evaluate
{"flagKey":"demo-checkout","userId":"demo-user-01","enabled":true,"reason":"BUCKET_INCLUDED","bucket":4,"rolloutPercentage":40}

$ curl -sS -X POST -H 'content-type: application/json' \
    -d '{"flagKey":"missing-flag","userId":"demo-user-01"}' \
    http://127.0.0.1:3100/api/evaluate
{"flagKey":"missing-flag","userId":"demo-user-01","enabled":false,"reason":"FLAG_NOT_FOUND","bucket":null,"rolloutPercentage":null}

$ curl -sS -X POST -H 'content-type: application/json' \
    -d '{"flagKey":"DEMO","userId":""}' \
    http://127.0.0.1:3100/api/evaluate
{"error":{"code":"VALIDATION_ERROR","message":"body/flagKey must match pattern \"^[a-z0-9][a-z0-9._-]{0,63}$\""}}
status=400

$ curl -sS http://127.0.0.1:3100/api/flags
{"error":{"code":"UNAUTHORIZED","message":"Missing or invalid bearer token"}}
status=401
```

Example admin call:

```text
$ curl -sS -H 'Authorization: Bearer dev-token-change-me' \
    http://127.0.0.1:3100/api/flags/demo-checkout
{"id":1,"key":"demo-checkout","description":"Demo: 20 → 40 rollout karşılaştırması","enabled":true,"rolloutPercentage":40,"createdAt":"2026-10-20T14:17:56.611Z","updatedAt":"2026-10-20T14:24:29.353Z"}
```

## 5. Restart / persistence

The restart step in `npm run smoke`; flag settings and the same user's result
are preserved:

```text
== 6. Restart and re-evaluate ==
$ docker compose -p switchboard-smoke restart
 Container switchboard-smoke-switchboard-1 Restarting
 Container switchboard-smoke-switchboard-1 Started
health: {"status":"ok"}
flag after restart: {"id":1,"key":"smoke-flag","description":"Docker smoke test","enabled":true,"rolloutPercentage":20,"createdAt":"2026-10-20T14:21:29.914Z","updatedAt":"2026-10-20T14:21:29.914Z"}
OK: restart.enabled = true
OK: restart.rolloutPercentage = 20
evaluate after restart: {"flagKey":"smoke-flag","userId":"user-123","enabled":false,"reason":"BUCKET_EXCLUDED","bucket":76,"rolloutPercentage":20}
OK: restart.bucket = 76
OK: restart.enabled = false
OK: restart.reason = BUCKET_EXCLUDED
```

Same result after `down` (volume kept) + `up -d`:

```text
$ docker compose -p switchboard-smoke down
 Container switchboard-smoke-switchboard-1 Stopping
 Container switchboard-smoke-switchboard-1 Stopped
 Container switchboard-smoke-switchboard-1 Removing
 Container switchboard-smoke-switchboard-1 Removed
 Network switchboard-smoke_default Removing
 Network switchboard-smoke_default Removed
$ docker compose -p switchboard-smoke up -d
 Network switchboard-smoke_default Creating
 Network switchboard-smoke_default Created
 Container switchboard-smoke-switchboard-1 Creating
 Container switchboard-smoke-switchboard-1 Created
 Container switchboard-smoke-switchboard-1 Starting
 Container switchboard-smoke-switchboard-1 Started
health: {"status":"ok"}
flag after down/up: {"id":1,"key":"smoke-flag","description":"Docker smoke test","enabled":true,"rolloutPercentage":20,"createdAt":"2026-10-20T14:21:29.914Z","updatedAt":"2026-10-20T14:21:29.914Z"}
OK: down-up.enabled = true
OK: down-up.rolloutPercentage = 20
evaluate after down/up: {"flagKey":"smoke-flag","userId":"user-123","enabled":false,"reason":"BUCKET_EXCLUDED","bucket":76,"rolloutPercentage":20}
OK: down-up.bucket = 76
OK: down-up.enabled = false
OK: down-up.reason = BUCKET_EXCLUDED
```

## 6. Docker smoke test

`npm run smoke` (clean `down -v`, build, health, flag, restart, down/up, and
`down -v` again). Build layer logs were shortened; application output is
verbatim:

```text
> switchboard@0.1.0 smoke
> bash scripts/smoke-docker.sh

Switchboard Docker smoke test
Project: switchboard-smoke
Base URL: http://127.0.0.1:3101
Token: smoke-only (smoke-token)

== 1. Clean start ==
$ docker compose -p switchboard-smoke down -v
time="2026-10-20T16:21:25+02:00" level=warning msg="Warning: No resource found to remove for project \"switchboard-smoke\"."

== 2. Build and start ==
$ docker compose -p switchboard-smoke up -d --build
 Image switchboard-smoke-switchboard Building
 Image switchboard-smoke-switchboard Built
 Network switchboard-smoke_default Creating
 Volume switchboard-smoke_switchboard-data Creating
 Volume switchboard-smoke_switchboard-data Created
 Network switchboard-smoke_default Created
 Container switchboard-smoke-switchboard-1 Creating
 Container switchboard-smoke-switchboard-1 Created
 Container switchboard-smoke-switchboard-1 Starting
 Container switchboard-smoke-switchboard-1 Started

== 3. Wait for health ==
health: {"status":"ok"}

== 4. Create flag ==
create: {"id":1,"key":"smoke-flag","description":"Docker smoke test","enabled":true,"rolloutPercentage":20,"createdAt":"2026-10-20T14:21:29.914Z","updatedAt":"2026-10-20T14:21:29.914Z"}
OK: create.key = smoke-flag
OK: create.enabled = true
OK: create.rolloutPercentage = 20

== 5. Evaluate user-123 ==
evaluate: {"flagKey":"smoke-flag","userId":"user-123","enabled":false,"reason":"BUCKET_EXCLUDED","bucket":76,"rolloutPercentage":20}
bucket=76 enabled=false reason=BUCKET_EXCLUDED

== 6. Restart and re-evaluate ==
$ docker compose -p switchboard-smoke restart
 Container switchboard-smoke-switchboard-1 Restarting
 Container switchboard-smoke-switchboard-1 Started
health: {"status":"ok"}
flag after restart: {"id":1,"key":"smoke-flag","description":"Docker smoke test","enabled":true,"rolloutPercentage":20,"createdAt":"2026-10-20T14:21:29.914Z","updatedAt":"2026-10-20T14:21:29.914Z"}
OK: restart.enabled = true
OK: restart.rolloutPercentage = 20
evaluate after restart: {"flagKey":"smoke-flag","userId":"user-123","enabled":false,"reason":"BUCKET_EXCLUDED","bucket":76,"rolloutPercentage":20}
OK: restart.bucket = 76
OK: restart.enabled = false
OK: restart.reason = BUCKET_EXCLUDED

== 7. down (volume kept) + up and re-evaluate ==
$ docker compose -p switchboard-smoke down
 Container switchboard-smoke-switchboard-1 Stopping
 Container switchboard-smoke-switchboard-1 Stopped
 Container switchboard-smoke-switchboard-1 Removing
 Container switchboard-smoke-switchboard-1 Removed
 Network switchboard-smoke_default Removing
 Network switchboard-smoke_default Removed
$ docker compose -p switchboard-smoke up -d
 Network switchboard-smoke_default Creating
 Network switchboard-smoke_default Created
 Container switchboard-smoke-switchboard-1 Creating
 Container switchboard-smoke-switchboard-1 Created
 Container switchboard-smoke-switchboard-1 Starting
 Container switchboard-smoke-switchboard-1 Started
health: {"status":"ok"}
flag after down/up: {"id":1,"key":"smoke-flag","description":"Docker smoke test","enabled":true,"rolloutPercentage":20,"createdAt":"2026-10-20T14:21:29.914Z","updatedAt":"2026-10-20T14:21:29.914Z"}
OK: down-up.enabled = true
OK: down-up.rolloutPercentage = 20
evaluate after down/up: {"flagKey":"smoke-flag","userId":"user-123","enabled":false,"reason":"BUCKET_EXCLUDED","bucket":76,"rolloutPercentage":20}
OK: down-up.bucket = 76
OK: down-up.enabled = false
OK: down-up.reason = BUCKET_EXCLUDED

Smoke test passed: flag and evaluation survived restart and down/up.

== 8. Clean up (down -v via EXIT trap) ==

$ docker compose -p switchboard-smoke down -v
 Container switchboard-smoke-switchboard-1 Stopping
 Container switchboard-smoke-switchboard-1 Stopped
 Container switchboard-smoke-switchboard-1 Removing
 Container switchboard-smoke-switchboard-1 Removed
 Network switchboard-smoke_default Removing
 Volume switchboard-smoke_switchboard-data Removing
 Volume switchboard-smoke_switchboard-data Removed
 Network switchboard-smoke_default Removed
```

Healthcheck and non-root user:

```text
$ docker compose -p switchboard-smoke ps
NAME                              IMAGE                           COMMAND                  SERVICE       CREATED         STATUS                   PORTS
switchboard-smoke-switchboard-1   switchboard-smoke-switchboard   "docker-entrypoint.s…"   switchboard   6 seconds ago   Up 6 seconds (healthy)   0.0.0.0:3101->3000/tcp, [::]:3101->3000/tcp
$ docker compose -p switchboard-smoke exec switchboard id
uid=1000(node) gid=1000(node) groups=1000(node)
$ docker image inspect switchboard-smoke-switchboard --format '{{.Config.User}}'
node
```

Compose fails clearly without `ADMIN_TOKEN` (there is no hidden default token):

```text
$ env -u ADMIN_TOKEN docker compose --env-file /dev/null config
error while interpolating services.switchboard.environment.ADMIN_TOKEN: required variable ADMIN_TOKEN is missing a value: ADMIN_TOKEN is required. Set it in .env or the environment.
exit=1
```

After `down -v` no volume remained, and the fresh start opened an empty
database:

```text
$ docker volume ls --filter name=switchboard-smoke
DRIVER    VOLUME NAME
$ curl -s -H 'Authorization: Bearer smoke-token' http://127.0.0.1:3101/api/flags
{"flags":[]}
```

## 7. Demo video

- File: [`demo/switchboard-demo.mp4`](../demo/switchboard-demo.mp4)
- Duration: 62.68 seconds
- Format: 1280×720, H.264, silent
- Recording command: `npm run record:demo`
- Flow shown:
  1. Service health and connecting with the admin token.
  2. Creating the `demo-checkout` flag with a `%20` rollout.
  3. Same bucket/result for `demo-user-01`.
  4. Excluded result at `%20` for `demo-user-14`.
  5. `%20 → %40` comparison: 4/12 included → 8/12 included, 4 preserved,
     4 newly opened.
  6. After the server process restarts, `bucket 4 → 4` and status
     `Open → Open` (Turkish UI: `Açık → Açık`) for the same user.
  7. `npm test`: 58/58 pass.

## 8. Git evidence

```text
$ git log --oneline -12
382213c docs: align demo video and evidence with 1.0.0
4da3d94 chore: release 1.0.0
fce9100 fix: return 503 when evaluation storage is unavailable
75aa3f5 docs: add independent final review brief
2489e8e docs: finalize delivery documentation
3e4e1c8 feat: add reproducible demo video recording
307a4bc fix: keep flag list status in sync after creation
f8208f5 chore: add Docker setup and smoke test
1b17235 docs: add Docker task brief
34104db fix: show preserved and newly opened users in demo
9819367 feat: add demo UI and example client
a38cdec docs: add demo and client task brief

$ git remote -v
origin  https://github.com/kemselcuk/switchboard.git (fetch)
origin  https://github.com/kemselcuk/switchboard.git (push)

$ git tag -l
v1.0.0

$ git status --short
(boş)
```

Release tag: `v1.0.0` (code release). English documentation is on `main` after the release commit.
