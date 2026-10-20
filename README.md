<img src="assets/icon.svg" width="64" height="64" alt="">

# Switchboard

Küçük, tek ortamlı bir feature flag servisi. Boolean flag'ler, tam açık/kapalı
ve deterministik yüzdelik rollout.

> Durum: uygulama devam ediyor. Bu README, Faz 6'da nihai haline getirilecek.

## Ne yapar?

- Flag oluşturur ve günceller.
- Flag'i tamamen açar/kapatır veya kullanıcıların belirli bir yüzdesine açar.
- `flagKey` + `userId` ile deterministik sonuç döner.
- Aynı ayarlarda sonuç değişmez; yeniden başlatma sonrası ayarlar korunur.

## Hızlı başlatma

```bash
cp .env.example .env
npm ci
npm start
```

Demo: http://localhost:3000

Docker:

```bash
docker compose up --build
```

## Dokümanlar

- [Uygulama planı](docs/PLAN.md)
- [Karar kaydı](docs/DECISIONS.md)
- [Test/demo kanıtları](docs/EVIDENCE.md)

## Kapsam dışı

Özel kural dili, segmentler, A/B analizi, kullanıcı hesapları/RBAC, audit log,
çoklu ortam, SDK'lar, rate limiting, cache, multi-instance, cloud deploy ve
flag ile yetkilendirme bu projenin kapsamı dışındadır.
