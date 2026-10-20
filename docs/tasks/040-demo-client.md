# Görev 040 — Tek sayfalık demo ve örnek istemci

## Hedef

`@fastify/static` ile tek sayfalık demo UI, küçük bir Node örnek istemcisi ve
tekrarlanabilir bir demo script'i ekle. Docker ve nihai README bu görevin
kapsamı dışında.

## Mevcut durum

- `buildApp({ dbPath, logger, repository, adminToken })` var.
- `/healthz`, `/api/flags` (admin), `/api/evaluate` (public) çalışıyor.
- `@fastify/static` bağımlılığı `package.json` içinde mevcut.
- `public/` henüz yok.

## Dosyalar

- `src/app.js` (statik dosya servisi)
- `public/index.html` (yeni)
- `public/styles.css` (yeni)
- `public/app.js` (yeni)
- `examples/client.mjs` (yeni)
- `scripts/demo.mjs` (yeni)
- `test/static.test.js` (yeni)
- `package.json` (`demo` script'i)
- `docs/EVIDENCE.md` (gerçek çıktı)

## Demo UI gereksinimleri

Tek sayfa, framework yok, build adımı yok. `http://localhost:3000/` üzerinden
servis edilmeli.

### Bölümler

1. **Başlık / durum**
   - Uygulama adı, kısa açıklama.
   - `/healthz` durum rozeti.

2. **Bağlantı**
   - Admin token input (`type="password"`).
   - Token `sessionStorage`'da tutulur; HTML'e gömülmez.
   - "Kaydet" butonu; token yoksa admin çağrıları yapılmaz, uyarı gösterilir.

3. **Flag oluştur**
   - `key`, `description`, `enabled` checkbox, `rolloutPercentage` number.
   - `POST /api/flags`; başarıda liste yenilenir; hata mesajı gösterilir.

4. **Flag listesi**
   - Her flag için key, description, enabled toggle, rollout slider/number,
     "Kaydet" butonu.
   - `PATCH /api/flags/:key`.
   - Rollout 0–100 arası; kaydetmeden önce client-side doğrulama.

5. **Değerlendir**
   - Flag seçimi, `userId` input, "Değerlendir" butonu.
   - `POST /api/evaluate` (token gerekmez).
   - Sonuç kartı: enabled, reason, bucket, rolloutPercentage.
   - Son 10 değerlendirme tablosu: zaman, flag, userId, enabled, reason, bucket.

6. **20 → 40 karşılaştırma paneli**
   - Seçili flag için 12 sabit demo kullanıcısı (bucket dağılımı için
     seçilmiş ID'ler; `public/app.js` ve `scripts/demo.mjs` ile aynı liste).
   - Önce `PATCH` ile rollout 20, kullanıcıları değerlendir.
   - Sonra `PATCH` ile rollout 40, aynı kullanıcıları değerlendir.
   - Tablo: userId, bucket, 20% sonucu, 40% sonucu, "korundu" / "yeni açıldı".
   - Flag kapalıysa panel "Flag kapalı; önce açın" mesajı göstersin.
   - Panel sonunda flag 40% açık kalabilir; bu demo davranışı README'de belirtilir.

### UI kalitesi

- Vanilla JS; `fetch`; `async/await`.
- Kullanıcı verisi `textContent` ile basılır; `innerHTML` ile kullanıcı verisi
  enjekte edilmez.
- Hata mesajları görünür ve Türkçe.
- 401 → "Admin token geçersiz"; 503 → "Servis geçici olarak kullanılamıyor".
- Basit responsive grid; erişilebilir label/button.
- Dark/light tercihi opsiyonel; kapsamı büyütme.

## Örnek istemci — `examples/client.mjs`

- Node 22 `fetch`; ek bağımlılık yok.
- Kullanım:

```bash
node examples/client.mjs \
  --url http://127.0.0.1:3000 \
  --flag new-checkout \
  --users user-0000,user-0005,user-123
```

- `SWITCHBOARD_URL`, `SWITCHBOARD_FLAG`, `SWITCHBOARD_USERS` env alternatifi.
- Her kullanıcı için `POST /api/evaluate`; sonuçları JSON satırı veya okunabilir
  tablo olarak yazdır.
- 503 → her kullanıcı için `enabled:false` fallback ve
  `reason:"EVALUATION_UNAVAILABLE_FALLBACK"` logla; exit code `2`.
- Diğer HTTP/network hataları → açık hata mesajı; exit code `1`.
- `--help` desteği.

## Demo script — `scripts/demo.mjs`

- `ADMIN_TOKEN` (varsayılan `dev-token-change-me`) ve `BASE_URL`
  (varsayılan `http://127.0.0.1:3000`).
- `demo-checkout` flag'ini oluşturur; varsa günceller.
- 12 sabit kullanıcıyı önce `%20`, sonra `%40` ile değerlendirir.
- Tablo: userId, bucket, 20%, 40%, korundu/yeni.
- Özet: kaç kullanıcı 20'de açık, kaçı 40'ta açık, kaçı korundu.
- Hata durumunda net mesaj ve exit code 1.
- `package.json` içine `"demo": "node scripts/demo.mjs"` ekle.

## Testler

`test/static.test.js`:

- `GET /` → 200, `text/html`, içinde `Switchboard` geçer.
- `GET /app.js` → 200, JavaScript içerik.
- `GET /styles.css` → 200, CSS içerik.
- Bilinmeyen `/api/...` hâlâ JSON `NOT_FOUND` zarfı döner.

Ek olarak gerçek sunucu üzerinde manuel:
- `npm start` ile demo sayfası açılır.
- `node examples/client.mjs ...` çalışır.
- `npm run demo` 20→40 tablosunu basar.

## Kabul ölçütleri

- `npm test` yeşil; statik testler dahil.
- Demo sayfası token olmadan admin çağrısı yapmaz; token HTML'de yok.
- `npm run demo` gerçek çıktı üretir; çıktı `EVIDENCE.md`'ye eklenir.
- `examples/client.mjs --help` çalışır; örnek çıktı `EVIDENCE.md`'de.
- `git diff` odaklı; commit at, push atma.
- Commit mesajı: `feat: add demo UI and example client`.

## Kapsam dışı

Docker, nihai README, video, yeni API endpoint'i, framework/build adımı,
kullanıcı hesapları, rate limiting.
