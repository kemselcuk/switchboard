# Demo ve Test Kanıtları

Bu dosya yalnızca gerçekten çalıştırılmış komutların çıktılarını ve demo
kanıtlarını içerir. Henüz doldurulmamış bölümler `TODO` olarak kalır.

## Ortam

- Tarih: TODO
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

## 2. Determinizm ve monotonluk

```bash
# TODO: aynı kullanıcı, %20 ve %40 karşılaştırması
```

## 3. API sözleşmesi

```bash
# TODO: curl örnekleri ve gerçek yanıtlar
```

## 4. Yeniden başlatma / kalıcılık

```bash
# TODO: docker compose restart sonrası aynı sonuç
```

## 5. Docker smoke testi

```bash
# TODO: docker compose up/build/health/restart/down çıktıları
```

## 6. Demo video

- Dosya/link: TODO
- Süre: TODO
- Gösterilen akış: TODO

## 7. Git kanıtı

```bash
# TODO: git log --oneline, tag, remote
```
