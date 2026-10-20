# Switchboard — Agent Kuralları

Bu dosya, bu repoda çalışan tüm ajanlar için bağlayıcı proje kurallarıdır.
`docs/PLAN.md` ve `docs/DECISIONS.md` ile birlikte okunur.

## Proje

Switchboard, küçük ve tek ortamlı bir feature flag servisidir. Boolean flag'ler,
tam açık/kapalı ve deterministik yüzdelik rollout desteklenir. Flag'ler
yetkilendirme mekanizması değildir.

## Stack

- Node.js 22+ (ESM)
- Fastify 5
- SQLite + `better-sqlite3`
- `@fastify/static` (tek sayfalık demo)
- `node:test` + Fastify `inject`

## Komutlar

```bash
npm ci            # bağımlılıkları kur
npm test          # tüm testler
npm run dev       # yerel geliştirme (watch)
npm start         # yerel çalışma
npm run smoke     # Docker smoke testi
```

## Kod kuralları

- ESM (`import`/`export`), 2 boşluk, noktalı virgül, tek tırnak.
- Route handler'lar ince olmalı; iş kuralları `src/flags/` altında.
- SQL yalnızca `src/db.js` ve `src/flags/repository.js` içinde.
- Hatalar ortak `{ error: { code, message } }` zarfını kullanır.
- Kullanıcı girdisi JSON schema ile doğrulanır; `userId` normalize edilmez.
- Secret, token veya `.env` içeriği loglanmaz/commit edilmez.

## Kapsam sınırı

Şunları eklemeyin: özel kural dili, segmentler, A/B analizi, kullanıcı
hesapları/RBAC, audit log, çoklu ortam, SDK'lar, rate limiting, cache,
multi-instance, Postgres, cloud deploy, flag silme/rename, flag ile
yetkilendirme. Yeni bir ihtiyaç varsa önce `docs/PLAN.md` güncellenir ve
kullanıcıya sorulur.

## Çalışma akışı

1. Görev brief'ini oku; brief yoksa kodlamaya başlama.
2. Küçük, tek amaçlı değişiklik yap.
3. `npm test` çalıştır; ilgiliyse Docker smoke testini çalıştır.
4. `docs/EVIDENCE.md`'ye gerçek çıktı ekle (uydurma çıktı yasak).
5. Commit at. Subagent'lar push atmaz; push'u orchestrator yapar.
6. Diff + test sonucu olmadan “bitti” deme.

## Git

- `main` her zaman yeşil kalır.
- Anlamlı her görevde commit + push hedeflenir.
- Paralel işlerde kısa ömürlü `task/<id>` dalı kullanılır.
- Force-push, `git reset --hard` ile başkasının işini silme ve secret commit
  yasaktır.
- Commit mesajları: `feat:`, `fix:`, `test:`, `docs:`, `chore:`.

## Test beklentisi

- Determinizm, monotonluk, sınırlar, sözleşme, auth, DB hatası ve persistence
  testleri zorunludur.
- İstatistiksel testlerde sabit ID listeleri kullanılır; küçük örneklemde tam
  yüzde iddia edilmez.
- Testler `:memory:` veya geçici dosya DB kullanır; gerçek `data/` dizinine
  dokunmaz.

## Dokümanlar

- `README.md` — dış kullanıcı için giriş, kurulum, API, entegrasyon.
- `docs/PLAN.md` — kapsam, aşamalar, kabul ölçütleri.
- `docs/DECISIONS.md` — ADR-lite kararlar.
- `docs/EVIDENCE.md` — gerçek test/demo kanıtları.
- `docs/tasks/` — kısa görev brief'leri.

## Güvenlik

- `ADMIN_TOKEN` yalnızca ortam değişkeninden okunur.
- Token karşılaştırması sabit zamanlıdır.
- Hata yanıtlarında stack trace, dosya yolu veya token bulunmaz.
- Demo sayfası token'ı HTML'e gömmez; `sessionStorage` kullanır.
- Flag'ler yetkilendirme için kullanılmaz; README'de bu uyarı korunur.
