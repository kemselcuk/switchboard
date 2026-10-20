<img src="assets/icon.svg" width="64" height="64" alt="">

# Switchboard

Küçük, tek ortamlı bir **feature flag** servisi. Boolean flag'ler, tam
açık/kapalı ve deterministik yüzdelik rollout.

Aynı `flagKey` + `userId` + ayar her zaman aynı sonucu verir. Yüzde
`%20 → %40` yükseltildiğinde önceki açık grup korunur; yeni kullanıcılar
eklenir, eskiler çıkmaz.

> Bu proje bir demo/portföy projesidir. Flag'ler yetkilendirme mekanizması
> değildir; üretim auth'u yerine kullanılmamalıdır.

## Ne yapar?

- Boolean flag oluşturur ve günceller.
- Flag'i tamamen açar/kapatır veya kullanıcıların belirli bir yüzdesine açar.
- `flagKey` + `userId` ile değerlendirme API'si sunar.
- Kullanıcıyı SHA-256 tabanlı sabit bir bucket'a atar.
- SQLite ile ayarları ve sonuçları yeniden başlatma sonrası korur.

## Hızlı başlatma

### Docker (önerilen)

```bash
cp .env.example .env
# .env içindeki ADMIN_TOKEN değerini değiştirin
docker compose up --build
```

Demo: http://localhost:3000

### Yerel Node

Gereksinim: Node.js 22+.

```bash
cp .env.example .env
npm ci
npm start
```

Testler:

```bash
npm test
```

Docker smoke testi (temiz volume, build, health, restart, down/up):

```bash
npm run smoke
```

## Demo

### Tek sayfalık arayüz

`http://localhost:3000` adresindeki demo:

1. Admin token'ı girin ve kaydedin.
2. Bir flag oluşturun (ör. `new-checkout`, `%20`, açık).
3. Aynı kullanıcıyı birkaç kez değerlendirin; sonuç ve bucket değişmez.
4. **20 → 40 karşılaştırması** panelini çalıştırın. 12 sabit kullanıcı için
   önce `%20`, sonra `%40` sonucu gösterilir; korunan ve yeni açılan
   kullanıcılar ayrı işaretlenir.
5. Sayfayı yenileyin ve aynı kullanıcıyı tekrar değerlendirin; sonuç aynıdır.

Demo paneli sonunda flag'i `%40` açık bırakır. Bu, panelin bilinçli demo
davranışıdır.

### Tekrarlanabilir demo script'i

```bash
ADMIN_TOKEN=dev-token-change-me npm run demo
```

Örnek çıktı:

```text
USER          BUCKET  %20     %40     DURUM
------------  ------  ------  ------  -----------
demo-user-01  4       açık    açık    korundu
demo-user-09  17      açık    açık    korundu
demo-user-14  37      kapalı  açık    yeni açıldı
demo-user-17  28      kapalı  açık    yeni açıldı
demo-user-21  21      kapalı  açık    yeni açıldı
demo-user-33  35      kapalı  açık    yeni açıldı

Özet: %20'de 4/12 açık, %40'ta 8/12 açık, 4 korundu, 4 yeni açıldı.
```

Küçük örneklemde tam `%20`/`%40` beklenmez; önemli olan aynı kullanıcının
aynı bucket'ta kalması ve eski açık kümenin korunmasıdır.

### Örnek istemci

```bash
node examples/client.mjs \
  --url http://127.0.0.1:3000 \
  --flag new-checkout \
  --users user-0000,user-0005,user-123
```

Çıktı:

```text
USER       ENABLED  REASON           BUCKET  ROLLOUT
---------  -------  ---------------  ------  -------
user-0000  true     BUCKET_INCLUDED  3       40%
user-0005  true     BUCKET_INCLUDED  30      40%
user-123   false    BUCKET_EXCLUDED  65      40%
```

### Video

Kısa sessiz demo: [`demo/switchboard-demo.mp4`](demo/switchboard-demo.mp4)

Video akışı: flag oluşturma, aynı kullanıcının tekrar değerlendirilmesi,
`%20 → %40` karşılaştırması, süreç yeniden başlatıldıktan sonra aynı sonuç ve
test özeti.

Videoyu yeniden üretmek için sistem Chrome'u kullanan kayıt script'i:

```bash
npx playwright install ffmpeg   # Playwright video codec'i (tek seferlik)
# MP4 dönüşümü için sistem ffmpeg'i de gerekir: brew install ffmpeg
npm run record:demo
```

## API

Yönetim uçları `Authorization: Bearer <ADMIN_TOKEN>` ister. Değerlendirme ve
sağlık uçları public'tir.

| Method | Path | Auth | Açıklama |
|---|---|---|---|
| `POST` | `/api/flags` | Bearer | Flag oluştur |
| `GET` | `/api/flags` | Bearer | Flag'leri listele |
| `GET` | `/api/flags/:key` | Bearer | Tek flag getir |
| `PATCH` | `/api/flags/:key` | Bearer | `enabled`, `rolloutPercentage`, `description` güncelle |
| `POST` | `/api/evaluate` | Public | `flagKey` + `userId` değerlendir |
| `GET` | `/healthz` | Public | Sağlık kontrolü |

### Flag oluşturma

```bash
curl -sS -X POST http://localhost:3000/api/flags \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "key": "new-checkout",
    "description": "Yeni ödeme akışı",
    "enabled": true,
    "rolloutPercentage": 20
  }'
```

```json
{
  "id": 1,
  "key": "new-checkout",
  "description": "Yeni ödeme akışı",
  "enabled": true,
  "rolloutPercentage": 20,
  "createdAt": "2026-10-20T14:17:56.611Z",
  "updatedAt": "2026-10-20T14:17:56.611Z"
}
```

### Flag güncelleme

```bash
curl -sS -X PATCH http://localhost:3000/api/flags/new-checkout \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"enabled": true, "rolloutPercentage": 40}'
```

`key` oluşturulduktan sonra değiştirilemez; rename endpoint'i yoktur.

### Değerlendirme

```bash
curl -sS -X POST http://localhost:3000/api/evaluate \
  -H 'content-type: application/json' \
  -d '{"flagKey": "new-checkout", "userId": "user-0000"}'
```

```json
{
  "flagKey": "new-checkout",
  "userId": "user-0000",
  "enabled": true,
  "reason": "BUCKET_INCLUDED",
  "bucket": 3,
  "rolloutPercentage": 40
}
```

Bilinmeyen flag:

```json
{
  "flagKey": "missing-flag",
  "userId": "user-0000",
  "enabled": false,
  "reason": "FLAG_NOT_FOUND",
  "bucket": null,
  "rolloutPercentage": null
}
```

Reason değerleri:

| Reason | Anlam |
|---|---|
| `FLAG_DISABLED` | Flag kapalı; rollout dikkate alınmaz |
| `FLAG_NOT_FOUND` | Flag yok; `enabled:false` |
| `BUCKET_INCLUDED` | Bucket, rollout eşiğinin altında |
| `BUCKET_EXCLUDED` | Bucket, rollout eşiğinin üstünde/eşit |

### Hatalar

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

Kodlar: `UNAUTHORIZED`, `VALIDATION_ERROR`, `FLAG_EXISTS`,
`FLAG_NOT_FOUND`, `EVALUATION_UNAVAILABLE`, `NOT_FOUND`, `INTERNAL_ERROR`.

- Geçersiz gövde/alan: `400`
- Admin token yok/yanlış: `401`
- Admin flag yok: `404`
- Duplicate flag: `409`
- DB/SQLite hatası: `503 EVALUATION_UNAVAILABLE`

## Entegrasyon

Başka bir uygulamadan değerlendirme:

```js
const BASE_URL = process.env.SWITCHBOARD_URL ?? 'http://localhost:3000';

export async function isEnabled(flagKey, userId) {
  const response = await fetch(`${BASE_URL}/api/evaluate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ flagKey, userId }),
    signal: AbortSignal.timeout(1000),
  });

  if (response.status === 503) {
    // Servis geçici olarak kullanılamıyor: kendi fallback politikanızı seçin.
    return { enabled: false, fallback: true };
  }

  if (!response.ok) {
    throw new Error(`Switchboard HTTP ${response.status}`);
  }

  const result = await response.json();

  // Bilinmeyen flag de 200 + enabled:false döner.
  return { enabled: result.enabled, fallback: false, result };
}
```

Entegrasyon kuralları:

- `userId` opak ve **stabil** olmalı; normalize edilmez, case-sensitive'dir.
  Aynı kullanıcı için her zaman aynı ID'yi gönderin.
- `flagKey` oluşturulduktan sonra değiştirilmemelidir. Key değişirse
  kullanıcıların bucket'ları da değişir.
- Bilinmeyen flag `200 + enabled:false` döner; çağıran uygulamayı durdurmaz.
- `503` servis hatasıdır; sessizce `true` dönmeyin. Kendi fallback politikanızı
  açıkça seçin.
- Değerlendirme için 500 ms–1 sn timeout önerilir.
- Flag'ler yetkilendirme için kullanılmamalıdır.

## Deterministik algoritma

```text
u32    = SHA-256(flagKey + ":" + userId) ilk 4 byte, big-endian
bucket = floor((u32 / 2^32) * 100)        // 0–99
açık   = enabled && bucket < rolloutPercentage
```

- Hash girdisi UTF-8'dir.
- `bucket` 0–99 arasındadır.
- Yüzde değişince yeniden hash yapılmaz; yalnızca eşik değişir.
- `%20 → %40` geçişinde `bucket < 20` olan herkes `bucket < 40` koşulunu da
  sağlar. Bu nedenle eski açık küme korunur.
- Küçük örneklemde oran tam `%20`/`%40` olmayabilir; bu beklenen bir durumdur.
- Algoritma sürümü kodda `BUCKET_ALGORITHM_VERSION = 1` olarak sabittir.
  Değiştirilirse gruplar yeniden dağılır.
- Neden SHA-256? Node'un yerleşik `crypto` modülüyle platformlar arası
  deterministik; ek bağımlılık yok; dağılım yeterince uniform.
- Neden rastgele atama değil? Rastgele atama her istekte veya her deploy'da
  sonucu değiştirebilir; hash tabanlı bucket kalıcıdır.

## Kalıcılık

SQLite dosyası `DB_PATH` ile belirlenir; Docker'da
`switchboard-data:/app/data` named volume'unda tutulur.

- `docker compose down`: container'ı kaldırır, volume'u korur.
- `docker compose up`: flag'ler ve sonuçlar yerinde kalır.
- `docker compose down -v`: volume'u de siler; temiz başlangıç.

SQLite `WAL` modunda çalışır. Tek instance hedeflenmiştir; yatay ölçekleme
kapsam dışıdır.

## Testler

```bash
npm test
npm run smoke
```

`npm test` 58 test çalıştırır:

- Determinizm ve golden vector'lar.
- Bucket sınırları (`0–99`), rollout `0`/`100`.
- `%20` kümesinin `%40` kümesinin alt kümesi olması (1.000 sabit ID).
- 10.000 sabit ID'de `%20`/`%40` dağılımının ±%2 içinde olması.
- API sözleşmesi, bilinmeyen flag, validation, auth ve `503`.
- Close/reopen sonrası flag ayarı ve değerlendirme sonucunun aynı kalması.
- Statik demo dosyaları ve JSON 404 zarfı.

`npm run smoke` Docker image'ını build eder; health, flag oluşturma, restart,
`down`/`up` sonrası kalıcılık ve `down -v` temizliğini doğrular.

Gerçek çıktılar: [`docs/EVIDENCE.md`](docs/EVIDENCE.md)

## Kararlar

Önemli kararlar [`docs/DECISIONS.md`](docs/DECISIONS.md) içinde ADR-lite
biçiminde:

- SHA-256 tabanlı deterministik bucket ve monotonluk.
- Bilinmeyen flag için `200 + FLAG_NOT_FOUND`.
- DB hatasında `503`; sessiz fail-open yok.
- Tek `ADMIN_TOKEN` + Bearer; demo seviyesinde yönetim güvenliği.
- SQLite + `better-sqlite3`; tek instance.
- `flagKey` immutable; rename yok.
- Değerlendirmede cache yok.
- Trunk-based git ve her yeşil görevde push.
- Merkezi dokümanlar + kısa görev brief'leri.
- Sessiz video + ekran üstü açıklamalar.

## Proje yapısı

```text
src/
  app.js                 # buildApp(): test edilebilir Fastify uygulaması
  server.js              # env, listen, graceful shutdown
  db.js                  # SQLite bağlantısı ve şema
  auth.js                # Bearer token doğrulama
  errors.js              # hata zarfı ve eşlemeler
  flags/
    repository.js        # flag CRUD
    evaluator.js         # SHA-256 bucket + karar
    routes.js            # admin route'ları
    evaluate-routes.js   # public evaluate route'u
    schemas.js           # JSON schema'lar
public/                  # tek sayfalık demo
examples/client.mjs      # örnek istemci
scripts/demo.mjs         # 20 → 40 demo script'i
scripts/smoke-docker.sh  # Docker smoke testi
test/                    # node:test testleri
docs/                    # plan, kararlar, kanıtlar, görev brief'leri
```

## Sınırlamalar

- `ADMIN_TOKEN` demo seviyesindedir; kullanıcı hesapları, RBAC, audit log ve
  token rotasyonu yoktur.
- Tek instance ve SQLite; yüksek eşzamanlılık/yatay ölçekleme hedeflenmez.
- Rate limiting, cache ve çoklu ortam yoktur.
- Özel kural dili, segmentler ve A/B analizi yoktur.
- Flag silme/rename yoktur.
- Küçük örneklemde yüzde tam tutmayabilir; bu istatistiksel bir gerçektir.
- Flag'ler yetkilendirme yerine kullanılmamalıdır.
