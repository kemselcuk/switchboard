# Demo ve Test Kanıtları

Bu dosya yalnızca gerçekten çalıştırılmış komutların çıktılarını ve demo
kanıtlarını içerir. Henüz doldurulmamış bölümler `TODO` olarak kalır.

## Ortam

- Tarih: 2026-10-20
- Makine: macOS (arm64), Node.js 22.23.2, Docker 29.8.1, SQLite 3.51.0
- Commit: TODO
- GitHub: https://github.com/kemselcuk/switchboard

## 1. Otomatik testler

İlk depolama çekirdeği testleri (commit `586dfad`):

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

Yönetim API'si, auth ve hata zarfı testleri (Görev 020):

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

Deterministik değerlendirme testleri (Görev 030, iki ardışık `npm test`):

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

İki ardışık `npm test` çalıştırması da aynı sonucu verdi (52/52).

Geçici DB ile sunucu uçtan uca kontrolü (`PORT=4317`, yerel test token'ı):

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

`ADMIN_TOKEN` olmadan sunucu başlatma kontrolü:

```text
exit=1
ADMIN_TOKEN is required. Copy .env.example to .env and set a token.
```

## 2. Demo UI, örnek istemci ve demo script (Görev 040)

Statik dosyalar geçici bir veritabanıyla çalışan yerel sunucudan (`PORT=3100`)
istendi:

```text
HTTP/1.1 200 OK
content-type: text/html; charset=utf-8
app.js:200 application/javascript; charset=utf-8
styles.css:200 text/css; charset=utf-8
api-unknown:404 application/json; charset=utf-8
{"error":{"code":"NOT_FOUND","message":"Route not found"}}
```

`GET /` yanıtında admin token veya varsayılan token değeri yoktur; token
yalnızca tarayıcıda `sessionStorage` içinde tutulur. Sunucu loglarında da token
değeri görünmedi (`grep -c 'dev-token-change-me'` → `0`).

Görev 040 sonrası `npm test`:

```text
✔ GET / serves the single-page demo
✔ GET /app.js serves the demo script without innerHTML user data
✔ GET /styles.css serves the demo stylesheet
✔ unknown API routes keep the JSON NOT_FOUND envelope
✔ unknown static paths fall back to the JSON NOT_FOUND envelope

ℹ tests 57
ℹ pass 57
ℹ fail 0
```

`npm run demo` (yerel sunucu `http://127.0.0.1:3100`, geçici DB):

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

Aynı script ikinci kez çalıştırıldığında mevcut `demo-checkout` flag'ini
`PATCH /api/flags/demo-checkout` ile güncelledi ve aynı sonucu üretti.

`demo-checkout` flag'i (`enabled=true`, `rolloutPercentage=40`) ile örnek
istemci:

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

`--help` çıktısı ve çıkış kodu:

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

503 döndüren yerel bir mock sunucuya karşı fallback davranışı:

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

Ulaşılamayan sunucu için çıkış kodu `1`:

```text
$ node examples/client.mjs --url http://127.0.0.1:4399 --flag demo-checkout \
    --users demo-user-01

Hata: http://127.0.0.1:4399 adresine ulaşılamadı: fetch failed
exit=1
```

Not: 12 demo kullanıcısı, `demo-checkout` için 4/4/4 dağılımı verecek şekilde
seçildi: %20'de 4 açık, %40'ta 8 açık (4'ü korundu, 4'ü yeni açıldı), 4'ü
kapalı. Bucket'lar 4, 48, 70, 67, 93, 17, 37, 28, 15, 21, 3 ve 35'tir.
Küçük örneklemde tam yüzde beklenmez; bu set deterministik bir kanıt için
kullanılır.

## 3. Determinizm ve monotonluk

```bash
# TODO: aynı kullanıcı, %20 ve %40 karşılaştırması
```

## 4. API sözleşmesi

```bash
# TODO: curl örnekleri ve gerçek yanıtlar
```

## 5. Yeniden başlatma / kalıcılık

`npm run smoke` içindeki restart adımı; flag ayarı ve aynı kullanıcı sonucu
korunuyor:

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

`down` (volume korunur) + `up -d` sonrası aynı sonuç:

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

## 6. Docker smoke testi

`npm run smoke` (temiz `down -v`, build, health, flag, restart, down/up ve
tekrar `down -v`). Build katman logları kısaltıldı; uygulama çıktısı birebir:

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

Healthcheck ve non-root kullanıcı:

```text
$ docker compose -p switchboard-smoke ps
NAME                              IMAGE                           COMMAND                  SERVICE       CREATED         STATUS                   PORTS
switchboard-smoke-switchboard-1   switchboard-smoke-switchboard   "docker-entrypoint.s…"   switchboard   6 seconds ago   Up 6 seconds (healthy)   0.0.0.0:3101->3000/tcp, [::]:3101->3000/tcp
$ docker compose -p switchboard-smoke exec switchboard id
uid=1000(node) gid=1000(node) groups=1000(node)
$ docker image inspect switchboard-smoke-switchboard --format '{{.Config.User}}'
node
```

`ADMIN_TOKEN` verilmeden compose net hata veriyor (gizli varsayılan token yok):

```text
$ env -u ADMIN_TOKEN docker compose --env-file /dev/null config
error while interpolating services.switchboard.environment.ADMIN_TOKEN: required variable ADMIN_TOKEN is missing a value: ADMIN_TOKEN is required. Set it in .env or the environment.
exit=1
```

`down -v` sonrası volume kalmadı ve yeni başlangıç boş veritabanıyla açıldı:

```text
$ docker volume ls --filter name=switchboard-smoke
DRIVER    VOLUME NAME
$ curl -s -H 'Authorization: Bearer smoke-token' http://127.0.0.1:3101/api/flags
{"flags":[]}
```

## 7. Demo video

- Dosya/link: TODO
- Süre: TODO
- Gösterilen akış: TODO

## 8. Git kanıtı

```bash
# TODO: git log --oneline, tag, remote
```
