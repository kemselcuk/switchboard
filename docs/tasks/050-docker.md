# Görev 050 — Docker, volume ve smoke testi

## Hedef

Servisi tek komutla Docker'da çalıştır; SQLite volume'u ile restart ve
down/up sonrası kalıcılığı doğrula. Uygulama kodunda davranış değişikliği yapma
(zorunlu değilse).

## Dosyalar

- `Dockerfile` (yeni)
- `compose.yaml` (yeni)
- `.dockerignore` (yeni)
- `scripts/smoke-docker.sh` (yeni)
- `package.json` (`smoke` script'i zaten var; gerekirse düzelt)
- `README.md` (Docker hızlı başlatma bölümü)
- `docs/EVIDENCE.md` (gerçek Docker çıktıları)

## Docker gereksinimleri

- `node:22-bookworm-slim` tabanlı multi-stage build.
- `npm ci --omit=dev`; üretim bağımlılıkları.
- `better-sqlite3` native modülü build sırasında sorun çıkarırsa gerekli
  build araçlarını yalnızca deps aşamasında kullan; runtime image'ı şişirme.
- Non-root `node` kullanıcısı.
- `/app/data` dizini oluştur ve `node` kullanıcısına ver.
- `EXPOSE 3000`; `CMD ["node", "src/server.js"]`.
- `.dockerignore`: `node_modules`, `data`, `.git`, `.env`, loglar, test/demo
  dışı gereksiz dosyalar.

## Compose gereksinimleri

- `switchboard` servisi; `build: .`.
- Port: `${PORT:-3000}:3000`.
- Env: `ADMIN_TOKEN` zorunlu; `DB_PATH=/app/data/switchboard.db`;
  `HOST=0.0.0.0`; `LOG_LEVEL`.
- Named volume: `switchboard-data:/app/data`.
- Healthcheck: `/healthz` için Node fetch; interval 5s, retries 10.
- `init: true`.
- `ADMIN_TOKEN` yoksa compose net hata vermeli; gizli varsayılan token
  kullanılmamalı.

## Smoke test — `scripts/smoke-docker.sh`

`set -euo pipefail`; proje adı `switchboard-smoke`; port `3101`; token
`smoke-token` (yalnızca smoke).

Akış:

1. `docker compose -p switchboard-smoke down -v` ile temiz başlangıç.
2. `docker compose -p switchboard-smoke up -d --build`.
3. `/healthz` için en fazla 30 sn bekle.
4. `smoke-flag` oluştur (`enabled=true`, `rolloutPercentage=20`).
5. Sabit `user-123` için değerlendir; sonucu kaydet.
6. `docker compose restart`; health bekle; aynı kullanıcıyı tekrar değerlendir;
   `bucket` ve `enabled` aynı olmalı.
7. `down` (volume'u silmeden) + `up -d`; health bekle; flag ve sonuç hâlâ aynı
   olmalı.
8. `down -v` ile temizle (trap ile hata durumunda da temizle).
9. Her adımı gerçek çıktıyla yazdır.

JSON ayrıştırma için `node -e` kullan; `jq` varsayma.

## README

- Docker hızlı başlatma:
  ```bash
  cp .env.example .env
  docker compose up --build
  ```
- `docker compose down` verinin silinmediğini; `down -v` sildiğini açıkla.

## Kabul ölçütleri

- `docker compose up --build` başarılı; healthcheck healthy.
- `npm run smoke` başarılı ve gerçek çıktı `EVIDENCE.md`'de.
- Restart ve down/up sonrası flag ayarı ve aynı kullanıcı sonucu korunuyor.
- `docker compose down -v` sonrası temiz başlangıç.
- Image non-root çalışıyor (`docker compose exec switchboard id`).
- `npm test` hâlâ yeşil.
- Commit at, push atma. Commit mesajı: `chore: add Docker setup and smoke test`.

## Kapsam dışı

CI, cloud deploy, Postgres, multi-instance, auth değişikliği, yeni API.
