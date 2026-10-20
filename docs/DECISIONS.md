# Karar Kaydı (ADR-lite)

Bu dosya, Switchboard'daki önemli teknik kararları ve sonuçlarını kısa biçimde
kaydeder. Yeni bir karar, mevcut bir kararı değiştiriyorsa eski kayıt silinmez;
yeni bir ADR eklenir ve ilişki belirtilir.

## ADR-001 — Deterministik gruplama için SHA-256

**Bağlam:** Aynı kullanıcı, aynı flag ve aynı rollout ayarında her zaman aynı
sonucu almalı. Yüzde artırıldığında önceki açık grup korunmalı.

**Karar:** `SHA-256(flagKey + ":" + userId)` hash'inin ilk 32 biti 0–99
aralığına eşlenir. Kullanıcı, `bucket < rolloutPercentage` ise açık sayılır.

**Sonuçlar:**
- Yüzde değişince yeniden hash yapılmaz; `%20 → %40` geçişinde eski küme
  korunur.
- Node'un yerleşik `crypto` modülü yeterli; ek bağımlılık yok.
- `flagKey` immutable kabul edilir. Rename, grupları değiştirir.
- Algoritma sürümü kodda sabittir. Değişiklik, kullanıcı gruplarını yeniden
  dağıtır.

## ADR-002 — Bilinmeyen flag için 200 + FLAG_NOT_FOUND

**Bağlam:** Çağıran uygulamalar bilinmeyen bir flag ile karşılaşabilir. Bu,
servis hatası mı yoksa normal bir “kapalı” durumu mu?

**Karar:** Bilinmeyen flag `200` döner; `enabled:false`, `reason:"FLAG_NOT_FOUND"`,
`bucket:null`, `rolloutPercentage:null`.

**Sonuçlar:**
- İstemci tarafında tek bir başarı yolu vardır; 404 ayrı ele alınmaz.
- Flag silinmesi/oluşturulmaması, çağıran uygulamayı durdurmaz.
- Yönetim API'sinde bilinmeyen flag yine `404` döner; bu ayrım README'de
  açıklanır.

## ADR-003 — DB hatasında 503, sessiz fallback yok

**Bağlam:** SQLite açılamazsa veya sorgu başarısız olursa değerlendirme
yapılamaz. Sessizce `true` veya `false` dönmek yanıltıcı olabilir.

**Karar:** Değerlendirme sırasında DB hatası `503` +
`EVALUATION_UNAVAILABLE` olarak döner. Örnek istemci bu durumda `false`
fallback'ine düşer ve bunu loglar.

**Sonuçlar:**
- Servis hatası ile “flag kapalı” birbirinden ayrılır.
- Fail-open yapılmaz; flag'ler yetkilendirme yerine geçmez.
- Çağıran uygulama kendi fallback politikasını açıkça seçer.

## ADR-004 — Yönetim için tek Bearer token

**Bağlam:** Tek ortamlı, küçük bir demo servisi için kullanıcı hesabı sistemi
gereksiz.

**Karar:** Yönetim uçları `ADMIN_TOKEN` ortam değişkeni ve
`Authorization: Bearer` ile korunur. Karşılaştırma `timingSafeEqual` ile
yapılır. `/api/evaluate` ve `/healthz` public kalır.

**Sonuçlar:**
- Kurulum basit; token repoya girmez.
- Bu, üretim seviyesinde kimlik doğrulama değildir; README'de açıkça belirtilir.
- Çok kullanıcılı yönetim, RBAC ve audit log kapsam dışıdır.

## ADR-005 — SQLite + better-sqlite3

**Bağlam:** Tek instance, düşük trafik, kalıcılık ve basit kurulum hedefleniyor.

**Karar:** SQLite dosyası; `better-sqlite3` senkron API; WAL modu; Docker volume.

**Sonuçlar:**
- Ek veritabanı sunucusu yok; yerel başlatma kolay.
- Senkron sorgular tek instance için yeterli; yüksek eşzamanlılık hedefi yok.
- Docker image'ında native modül için build araçları gerekebilir; smoke test
  bunu doğrular. Sorun çıkarsa `node:sqlite` alternatifi değerlendirilir.

## ADR-006 — flagKey immutable

**Bağlam:** Gruplama `flagKey` üzerinden yapılıyor. Key değişirse tüm
kullanıcıların bucket'ları değişir.

**Karar:** Flag key oluşturulduktan sonra değiştirilemez; rename endpoint'i yok.

**Sonuçlar:**
- Determinizm korunur.
- Key değiştirmek isteyen kullanıcı yeni flag oluşturur; bu, rollout geçmişini
  sıfırlar.
- README'de “key'i stabil tutun” uyarısı bulunur.

## ADR-007 — Değerlendirmede cache yok

**Bağlam:** Tek instance ve küçük veri seti var. Cache, güncelleme sonrası
tutarsızlık ve ek karmaşıklık getirir.

**Karar:** Her değerlendirme SQLite'tan okunur; cache yok.

**Sonuçlar:**
- Güncellemeler bir sonraki istekte görünür.
- SQLite okuma maliyeti bu ölçekte kabul edilebilir.
- Yatay ölçekleme ve cache kapsam dışıdır.

## ADR-008 — Trunk-based git ve her yeşil görevde push

**Bağlam:** Kullanıcı, her anlamlı geliştirmede GitHub'a push istiyor. Review
atlanmadan ilerlenmeli.

**Karar:** Sıralı işlerde `main` üzerinde küçük commit'ler; paralel işlerde kısa
ömürlü `task/<id>` dalları. Subagent commit eder; orchestrator diff + test
kontrolünden sonra push atar. Definition of Done push'u içerir.

**Sonuçlar:**
- `main` her zaman yeşil kalır.
- Push geçmişi küçük ve anlaşılır olur.
- Force-push ve secret commit yasaktır.

## ADR-009 — Merkezi dokümanlar + görev brief'leri

**Bağlam:** Az sayıda kalıcı doküman, çok sayıda dağınık görev raporundan daha
okunabilir.

**Karar:** `docs/PLAN.md`, `docs/DECISIONS.md`, `docs/EVIDENCE.md` merkezi;
`docs/tasks/NN-*.md` yalnızca subagent'lara verilen kısa brief'ler için.

**Sonuçlar:**
- Kalıcı bilgi tek yerde; görev brief'leri geçici.
- README dış dünyaya açılan ana kapı olur.
- Her görev brief'i kabul ölçütü ve dosya sınırı içerir.

## ADR-010 — Sessiz video + ekran üstü açıklamalar

**Bağlam:** Kısa demo videosu seslendirme gerektirmeden anlaşılır olmalı.

**Karar:** 1–2 dakikalık sessiz ekran kaydı; kritik adımlarda kısa ekran üstü
metinler; README'de komut çıktıları ve timestamp'li kanıt.

**Sonuçlar:**
- Video üretimi ve izlenmesi kolay.
- Teknik ayrıntı README ve `EVIDENCE.md`'de kalır.
- Seslendirme ayrıca istenirse ayrı bir sürüm olarak eklenebilir.

## ADR-011 — Docker'da better-sqlite3 için deps aşamasında build fallback

**Bağlam:** `better-sqlite3` native bir modüldür. Bu ortamda Docker build
sırasında prebuilt binary indirilemedi.

**Karar:** Dockerfile önce `npm ci --omit=dev` dener; başarısız olursa yalnızca
deps aşamasında `python3 make g++` kurup derler ve aynı aşamada temizler.
Runtime image non-root `node` kullanıcısıyla çalışır.

**Sonuçlar:**
- İlk build daha uzun sürebilir; runtime image'da build aracı kalmaz.
- Smoke testi build, health, restart ve volume kalıcılığını doğrular.
- Prebuilt binary ileride çalışırsa fallback devreye girmez.

## ADR-012 — Demo kaydı için dev-only Playwright-core

**Bağlam:** Demo videosu gerçek UI etkileşimlerini göstermeli; uygulama
bağımlılıkları şişmemeli.

**Karar:** `scripts/record-demo.mjs`, devDependency olan `playwright-core` ve
sistem Chrome'u kullanır. Video codec'i için Playwright'ın FFmpeg bileşeni
bir kez indirilir; MP4 dönüşümü sistem `ffmpeg` ile yapılır. Üretim Docker
image'ı `npm ci --omit=dev` kullandığı için Playwright image'a girmez.

**Sonuçlar:**
- Video gerçek tarayıcı etkileşimiyle üretilir; browser panel bağımlılığı yok.
- Kayıt için yerel Chrome ve tek seferlik FFmpeg bileşeni gerekir.
- Video `demo/switchboard-demo.mp4` olarak kanıta eklenir.
