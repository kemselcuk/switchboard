# Demo ve Test Kanıtları

Bu dosya yalnızca gerçekten çalıştırılmış komutların çıktılarını ve demo
kanıtlarını içerir. Henüz doldurulmamış bölümler `TODO` olarak kalır.

## Ortam

- Tarih: TODO
- Makine: macOS (arm64), Node.js 22.23.2, Docker 29.8.1, SQLite 3.51.0
- Commit: TODO
- GitHub: https://github.com/kemselcuk/switchboard

## 1. Otomatik testler

İlk depolama çekirdeği testleri (commit `586dfad`):

```text
✔ buildApp accepts an injected repository without opening a database
✔ app.close() closes the owned database
✔ createFlag stores a flag and returns it in camelCase
✔ createFlag applies defaults for optional fields
✔ getFlag returns null for an unknown key
✔ listFlags returns flags in creation order
✔ updateFlag only changes the provided fields
✔ updateFlag with an empty patch returns the current flag
✔ createFlag rejects a duplicate key
✔ updateFlag rejects an unknown key
✔ schema enforces the rollout percentage bounds
✔ file database keeps flags after close and reopen

ℹ tests 13
ℹ pass 13
ℹ fail 0
```

`ADMIN_TOKEN` olmadan sunucu başlatma kontrolü:

```text
exit=1
ADMIN_TOKEN is required. Copy .env.example to .env and set a token.
```

## 2. Determinizm ve monotonluk

```bash
# TODO: aynı kullanıcı, %20 ve %40 karşılaştırması
```

## 3. API sözleşmesi

```bash
# TODO: curl örnekleri ve gerçek yanıtlar
```

## 4. Yeniden başlatma / kalıcılık

```bash
# TODO: docker compose restart sonrası aynı sonuç
```

## 5. Docker smoke testi

```bash
# TODO: docker compose up/build/health/restart/down çıktıları
```

## 6. Demo video

- Dosya/link: TODO
- Süre: TODO
- Gösterilen akış: TODO

## 7. Git kanıtı

```bash
# TODO: git log --oneline, tag, remote
```
