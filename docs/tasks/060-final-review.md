# Görev 060 — Bağımsız final review

## Amaç

Switchboard teslimini, kullanıcının ilk brief'ine ve onaylanan plana göre
bağımsız olarak denetle. Bu görev **salt okunur** bir review'dır: dosya
değiştirme, commit veya push yapma. Bulguları önem derecesine göre raporla.

## Okunacaklar

- `AGENTS.md`
- `docs/PLAN.md`
- `docs/DECISIONS.md`
- `docs/EVIDENCE.md`
- `README.md`
- `src/`, `test/`, `public/`, `examples/`, `scripts/`
- `Dockerfile`, `compose.yaml`, `.dockerignore`
- `package.json`, `.env.example`, `.gitignore`

## Kontrol listesi

### Ürün ve sözleşme

- Boolean flag oluşturma/güncelleme var mı?
- Tam açık/kapalı ve yüzdelik rollout çalışıyor mu?
- `POST /api/evaluate` `flagKey` + `userId` ile çalışıyor mu?
- Aynı ayarlarda aynı kullanıcı aynı sonucu alıyor mu?
- `%20 → %40` geçişinde önceki açık grup korunuyor mu?
- Bilinmeyen flag `200 + FLAG_NOT_FOUND` dönüyor mu?
- DB hatası `503 + EVALUATION_UNAVAILABLE` dönüyor mu; sessiz fail-open var mı?
- Admin uçları Bearer token ile korunuyor mu; evaluate/health public mi?
- Hata yanıtlarında stack/token/DB yolu sızıyor mu?

### Algoritma

- SHA-256, ilk 4 byte big-endian, bucket 0–99 formülü doğru mu?
- `bucket < rolloutPercentage` koşulu doğru mu?
- `flagKey` immutable varsayımı kod ve dokümanda tutarlı mı?
- Golden vector'lar bağımsız olarak doğrulanabilir mi?
- Monotonluk ve dağılım testleri deterministik mi?
- Küçük örneklemde tam yüzde iddiası var mı?

### Kalıcılık ve altyapı

- SQLite şeması, WAL ve volume doğru mu?
- `app.close()` DB'yi kapatıyor mu?
- Restart ve down/up sonrası ayar/sonuç korunuyor mu?
- Docker non-root mu?
- `ADMIN_TOKEN` zorunlu mu; gizli varsayılan var mı?

### Demo, test ve doküman

- Demo UI token'ı HTML'e gömüyor mu?
- 20→40 paneli gerçekten korunan/yeni açılan gösteriyor mu?
- Örnek istemci 503 fallback'ini doğru uyguluyor mu?
- `npm test` gerçekten yeşil mi; testler kapsamı gerçekten kontrol ediyor mu?
- `npm run smoke` gerçekten çalışıyor mu?
- README entegrasyon, algoritma, testler ve kanıtları açıklıyor mu?
- Video gerçek akışı gösteriyor mu; süre/format makul mü?
- Push geçmişi ve tag durumu temiz mi?

### Kapsam

- Özel kural dili, segment, A/B analizi, RBAC, audit log, çoklu ortam, SDK,
  rate limiting, cache, multi-instance, cloud deploy veya flag ile
  yetkilendirme eklenmiş mi?
- Gereksiz büyüme / kapsam kayması var mı?

## Komutlar

```bash
npm test
npm run smoke
ffprobe -v error -show_entries format=duration,size -show_entries stream=width,height,codec_name -of default=noprint_wrappers=1 demo/switchboard-demo.mp4
git status --short
git log --oneline -15
git remote -v
```

## Çıktı formatı

1. **Verdict:** `READY` / `NOT READY`
2. **Blocker:** varsa dosya/satır ve neden
3. **Major:** varsa
4. **Minor:** varsa
5. **Nit:** varsa
6. **Kanıt:** çalıştırılan komutlar ve gerçek çıktı özeti
7. **Kapsam kontrolü:** eklenen/kaymış işler
8. **Öneri:** tag öncesi yapılması gerekenler

Dosya değiştirme, commit/push yapma, yeni dosya oluşturma.
