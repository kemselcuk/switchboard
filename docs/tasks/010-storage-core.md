# Görev 010 — Depolama çekirdeği

## Hedef

SQLite şemasını, flag repository'sini ve test edilebilir `buildApp()` iskeletini
ekle. Henüz HTTP route, auth, evaluator veya demo ekleme.

## Dosyalar

- `src/db.js` (yeni)
- `src/flags/repository.js` (yeni)
- `src/app.js` (güncelle)
- `src/server.js` (güncelle)
- `test/repository.test.js` (yeni)
- `test/health.test.js` (gerekirse güncelle)

## Gereksinimler

### `src/db.js`

- `openDatabase({ dbPath = ':memory:' })` benzeri bir fonksiyon.
- `dbPath` bir dosya yoluysa üst dizini oluştur.
- `PRAGMA journal_mode = WAL` (dosya DB'sinde), `foreign_keys = ON`,
  `busy_timeout = 5000`.
- `flags` tablosu:
  - `id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `key TEXT NOT NULL UNIQUE`
  - `description TEXT NOT NULL DEFAULT ''`
  - `enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1))`
  - `rollout_percentage INTEGER NOT NULL DEFAULT 0 CHECK (rollout_percentage BETWEEN 0 AND 100)`
  - `created_at TEXT NOT NULL`
  - `updated_at TEXT NOT NULL`
- Şema idempotent olmalı (`CREATE TABLE IF NOT EXISTS`).
- `PRAGMA user_version = 1`.
- `close()` veya `db.close()` ile kapanabilmeli.

### `src/flags/repository.js`

- `createFlag({ key, description, enabled, rolloutPercentage })`
- `listFlags()`
- `getFlag(key)`
- `updateFlag(key, patch)` — yalnızca verilen alanları günceller.
- Dönüş nesneleri camelCase: `{ id, key, description, enabled, rolloutPercentage, createdAt, updatedAt }`.
- `enabled` boolean olarak dönmeli.
- Duplicate key ve bulunamayan kayıt için anlamlı hata sınıfları/fırlatmalar
  kullan. Route katmanı bunları HTTP'ye çevirecek; bu görevde route yok.
- SQL yalnızca bu dosyada ve `src/db.js` içinde.

### `src/app.js`

- `buildApp({ dbPath = ':memory:', logger = false, repository } = {})`.
- DB/repository'yi app'e bağla; `app.close()` DB'yi kapatsın.
- `/healthz` mevcut davranışını korusun.
- Test için `repository` enjeksiyonu mümkün olsun (ileride DB hatası testi için).
- Logger'da `authorization` header'ını redact et (auth henüz yok ama altyapı).

### `src/server.js`

- `ADMIN_TOKEN` yoksa net mesajla `process.exit(1)`.
- `PORT`, `HOST`, `DB_PATH`, `LOG_LEVEL` ortam değişkenlerini kullan.
- SIGINT/SIGTERM'de `app.close()` çağır.

## Kabul ölçütleri

- `npm test` yeşil.
- Repository testleri: create/get/list/update, duplicate, not found, boolean
  dönüşümü, temp dosya DB'sinde close/reopen sonrası kayıt korunması.
- `buildApp()` health testi yeşil.
- `git diff` küçük ve odaklı.
- Commit at; push atma.

## Kapsam dışı

HTTP route, auth, evaluator, demo, Docker, doküman değişikliği (gerekmiyorsa).
