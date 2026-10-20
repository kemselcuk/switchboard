# Görev 020 — Yönetim API'si, auth ve hata zarfı

## Hedef

Flag CRUD uçlarını, Bearer token korumasını ve tutarlı hata zarfını ekle.
Evaluator, demo ve Docker bu görevin kapsamı dışında.

## Mevcut durum

- `src/db.js` ve `src/flags/repository.js` hazır.
- `buildApp({ dbPath, logger, repository })` mevcut; `/healthz` var.
- Repository hata sınıfları: `FlagExistsError` (`FLAG_EXISTS`),
  `FlagNotFoundError` (`FLAG_NOT_FOUND`).
- `src/server.js` `ADMIN_TOKEN` yokluğunu kontrol ediyor ama henüz
  `buildApp`'e geçirmiyor.

## Dosyalar

- `src/errors.js` (yeni)
- `src/auth.js` (yeni)
- `src/flags/schemas.js` (yeni)
- `src/flags/routes.js` (yeni)
- `src/app.js` (güncelle)
- `src/server.js` (güncelle)
- `test/auth.api.test.js` (yeni)
- `test/flags.api.test.js` (yeni)
- `test/health.test.js` (gerekirse güncelle)

## API

### `POST /api/flags` (admin)

Gövde:

```json
{
  "key": "new-checkout",
  "description": "Yeni ödeme akışı",
  "enabled": true,
  "rolloutPercentage": 20
}
```

- `key` zorunlu; `^[a-z0-9][a-z0-9._-]{0,63}$`.
- `description` opsiyonel, max 280, varsayılan `''`.
- `enabled` opsiyonel boolean, varsayılan `false`.
- `rolloutPercentage` opsiyonel integer 0–100, varsayılan `0`.
- Başarı: `201` + flag.
- Duplicate: `409` + `FLAG_EXISTS`.
- Geçersiz gövde: `400` + `VALIDATION_ERROR`.

### `GET /api/flags` (admin)

- Başarı: `200 { "flags": [...] }`.

### `GET /api/flags/:key` (admin)

- Başarı: `200` + flag.
- Yoksa: `404` + `FLAG_NOT_FOUND`.

### `PATCH /api/flags/:key` (admin)

- Gövde en az bir alan: `description`, `enabled`, `rolloutPercentage`.
- Bilinmeyen alan: `400`.
- Boş gövde: `400`.
- Başarı: `200` + güncel flag.
- Yoksa: `404` + `FLAG_NOT_FOUND`.

`DELETE` ve rename yok.

## Auth

- `ADMIN_TOKEN` ortam değişkeni; `Authorization: Bearer <token>`.
- Karşılaştırma sabit zamanlı olmalı. Token'ları SHA-256 ile hash'leyip
  `timingSafeEqual` kullanmak serbest; uzunluk farkı hata fırlatmamalı.
- Eksik/yanlış token: `401` + `UNAUTHORIZED`; `WWW-Authenticate: Bearer`.
- `/healthz` public kalır; `/api/evaluate` bu görevde yok.
- Token hiçbir log veya hata yanıtında görünmemeli.

## Hata zarfı

Tüm hatalar:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

- Fastify validation → `400` + `VALIDATION_ERROR`.
- Bilinmeyen route → `404` + `NOT_FOUND`.
- Beklenmeyen hata → `500` + `INTERNAL_ERROR`, mesaj
  `"Internal server error"`; stack trace yok.
- `SQLITE_` ile başlayan hatalar → `503` + `EVALUATION_UNAVAILABLE`
  (ileride evaluate için de kullanılacak; admin route'larda da tutarlı).
- `FlagExistsError` → `409`; `FlagNotFoundError` → `404`.

## Kabul ölçütleri

- `npm test` yeşil.
- Auth testleri: token yok/yanlış/doğru; health public.
- CRUD testleri: create/list/get/patch; duplicate; invalid key; invalid
  rollout; boş patch; bilinmeyen alan; unknown key.
- Response şemaları planlanan alanlarla birebir.
- Hata yanıtlarında stack trace/token yok.
- `git diff` odaklı; commit at, push atma.

## Kapsam dışı

Evaluator, `/api/evaluate`, demo UI, Docker, rate limiting, CORS, audit log,
delete/rename, kullanıcı hesapları.
