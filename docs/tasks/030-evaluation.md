# Görev 030 — Deterministik değerlendirme

## Hedef

SHA-256 tabanlı bucket algoritmasını, `POST /api/evaluate` ucunu ve determinizm /
monotonluk / kalıcılık testlerini ekle. Demo UI ve Docker kapsam dışında.

## Mevcut durum

- `buildApp({ dbPath, logger, repository, adminToken })` var.
- `src/flags/routes.js` yönetim route'ları; auth plugin'e bağlı.
- `src/errors.js` içinde `SQLITE_` hatalarını `503 EVALUATION_UNAVAILABLE`'a
  çeviren `normalizeError` var.
- Repository: `getFlag(key)` bulunamazsa `null` döner.

## Dosyalar

- `src/flags/evaluator.js` (yeni)
- `src/flags/evaluate-routes.js` (yeni)
- `src/flags/schemas.js` (güncelle: `evaluateBody`)
- `src/app.js` (güncelle: evaluate route'larını auth plugin'in dışında kaydet)
- `test/evaluator.test.js` (yeni)
- `test/evaluate.api.test.js` (yeni)
- `test/persistence.test.js` (yeni)
- `docs/EVIDENCE.md` (gerçek test çıktısı)

## Algoritma

```text
u32    = SHA-256(flagKey + ":" + userId) ilk 4 byte, big-endian
bucket = floor((u32 / 2^32) * 100)        // 0–99
açık   = enabled && bucket < rolloutPercentage
```

- `BUCKET_ALGORITHM_VERSION = 1` export edilsin.
- `bucketFor(flagKey, userId)` saf fonksiyon.
- `evaluateFlag(flag, userId)` saf fonksiyon; dönüş:
  `{ bucket, enabled, reason }`.
- `!flag.enabled` → `enabled:false`, `reason:"FLAG_DISABLED"`.
- `enabled && bucket < rolloutPercentage` → `BUCKET_INCLUDED`.
- `enabled && bucket >= rolloutPercentage` → `BUCKET_EXCLUDED`.
- Bucket, flag kapalıyken de hesaplanır ve döner.

## API

`POST /api/evaluate` public; auth yok.

Gövde:

```json
{ "flagKey": "new-checkout", "userId": "user-123" }
```

- `flagKey`: `^[a-z0-9][a-z0-9._-]{0,63}$`
- `userId`: string, 1–128, en az bir non-whitespace karakter; normalize
  edilmez, case-sensitive.
- Bilinmeyen ama geçerli flag:
  `200 { flagKey, userId, enabled:false, reason:"FLAG_NOT_FOUND", bucket:null, rolloutPercentage:null }`.
- Bilinen flag:
  `200 { flagKey, userId, enabled, reason, bucket, rolloutPercentage }`.
- Geçersiz gövde: `400 VALIDATION_ERROR`.
- DB hatası (`SQLITE_` kodu): `503 EVALUATION_UNAVAILABLE`; stack/DB yolu
  sızdırılmaz.
- Reason değerleri: `FLAG_DISABLED`, `FLAG_NOT_FOUND`, `BUCKET_INCLUDED`,
  `BUCKET_EXCLUDED`.

## Testler

### `test/evaluator.test.js`

- En az 5 golden vector: `(flagKey, userId) → bucket`.
- Aynı girdi 100 kez aynı bucket/enabled.
- Bucket daima 0–99.
- Rollout 0 → `BUCKET_EXCLUDED`; 100 → `BUCKET_INCLUDED`.
- `enabled:false` → `FLAG_DISABLED` (rollout ne olursa olsun).
- Farklı flagKey'lerin aynı kullanıcıyı farklı bucket'a atabildiğini gösteren
  en az bir örnek (tesadüfe bağlı değil; hesaplanmış değerlerle).

### `test/evaluate.api.test.js`

- Bilinen flag için tam response şekli ve alan tipleri.
- İçerilen ve dışlanan kullanıcı örnekleri (bucket'a göre seçilmiş).
- Disabled flag → `FLAG_DISABLED`.
- Bilinmeyen flag → `200` + `FLAG_NOT_FOUND`, bucket/rollout `null`.
- Geçersiz body: eksik alan, yanlış tip, geçersiz flagKey, whitespace userId.
- Auth gerekmez; token'sız çağrı 200 döner.
- Repository `SQLITE_IOERR` fırlatınca `503`, mesajda iç detay yok.
- Response'da fazladan alan yok.

### `test/persistence.test.js`

- Geçici dosya DB'si; `buildApp({ dbPath, adminToken })`.
- Flag oluştur, sabit kullanıcıyı değerlendir.
- `app.close()`; aynı `dbPath` ile yeniden `buildApp`.
- Flag ayarları ve aynı kullanıcının değerlendirme sonucu birebir aynı.

### Monotonluk / dağılım

`evaluator.test.js` içinde:

- 1.000 sabit ID (`user-0000` … `user-0999`) için `%20` açık kümesi `%40`
  açık kümesinin alt kümesi.
- 10.000 sabit ID için `%20` ve `%40` oranları ±%2 tolerans içinde.
- Testler sabit ID listesi kullandığı için deterministik olmalı; rastgelelik yok.

## Kabul ölçütleri

- `npm test` yeşil; toplam test sayısı ve pass/fail raporlanır.
- `POST /api/evaluate` auth'suz çalışır; admin route'lar korunmaya devam eder.
- `npm test` en az 2 kez üst üste yeşil (flaky değil).
- `git diff` odaklı; commit at, push atma.
- Commit mesajı: `feat: add deterministic flag evaluation API`.

## Kapsam dışı

Demo UI, örnek istemci, Docker, yeni admin endpoint'i, cache, rate limiting,
özel kural dili, flag rename/delete.
