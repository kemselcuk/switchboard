# Switchboard — Uygulama Planı

Bu belge, onaylanan yaklaşımın ayrıntılı uygulama planıdır. Kodlama, bu planın
onaylanmasından sonra küçük görevler halinde ilerler.

## 1. Ürün kapsamı

Switchboard küçük bir feature flag servisidir:

- Boolean flag oluşturma ve güncelleme.
- Flag'i tamamen açma/kapatma veya kullanıcıların belirli bir yüzdesine açma.
- `flagKey` + `userId` ile deterministik değerlendirme.
- Aynı ayarlarda aynı kullanıcı için her zaman aynı sonuç.
- SQLite ile yeniden başlatma sonrası kalıcılık.

Kapsam dışı: özel kural dili, segmentler, A/B analizi, kullanıcı hesapları,
RBAC, audit log, çoklu ortam, SDK'lar, rate limiting, cache, multi-instance,
Postgres, cloud deploy, flag ile yetkilendirme, flag silme/rename.

## 2. Onaylanan kararlar

| Konu | Karar |
|---|---|
| Değerlendirme sözleşmesi | `200` + `flagKey, userId, enabled, reason, bucket, rolloutPercentage`; geçersiz girdi `400`; bilinmeyen flag `200` + `FLAG_NOT_FOUND` |
| Hata/kesinti | DB hatası `503` + `EVALUATION_UNAVAILABLE`; sessiz fail-open yok |
| Yönetim | `ADMIN_TOKEN` + `Authorization: Bearer`; evaluate/health public |
| Demo | 1–2 dk sessiz video + ekran üstü kısa açıklamalar + README kanıtları |
| Öğrenme | Her kilometre taşında 5–10 dk Türkçe karar/trade-off anlatımı |
| Doküman | README + `docs/PLAN.md`, `DECISIONS.md`, `EVIDENCE.md` + kısa görev brief'leri |
| Subagent | 3 rol, aynı anda en fazla 2; implementer + taze bağlamlı verifier + docs/demo |
| Model | DeepSeek V4.1 Flash `max`; coding ve testler bu modelde |
| Bütçe | Mevcut Go aboneliği, ek model bütçesi €0; ek altyapı €0 |
| Git | Her yeşil ve anlamlı görevde commit + push |

## 3. Mimari

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

**Veri modeli — `flags`:**

| Alan | Tip / kural |
|---|---|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `key` | TEXT NOT NULL UNIQUE, immutable, `^[a-z0-9][a-z0-9._-]{0,63}$` |
| `description` | TEXT NOT NULL DEFAULT '', max 280 |
| `enabled` | INTEGER NOT NULL DEFAULT 0, CHECK 0/1 |
| `rollout_percentage` | INTEGER NOT NULL DEFAULT 0, CHECK 0–100 |
| `created_at`, `updated_at` | TEXT NOT NULL, ISO 8601 |

SQLite ayarları: `journal_mode = WAL`, `foreign_keys = ON`,
`busy_timeout = 5000`, `user_version = 1`.

## 4. API sözleşmesi

### Yönetim uçları

| Method | Path | Auth | Başarı |
|---|---|---|---|
| `POST` | `/api/flags` | Bearer | `201` flag |
| `GET` | `/api/flags` | Bearer | `200 { flags: [...] }` |
| `GET` | `/api/flags/:key` | Bearer | `200` flag, yoksa `404` |
| `PATCH` | `/api/flags/:key` | Bearer | `200` güncel flag |

`POST /api/flags` gövdesi:

```json
{
  "key": "new-checkout",
  "description": "Yeni ödeme akışı",
  "enabled": true,
  "rolloutPercentage": 20
}
```

`PATCH /api/flags/:key` gövdesi (en az bir alan):

```json
{ "enabled": true, "rolloutPercentage": 40 }
```

### Değerlendirme

`POST /api/evaluate` (public):

```json
{ "flagKey": "new-checkout", "userId": "user-123" }
```

Bilinen flag:

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

Bilinmeyen flag:

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

Reason değerleri: `FLAG_DISABLED`, `FLAG_NOT_FOUND`, `BUCKET_INCLUDED`,
`BUCKET_EXCLUDED`.

### Hata zarfı

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

Kodlar: `UNAUTHORIZED`, `VALIDATION_ERROR`, `FLAG_EXISTS`, `FLAG_NOT_FOUND`,
`EVALUATION_UNAVAILABLE`, `NOT_FOUND`, `INTERNAL_ERROR`.

## 5. Deterministik algoritma

```text
u32    = SHA-256(flagKey + ":" + userId) ilk 4 byte, big-endian
bucket = floor((u32 / 2^32) * 100)        // 0–99
açık   = enabled && bucket < rolloutPercentage
```

- `flagKey` immutable; rename yok.
- Yüzde değişince yeniden hash yok. `%20 → %40` geçişinde eski açık küme
  korunur.
- `userId` opak ve case-sensitive; normalize edilmez. İstemci stabil ID
  göndermekle yükümlü.
- `BUCKET_ALGORITHM_VERSION = 1` kodda sabittir. Algoritma değişirse gruplar
  yeniden dağılır; README'de uyarı bulunur.
- Küçük örneklemde tam yüzde beklenmez; testler küme içermesi ve determinizm
  üzerinden yazılır.

## 6. Aşamalar ve görevler

> Her görevde kabul: testler yeşil + diff review + commit + push. WIP commit'ler
> yalnızca kısa ömürlü görev dalında kalır; `main` kırık push edilmez.

### Faz 0 — Plan, repo ve iskelet

| ID | Görev | Kabul ölçütü |
|---|---|---|
| 0.1 | Dokümanlar ve `AGENTS.md` | Onaylanan kararlarla tutarlı; komutlar, kapsam ve push kuralı yazılı |
| 0.2 | Git remote HTTPS + ilk push | `git ls-remote --heads origin` main'i gösterir; repo boş değil |
| 0.3 | Proje iskeleti + `/healthz` | `npm ci`, `npm test`, `npm start` çalışır; secret yok |

### Faz 1 — Veri ve servis çekirdeği

| ID | Görev | Kabul ölçütü |
|---|---|---|
| 1.1 | SQLite şeması | Idempotent; constraint'ler; yeniden açılışta veri durur |
| 1.2 | Repository | CRUD testleri; kalıcılık; route içinde SQL yok |
| 1.3 | `buildApp()` + health + shutdown | Health 200; env doğrulama; SIGTERM'de DB kapanır |

### Faz 2 — Yönetim API'si

| ID | Görev | Kabul ölçütü |
|---|---|---|
| 2.1 | Bearer auth | 401/200; token loglanmaz; public uçlar açık |
| 2.2 | Flag CRUD + doğrulama | 201/200/400/401/404/409; delete yok |
| 2.3 | Ortak hata zarfı | Stack sızmaz; tutarlı kodlar |

### Faz 3 — Deterministik değerlendirme

| ID | Görev | Kabul ölçütü |
|---|---|---|
| 3.1 | Evaluator | Golden vector; determinizm; 0/100; disabled |
| 3.2 | Evaluate route | Sözleşme; unknown 200; DB hatası 503 |
| 3.3 | Monotonluk + dağılım | 1.000 ID alt küme; 10.000 ID ±%2 |
| 3.4 | Restart/persistence | Ayar ve sonuç birebir aynı |

### Faz 4 — Demo ve örnek istemci

| ID | Görev | Kabul ölçütü |
|---|---|---|
| 4.1 | Tek sayfalık demo | Uçtan uca; token HTML'de değil; 20→40 paneli |
| 4.2 | Örnek istemci + demo script | Çoklu kullanıcı; JSON; 503 fallback |

### Faz 5 — Docker, test ve güvenlik

| ID | Görev | Kabul ölçütü |
|---|---|---|
| 5.1 | Dockerfile + compose | Build/health/restart/down-up; volume kalıcı |
| 5.2 | Tam test seti | `npm test` tekrarlı yeşil; smoke yeşil |
| 5.3 | Güvenlik/hijyen | Secret yok; audit; body limiti; timing-safe |

### Faz 6 — Doküman, video ve final

| ID | Görev | Kabul ölçütü |
|---|---|---|
| 6.1 | README + DECISIONS + EVIDENCE final | Temiz checkout; linkler; gerçek çıktılar |
| 6.2 | Video + kanıt | 20→40 alt küme, restart, aynı sonuç, testler |
| 6.3 | Bağımsız review + tag | Tüm kabul ölçütleri; `v1.0.0` |

## 7. Test kabul ölçütleri

- Determinizm: aynı girdi → aynı `bucket` ve `enabled`.
- Monotonluk: `%20` açık kümesi, `%40` açık kümesinin alt kümesi.
- Dağılım: 10.000 sabit ID'de %20/%40 için ±%2 tolerans.
- Sınırlar: rollout `0` → kimse; `100` → herkes; `enabled:false` → herkes kapalı.
- Sözleşme: unknown `200` + `FLAG_NOT_FOUND`; invalid `400`; DB hatası `503`.
- Auth: admin token yok/yanlış → `401`; evaluate public.
- Persistence: close/reopen sonrası ayar ve sonuç aynı.
- Docker: build, health, restart, down/up, volume.

## 8. Demo kabul ölçütleri

- UI'da flag oluştur, aç/kapat, rollout `20 → 40`.
- Aynı kullanıcı için tekrar değerlendirme ve sayfa yenileme → aynı sonuç.
- `docker compose restart` sonrası aynı ayar ve sonuç.
- Bilinmeyen flag ve token'sız admin isteği örnekleri.
- `npm test` çıktısı ve 1–2 dk sessiz video.

## 9. Git/push düzeni

- `origin` HTTPS'e çevrilecek; `gh` credential helper kullanılacak.
- Trunk-based `main`; sıralı işlerde küçük commit, paralel işlerde kısa ömürlü
  `task/<id>` dalı.
- Subagent commit eder; diff + test kontrolünü orchestrator yapar ve push atar.
- Definition of Done: kabul + test yeşil + doküman/kanıt + commit + push.
- `main`'e force-push yok; secret commit yok; kırık testle push yok.
- Finalde `v1.0.0` tag'i push edilir.

## 10. Maliyet

| Kalem | Maliyet | Not |
|---|---|---|
| Altyapı | €0 | Local Docker, SQLite, GitHub public repo, yerel video |
| Model | €0 ek | Mevcut OpenCode Go; DeepSeek V4.1 Flash max |
| Tahmini marjinal token | ~$1–5 | Go limiti içinde; review/retry payı dahil |
| Video/CI | €0 | Yerel kayıt; CI opsiyonel |
| **Toplam ek nakit** | **€0** | Go aboneliği hariç |

Bütçe koruması: Go limitinin %10'una yaklaşma veya tahmini $5 üstü durumda
durup kullanıcıya sorulur.

## 11. Varsayımlar

- GitHub reposu public kalır.
- Video yerel dosya + README linki; YouTube upload'u ayrıca istenirse yapılır.
- CI zorunlu değil; kapsamı büyütmemek için opsiyonel.
- `better-sqlite3` varsayılan; Docker'da sorun çıkarsa `node:sqlite`
  alternatifine geçilir ve karar `DECISIONS.md`'ye yazılır.
- Push akışı trunk-based `main`; PR zorunlu değil.
