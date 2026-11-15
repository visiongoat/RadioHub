# Mega Radio — Figma tasarım çalışma notları

## Başlangıç

- Her çalışma başlangıcında ve aradan sonra, commit/push/merge öncesinde
  `pnpm run repo:check` ile uzak main'i güncelle ve kontrol et. Eksik commit varsa
  mevcut çalışmayı koruyarak önce main ile birleştir. Kalıcı yerel kontroller:
  [Repository workflow](REPOSITORY_WORKFLOW.md).
- İnceleme tarihi: 5 Ekim 2026.
- Kaynak: https://github.com/mumiix58/RadioHub
- Başlangıç commit'i: `add2ba492dd2eb450a706fcb8440dba6262cbbbd` (`origin/main`).
- Tasarım branch'i: `codex/design` (yerel).
- Hedef: Kullanıcının seçtiği sayfaları Mega Radio Figma tasarımıyla karşılaştırıp
  farkları mevcut web uygulamasına aşamalı olarak uygulamak.
- Figma dosyası: [Mega Radio](https://www.figma.com/design/Jf3ZOklsARouzh5Mop0rRz/Mega-Radio?node-id=2035-6194).
  İlk sayfa favoriler; uygulanan kapsam aşağıdaki çalışma kaydında açıklanıyor.
  Sonraki sayfaların sırasını kullanıcı belirleyecek.

## Güncel yapı

Proje bir pnpm monoreposudur. Ana arayüz `artifacts/megaradio` içinde React 19.1,
TypeScript, Vite 7, Tailwind CSS 3, Wouter ve TanStack Query 5 kullanır. Radix UI
primitifleri, Lucide ikonları ve bazı Heroicons bileşenleri vardır.

API, `artifacts/api-server` içindeki Express 5 uygulamasıdır. Güncel
`src/index-api.ts`, `src/postgres-runtime.ts` ve `scripts/start-postgres.mjs`
PostgreSQL kullanır. Veritabanı yapılandırması için bu güncel başlangıç
dosyaları esas alınır.

`lib/db-shared` ortak tipleri/şemaları, `lib/seo-shared` yerelleştirilmiş SEO ve
URL yardımcılarını, `lib/api-client-react` API istemcisini içerir. Investor deck
ve mockup sandbox ayrı uygulamalardır.

## Ekran ve dosya haritası

Aşağıdaki yollar `artifacts/megaradio/src` klasörüne göredir. URL'ler İngilizce
kanonik örneklerdir; dil önekleri ve çevrilmiş yollar `useSeoRouting` ile çözülür.

| Ekran | URL örneği | Temel dosya |
| --- | --- | --- |
| Ana sayfa | `/` | `pages/radio-frontend.tsx` |
| Radyo listesi | `/radios`, `/stations` | `pages/radios.tsx` |
| Radyo detayı | `/station/:slug` | `pages/stations/[id].tsx` |
| Arama | `/search` | `pages/search.tsx` |
| Türler | `/genres` | `pages/genres.tsx` |
| Tür açılışı / detayı | `/genres/:slug` ve alt yollar | `pages/genres/genre-landing.tsx`, `pages/genres/[slug].tsx` |
| Bölgeler / ülkeler / şehirler | `/regions` ve alt yollar | `pages/RegionsPage.tsx`, `RegionCountriesPage.tsx`, `CountryCitiesPage.tsx`, `RegionStationsPage.tsx` |
| Öneriler / trendler | `/recommendations`, `/trending` | `pages/recommendations.tsx`, `pages/TrendingStations.tsx` |
| Giriş / kayıt | `/login`, `/signup` | `pages/login.tsx`, `pages/signup.tsx` |
| Alternatif auth ekranları | `/auth/login`, `/auth/signup` | `pages/auth/login.tsx`, `pages/auth/signup.tsx` |
| Profil | `/profile/settings` (eski `/profile` yönlendirilir) | `pages/profile-settings.tsx`, `components/layout/ProfileLayout.tsx` |
| Favoriler / keşfet | `/profile/favorites`, `/profile/discover` | `pages/favorites.tsx`, `pages/profile-discover.tsx` |
| Profil ayarları / bildirimler | `/profile/settings`, `/profile/notifications` | `pages/profile-settings.tsx`, `pages/notifications-view.tsx` |
| Mesajlar | `/profile/messages` | `pages/messages.tsx` |
| Topluluk / kullanıcı | `/users`, `/users/:id` | `pages/users/index.tsx`, `pages/UserProfile.tsx` |
| Premium | `/premium` | `pages/premium.tsx` |
| Bilgi sayfaları | `/about`, `/contact`, `/applications`, `/faq` | İlgili `pages/*.tsx` dosyaları |

Benzer isimli eski/alternatif ekranlar bulunduğundan dosya seçerken önce
`App.tsx` içindeki `renderByCleanPath` ve lazy import eşleşmesini kontrol et.

## Paylaşılan tasarım alanları

| Alan | Dosyalar (`artifacts/megaradio` altında) |
| --- | --- |
| Üst menü / marka | `src/components/layout/radio-header.tsx`, `header-brand.tsx`, `header-brand.css` |
| Mobil gezinme / hızlı arama | `src/components/layout/mobile-navigation.tsx`, `quick-search-dialog.tsx`, `quick-search-dialog.css` |
| Alt bölüm | `src/components/layout/footer.tsx` |
| Radyo kartı / logo / ızgara | `src/components/ui/station-card.tsx`, `station-logo.tsx`, `stations-grid.tsx` |
| Ana sayfa başlığı ve görseli | `src/components/HomeHeroCopy.tsx`, `HomeHeroPicture.tsx` |
| Global oynatıcı | `src/components/global-player.tsx`, `src/hooks/useGlobalPlayer.tsx`, `useGlobalPlayer.shell.tsx`, `LazyGlobalPlayerProvider.tsx` |
| Tema / tipografi | `src/index.css`, `tailwind.config.ts`, `src/lib/theme-provider.tsx` |
| Statik varlıklar | `public/fonts`, `public/icons`, `public/images`, repo kökündeki `attached_assets` |

Kodda görülen mevcut görsel temel: Ubuntu, pembe vurgu `#FF4199`, koyu yüzey
`#0E0E0E`. Tailwind container ayarlarında 1512 px ve geniş ekranlarda 153 px yatay
padding referansı var. Bunlar mevcut uygulamanın değerleridir; güncel Figma
tasarımının doğrulanmış ölçüleri olarak kabul edilmemelidir. Bazı stiller global
CSS, bazıları sayfa içi Tailwind sınıflarında bulunduğundan ikisini birlikte incele.

## Yerel çalışma

Node.js 24 ve pnpm ile, repo kökünden:

```sh
pnpm install --frozen-lockfile
PORT=22507 BASE_PATH=/ pnpm --filter @workspace/megaradio run dev
```

Vite adresi: `http://localhost:22507`. Bu yalnızca frontend sunucusudur.
Mevcut Vite config'inde `/api` proxy'si yoktur. Repo geliştirme düzeninde ayrı
reverse proxy, `/api` isteklerini backend'e yönlendirir. Ortak API yardımcıları
`VITE_API_BASE_URL` destekler; kaynakta doğrudan `/api` fetch çağrıları da vardır,
bu yüzden bu değişken tek başına bütün ekranların bağlantısını garanti etmez.

Tam veriyle çalışmak için geliştirme API'si ve PostgreSQL kurulumu gerekir.
API başlangıç betiği şema migrasyonlarını uyguladığından veri kaynağı belirlenmeden
çalıştırılmamalıdır. Bu hazırlık sırasında API/veritabanı başlatılmadı.

Mac'te ilk build, `@rollup/rollup-darwin-arm64` bulunamadığı için durdu.
`pnpm-workspace.yaml` içindeki esbuild, Rollup, Lightning CSS ve Tailwind Oxide
Darwin hariç tutmaları kaldırıldı; lockfile aynı sürümlerin macOS bağımlılıklarını
içerecek şekilde yenilendi. Linux ve Windows destekleri korundu.

## Hazırlık doğrulaması

5 Ekim 2026, Node.js 24.19.0 / pnpm 11.19.0 / macOS arm64:

- `pnpm install --frozen-lockfile`: başarılı; güncellenmiş lockfile ile tekrar doğrulandı.
- `pnpm run typecheck:libs`: başarılı.
- `pnpm --filter @workspace/megaradio run typecheck`: başarılı.
- Frontend production build: başarılı. Mevcut büyük chunk uyarıları devam ediyor.
- Frontend Vitest: 139 test dosyası, 2.010 test başarılı.
- Vite geliştirme sunucusu: başlangıç başarılı; `/` ve `/src/main.tsx` HTTP 200.
- Tam API/veritabanı entegrasyonu ve tarayıcıda Figma karşılaştırması yapılmadı.
- Backend testleri ve bütün workspace build'i bu hazırlığın doğrulamasına dahil değil.
- Branch ve hazırlık değişiklikleri yereldir; commit/push/PR oluşturulmadı.

## Her sayfa için izlenecek kayıt

- Figma bağlantısı ve frame/node kimliği.
- Uygulama URL'si, dil, ekran genişliği ve oturum/veri durumu.
- Tespit edilen farklar ve değiştirilen dosyalar.
- Masaüstü/mobil karşılaştırma sonucu ve çalıştırılan ilgili testler.
- Kalan farklar veya gerçekten eksik bağımlılıklar.

## 5 Ekim 2026 — Profil / Favoriler

- Referans: Web / `your-favorites` (`2035:6194`), ortak profil shell'i
  `2035:9624`; mesaj ikonu `1339:6118`.
- Ekran: `/tr/profil/favoriler`, giriş yapılmış kullanıcı.
- Kullanıcı kapsamı: sol profil menü ikonları ve seçili ikon rengi, sol logo
  hizası, breadcrumb'ın Favorileriniz başlığıyla hizası.
- Figma Vuesax bold ikonları `public/icons/profile/` altına orijinal SVG olarak
  alındı. 24 px maskeler ikon rengini uyguluyor; yalnız aktif menü ikonu
  `#FF4199`, diğerleri beyaz. Seçili satırın gri arka planı korundu.
- Figma'da Records olan menü yerine uygulamadaki Mesajlar işlevi korundu ve
  Figma dosyasının mesaj ikonu kullanıldı. Yeni kayıt özelliği eklenmedi.
- Masaüstü profil header'ı tam genişlikte, logo soldan 30 px. Sidebar 250 px;
  breadcrumb ve içerik aynı inset'i kullanıyor (250 + 30 = 280 px).
  Oynatıcının profil sidebar'ı için görsel offset'i de 250 px'e uyarlandı.
- 1512 px genişlikte DOM ölçümü: logo x=30, breadcrumb x=280, başlık x=280.
  Seçili ikon `rgb(255, 65, 153)`, diğer beş ikon beyaz, ikon slotları 24×24 px.
- 390 px mobil kontrolde breadcrumb ve başlık x=8; yatay taşma yok.
- Figma'daki diğer header menü öğeleri, logo boyutu, radyo kartları ve
  oynatıcı içeriği bu talebin dışında bırakıldı.
- Görsel inceleme için `.local/profile-preview.config.mts` gerçek uygulamayı
  salt okunur örnek API yanıtlarıyla başlatır. Üretim build'ine dahil değildir;
  gerçek kullanıcı oturumu veya veritabanı kullanmaz. Yeniden başlatma:

```sh
PORT=22508 BASE_PATH=/ pnpm --filter @workspace/megaradio exec vite --config ../../.local/profile-preview.config.mts
```

Önizleme: `http://127.0.0.1:22508/tr/profil/favoriler`. Örnek hesap ve radyo
isimleri kullanır. Standart geliştirme sunucusu 22507 portunda ayrı kalır.
Ekran görüntüleri `.local/design-checks/profile-desktop.jpg` ve
`.local/design-checks/profile-mobile.jpg` içinde tutulur.

Doğrulama: frontend TypeScript kontrolü, production build ve 139 dosyadaki
2.010 test başarılı. Masaüstü/mobil görsel kontrol örnek API verileriyle yapıldı;
gerçek hesap işlemleri ve yayın oynatma bu tasarım kontrolünde denenmedi.

### Tarayıcı yorumları — logo yazısı ve başlık sırası

- Figma wordmark referansı: `2035:9858`. Profil header'ında 1024 px ve üzerinde
  `megaradio` yazısı görünür; Ubuntu 20.384 px, mega 700 / radio 400 ağırlığında,
  ikon ile yazı arasında 11 px boşluk kullanılır.
- Favoriler başlığı, adet ve sıralama aynı üst satıra alındı. Breadcrumb bu
  satırın 8 px altında, başlıkla aynı sol hizada gösterilir. App seviyesindeki
  breadcrumb bu sayfa için kaldırıldı; diğer sayfalardaki konumu korunur.
- İçeriğin üst boşluğu 20 px, adet rozeti 32 px, breadcrumb sonrası boşluk
  20 px olarak sıkılaştırıldı.
- 1218 px genişlikte başlık y=110, breadcrumb y=150; ikisi de x=280.
  1512 px genişlikte logo x=30, başlık ve breadcrumb x=280. 390 px mobilde
  başlık ve breadcrumb x=8; üç genişlikte de yatay taşma yok.
- Sıralama menüsünün açılması ve seçim değişimi örnek verili önizlemede
  doğrulandı. Kontrol sonunda başlangıç seçimine dönüldü.
- TypeScript kontrolü, production build ve 139 dosyadaki 2.010 test başarılı.
  Mevcut build chunk boyutu uyarıları sürüyor.
- Ekran görüntüleri: `.local/design-checks/profile-comments-final.jpg` ve
  `.local/design-checks/profile-comments-mobile.jpg`.

## 6 Ekim 2026 — Profil / Keşfet

- Figma referansı: Web / `discover` (`2035:8058`), başlık `2035:8319`.
  Başlık Ubuntu Bold 24 px, 28 px satır yüksekliği; masaüstü sol hizası 280 px.
- Kullanıcının istediği sıra: günün saatine göre karşılama, Keşfet başlığı,
  breadcrumb. Breadcrumb sayfa içeriğine taşındı; App seviyesindeki kopyası
  kaldırıldı. Favoriler ile aynı 20 px üst boşluk kullanılıyor.
- Figma'da bulunmayan mevcut "Beni şaşırt" eylemi, kullanıcının son geri
  bildirimiyle çerçevesiz metin ve küçük analog radyo kadranı olarak tasarlandı.
  Yaklaşık 107×36 px kontrolün 28 px kadranında tek pembe ibre bulunuyor;
  hover/klavye odağında dönüyor, seçim sırasında tarama hareketi yapıyor.
  Mobilde de Keşfet başlığının yanında. İşlev açıklaması title ve erişilebilir
  açıklamada mevcut; metin ve ölçü sabit. İstasyon seçme/oynatma akışı korundu.
- Gün mesajı ve eylem metinleri 14 dil için yerel fallback içeriyor; mevcut
  dilin özel çevirileri öncelikli. Türkçe ekranda İngilizce gün mesajı önlendi.
- Masaüstünde gün mesajı, başlık ve breadcrumb aynı x=280 sol hizasında.
  390 px mobilde buton 107×36 px ve başlıkla aynı satırda. Yatay taşma yok.
  Klavye odağı 2 px pembe dış çizgiyle görünür; görünür 36 px butonun
  dokunma alanı 44 px yüksekliğe genişletildi. Kadran hareketi azaltılmış
  hareket tercihine saygı gösteriyor.
- TypeScript, frontend build ve 139 dosyadaki 2.010 test başarılı. Mevcut
  build sourcemap/chunk uyarıları devam ediyor. Görsel kontrol yalnız yerel,
  örnek API verileriyle yapıldı; bu değişiklik henüz yayımlanmadı.
- Önizleme: `http://127.0.0.1:22508/tr/profil/ke%C5%9Ffet`.
  Ekran görüntüleri: `.local/design-checks/discover-desktop.jpg` ve
  `.local/design-checks/discover-mobile.jpg`. Kompakt revizyonun görselleri
  `discover-compact-desktop.jpg` ve `discover-compact-mobile.jpg`; bu revizyon
  TypeScript ve masaüstü/mobil görsel kontrolle doğrulandı.

- Son kadran denemesi: `discover-tuner-desktop.jpg` ve
  `discover-tuner-mobile.jpg`. TypeScript, klavye odağı ve mobil taşma
  kontrolü başarılı; henüz canlıya yayımlanmadı.

## 7 Ekim 2026 — Ana sayfa / header araması

- Ana sayfadaki header merceği ve Ctrl+K / Cmd+K, mevcut hero aramasını
  doğrudan sonuçları açık ve yazmaya odaklanmış durumda açar. Boş sorguda,
  ana sayfa için yüklenen popüler istasyonların ilk altısı gösterilir;
  iki karakterden itibaren mevcut arama servisi kullanılır.
- Hero alanına doğrudan tıklama davranışı korunur: yazmaya başlamadan
  sonuç listesi açılmaz. Diğer sayfalarda header'ın mevcut arama penceresi
  kullanılır; hero henüz yüklenmemişse aynı pencereye geri dönülür.
- Escape, kapatma düğmesi ve dış alan tıklaması aramayı kapatır ve odağı
  açan kontrole döndürür. Ok tuşları ve Enter ile istasyon seçilebilir.
  Temizlenen sorgunun gecikmiş yanıtları iptal edilerek sonuçlara karışması
  önlendi. Mobilde açık arama ekranın üstünden 16 px boşluk bırakır;
  sonuç listesinin yüksekliği görünür ekranla sınırlandırılır.
- TypeScript kontrolü, production build ve 140 dosyadaki 2.021 test başarılı.
  Ana sayfa/header arama davranışlarını doğrulayan 11 entegrasyon testi eklendi.
  Masaüstünde fare, Ctrl+K, yazıp sonuç alma ve kapatma; 390 px mobilde
  açık sonuçlar, giriş odağı ve yatay taşma yerel tarayıcıda doğrulandı.
- Önizleme: `http://127.0.0.1:22508/tr`. Ekran görüntüleri:
  `.local/design-checks/home-header-search-desktop.jpg` ve
  `.local/design-checks/home-header-search-mobile.jpg`.
  Önizleme örnek API verileri kullanır; bu değişiklik henüz yayımlanmadı.

## 10 Ekim 2026 — Arama panelinin Figma eşleştirmesi

- Referans: Web / home (`1711:5258`), açık arama instance'ı `1711:7199`,
  `search` varyantı `591:4887`. Figma tasarım bağlamı ve görseli incelendi.
- Panel 614×393 px, 20 px köşe, 2 px beyaz kenarlık, tek katman %20 beyaz
  dolgu ve 10,5 px arka plan bulanıklığı kullanır. Tam sayfa karartma/bulanıklık,
  sonuç satırlarının ayraçları ve ek dolgu katmanları kaldırıldı. Panelin
  açılması hero başlığını veya arama girişini yukarı kaydırmaz.
- Figma'nın 24 px mercek ve daire içindeki kapatma ikonları ile 615×2 px
  ayırıcı SVG'si `public/icons/home-search/` altında yerel olarak saklandı.
  Giriş ve istasyon adı 20 px Ubuntu Medium; sayaç 14 px, %50 beyaz.
  Dinamik istasyon görselleri, ülke adı/bayrağı ve beğeni sayısı korunur.
- Mevcut Radix ScrollArea bileşeni kullanıldı. 263 px sonuç alanında
  taşma olduğunda 10 px beyaz ray ve gri sürüklenebilir tutamak kalıcı
  görünür; fare ayrıldığında kaybolmaz. Kaydırma panel içinde kalır.
- Masaüstünde boyut, cam değerleri ve yerel SVG'lerin yüklenmesi doğrulandı.
  Kaydırma çubuğunu sürüklemek listeyi 121 px kaydırırken sayfa y=0 kaldı.
  X ile kapatma ve Ctrl+K ile yeniden açma çalışıyor. 390 px mobilde panel
  x=16, y=16, genişlik=358 px; yatay taşma yok, giriş odağı korunuyor.
- Önizleme örnek API verileriyle `http://127.0.0.1:22508/tr` adresinde.
  Bu görsel düzenleme henüz canlıya yayımlanmadı.
- Son kullanıcı tercihi: yalnız sonuç sayacı canlı sürümdeki tamamlayıcı
  şerit görünümüne döndürüldü: %20 beyaz dolgu, ince alt ayraç,
  12 px beyaz büyük harfli metin. Diğer Figma düzenlemeleri korundu.

## 10 Ekim 2026 — Web ve mobil alt-player

- Figma'nın iki ayrı `alt-player` bileşeni doğrudan incelendi: web
  `856:2842` (1512×110), mobil `1711:10123` (375×104). Canlı ana sayfada
  oynatıcı açılarak mevcut görünümle karşılaştırıldı; inceleme sonunda yayın durduruldu.
- Mini oynatıcıda önceki/sonraki, duraklatma, kalp, ses ve müzik servisi ikonları
  Figma SVG'leriyle eşleştirildi (`public/icons/mini-player/`). Dinamik radyo
  logosu ve bayrak, mevcut oy verme/paylaşma işlemleri ve küçültme oku korundu.
- Radyo adı Ubuntu Medium 15 px, şarkı Ubuntu Light 14 px. Eksik 300 ağırlığı
  Google Fonts'un Ubuntu Light dosyası ve Ubuntu Font Licence ile yerel eklendi.
  Şarkı satırı webde en fazla 200 px, mobilde 174 px; tam metin title niteliğinde.
- Web yükseklik 110 px, mobil 104 px; mobil kenar boşluğu 16 px ve üst boşluk
  12 px. Ok ayrı bir alanda hizalanır. Mobil güvenli alt alan hesaba katılır.
  Container query, profil yan menüsünden kalan alanı da dikkate alır.
- Ses göstergesi sabit %43 yerine oynatıcıdaki gerçek volume değerini kullanır;
  değişiklik doğrudan sağlayıcının setVolume işlevinden geçer.
- TypeScript ve production build başarılı. Mevcut 140 dosya/2.021 test geçti;
  ardından ses, küçültme, tam metin ve ortak kontrol davranışı için eklenen
  dört regresyon dahil ilgili iki dosyada 56 test geçti.
- Tarayıcıda 320/375 px mobil, 800 px web, 1280 px profil alanı ve 1512 px web
  kontrol edildi: yatay taşma yok, SVG ölçüleri korunuyor, metinler kontrollere
  taşmıyor; küçült/aç, durdur/çal ve klavyeden ses ayarı çalışıyor.
- Yerel ve sessiz oynatma fixture'ı: `http://127.0.0.1:22508/tr?player-preview=1`.
  Önizleme giriş noktası ve örnek veriler yalnız `.local/` altında; üretim
  paketine dahil değildir. Bu değişiklikler henüz canlıya yayımlanmadı.
  Görseller: `.local/design-checks/mini-player-desktop.png`,
  `.local/design-checks/mini-player-mobile.png`.
- Yayın öncesi kullanıcı tercihi: şarkı metninin yeni 200/174 px sınırları ve
  metadata alanının ek genişlik kısıtı kaldırıldı. Metin kullanılabilir alanı
  doldurur; yalnız kontrollere taşmasını önleyen doğal ellipsis korunur.
  Önceki Keşfet, header/hero arama ve alt-player güncellemeleriyle birlikte
  yayın talep edildi. 140 dosyada 2.025 test, TypeScript ve build geçti.

## 10 Ekim 2026 — Yayın sonrası mini player ayrıntıları

- Önceki tasarım paketi PR #106 / `7bbb45b5f` ile yayımlandı. Bu bölümdeki
  son düzenlemeler kullanıcı isteğiyle canlıya alınacak ek düzeltmelerdir.
- Kullanıcının Chrome'unda 1512 px genişlikte Power POP ile karşılaştırıldı.
  Kısa şarkı metninin `flex-grow` davranışı servis ikonlarını gereksiz yere
  sağa itiyordu. Metin doğal genişliğini kullanır; ikonlar 12 px ardından
  gelir. Uzun metin için sabit bir genişlik sınırı eklenmedi.
- Web `856:2842` ve mobil `1711:10123` tasarım bağlamları yeniden alındı.
  Figma'nın %85 siyah altlığı Web sayfasındaki `#e5e5e5` tuval üzerinde
  yaklaşık `#222` görünür. Koyu web zemininin aynı görünümü vermesi için
  altlık `rgb(38 38 38 / 85%)` olarak ayarlandı; 6 px CSS arka plan blur'u
  korundu. Siyah kontrol yüzeyleri böylece ayırt edilir.
- Masaüstü kontrol aralığı 20'den 12 px'e, ses grubu aralığı 19'dan 16 px'e
  indi. 1512 px genişlikte kontrol grubunun başlangıcı x=698'den x=733'e
  taşındı. Dar alan/mobil aralıkları CSS değişkeniyle 10/6 px kalır.
- TypeScript, production build ve ilgili 56 test geçti. Chrome'da kısa/uzun
  metin, 320/375/800/1512 px genişlikler, SVG ölçüleri ve küçült/aç kontrolü
  doğrulandı; yatay taşma veya kontrollerle çakışma yok.
- Kısa metin önizlemesi: `http://127.0.0.1:22508/tr?player-preview=1&short-title=1`.
  Örnek metadata yalnız `.local/mini-player-preview.tsx` içindedir.

## 10 Ekim 2026 — Ana sayfa kayıt alanı ve footer ayrıntıları

- Figma Web ana sayfa `1711:5258`, kayıt alanı `1711:7192`, footer
  `1711:7200` ve mobil footer `2392:9506` güncel tasarımdan incelendi.
- Kayıt alanının eksik kişi görseli Figma'dan yerel dosyaya alındı.
  1206×298 px masaüstü ölçüsü, yeşil/mavi geçiş, 20 px köşeler, gölge,
  Ubuntu tipografi ve görselin darken karışımı eşleştirildi. Mobilde metin
  ve kayıt düğmesini kapatmayan duyarlı bir yerleşim uygulandı.
- Facebook, Instagram ve Twitter Figma SVG'leri özgün 48×48 ölçüleriyle
  `public/icons/footer/` altında tutulur. Aktif platformlar ve adresler
  mevcut API'den gelir; YouTube gibi ek platformlar korunur. MXRTOKEN
  bağlantısı kaldırıldı.
- Dil seçicinin küre ikonu yerine etkin dilin kodunu gösteren küçük bir
  rozet, daha belirgin grafit yüzey ve kısa açılış animasyonu eklendi.
  Arama, Escape/odak dönüşü, dil yönlendirmesi ve reduced-motion korundu.
- TypeScript, production build ve footer/dil geçişine ait dört dosyada
  57 test başarılı. 320/375 px mobil, 768 px tablet ve 1512 px masaüstü
  görünümleri kontrol edildi; yatay taşma yok.
- İzole yerel önizleme: `http://127.0.0.1:22508/tr?footer-preview=1`.
  Fixture yalnız `.local/` içindedir. Bu bölümün değişiklikleri henüz
  canlıya yayımlanmadı.

## 10 Ekim 2026 — Arama sonucu satırları ve kaydırma alanı

- Kullanıcının canlı arama ekranındaki yorumu üzerine `591:4887` yeniden
  incelendi. Mevcut sayaç şeridi, cam yüzey, ülke/bayrak ve beğeni bilgileri korundu.
- Listenin 23 px yan ve 28 px alt dış boşlukları kaldırıldı; satır içeriğine
  yatay/dikey padding verildi. Fare ve klavye vurgusu artık tüm satırı kaplar.
  Sonuç alanı panelin alt köşesine kadar uzanır.
- Kaydırma rayı sağdan 10 px, üstten/alttan 16 px içeride; beğeni sayısı için
  ayrı boşluk bırakılır. Radix içerik tablosunun uzun adlarla listeyi genişletmesi
  engellendi; metin doğal ellipsis kullanır.
- 1431 px masaüstü, 375/320 px mobilde 20 sonuç, uzun radyo adı, ilk/son
  satıra klavyeyle geçiş kontrol edildi. Yalnız sonuç listesi kaydı; sayfa y=0
  kaldı ve yatay taşma görülmedi. İlgili 29 arama testi ve production build geçti.
- Görseller `.local/design-checks/search-layout-desktop.png` ve
  `search-layout-mobile.png`; önizleme verileri yalnız `.local/` içindedir.
  Bu düzeltme henüz canlıya yayımlanmadı.
- Takip yorumu sonrası 16 px üst/alt boşluk kaydırılan içeriğin dışına
  taşındı: sayaç şeridine göre sabit kalır. 320 px sonuç alanında dört adet
  72 px satır tam görünür. Masaüstü ve 375 px mobilde, listenin başında ve
  sonunda eşit 16 px boşluk ölçüldü; 29 arama testi ve build tekrar geçti.
  Son görseller: `search-insets-desktop.png`, `search-insets-mobile.png`.

### Yayın sonrası — satır vurgusunun kaydırma alanına taşması

- Önceki arama, kayıt banner'ı ve footer düzeltmeleri PR #108 ile yayımlandı.
- Son kullanıcı yorumundaki taşma için kaydırma çubuğunun 10 px genişliği ve
  sağdaki 10 px boşluğu, satır viewport'unun dışında bırakıldı. Satırın sağ
  padding'i aynı miktarda azaltılarak beğeni sayılarının hizası korundu.
- 1431 px masaüstü ve 375 px mobilde vurgulu satırın sağ kenarı kaydırma
  çubuğunun sol kenarında bitiyor; çubuğun arkasına veya sağına taşmıyor.
  Üst/alt 16 px boşluk, uzun adların kısaltılması ve son satıra klavyeyle
  erişim korundu. İlgili 29 arama testi ve production build başarılı.
- Bu son düzeltme yereldir; görseller `search-hover-gutter-desktop.png` ve
  `search-hover-gutter-mobile.png` dosyalarında (`.local/design-checks/`).

### Mobil klavye — arama çerçevesinin üstten kesilmesi

- Kullanıcının iPhone ekran görüntülerinde klavye açıkken panelin üst kenarı
  görünür alan dışında kalıyordu. Açık arama artık `visualViewport.offsetTop`
  ve `height` değişikliklerini izler; mobil üst konum ve maksimum panel
  yüksekliği bu alanı ve güvenli ekran boşluklarını kullanır.
- Giriş/sayaç satırları sabit kalırken sonuç listesi kalan yüksekliğe küçülür.
  Header'dan mobil arama açılırken hero'ya ayrıca `scrollIntoView` uygulanmaz.
  Dinleyiciler arama kapanınca veya bileşen kaldırılınca temizlenir.
- Klavye açılış/kapanış ve kayma olaylarının simülasyonunda metin/odak korundu;
  31 arama testi, frontend TypeScript ve production build başarılı.
- Tarayıcıda 375×360 alanda panel y=16–344, 375×812 alanda y=16–427;
  kısa listede son sonuca klavyeyle erişim ve masaüstü düzeni doğrulandı.
  Gerçek iPhone klavyesi bu ortamda çalıştırılmadı. Görseller:
  `search-keyboard-short-viewport.png`, `search-keyboard-full-viewport.png`.
- Önceki satır vurgusu düzeltmesiyle birlikte yerelde hazır; henüz yayımlanmadı.


### İstasyon oynatma ikonları — yerel çalışma

- Figma Web `playing-section` referansları: `1339:3468` (istasyon sayfası),
  `1339:3643` (ayrı bileşen). 50 px yuvarlak düğmeler, 30 px önceki/sonraki/pause
  ikonları ve 20 px masaüstü aralığı doğrulandı.
- Figma MCP okuma kotası dolu olduğu için açık Figma dosyası native UI üzerinden
  incelendi; SVG'ler Export üzerinden alındı. `1339:3654` pause çıktısının path'leri
  mevcut mini-player SVG'siyle aynı. Play için Web `2390:8935` (adı
  `vuesax/bold/next`, görünür şekli yuvarlatılmış play üçgeni) 26 px orijinal SVG
  kullanıldı; `public/icons/playing-section/play.svg` değiştirilmeden kaydedildi.
- `1339:3671` Deezer grubu (Figma katman adı `spotify-logo`) 26 px; işaret
  16 × 10.45 px, x=5/y=7. YouTube/Spotify/Deezer için mevcut Figma vektörleri
  ortak `MusicServiceIcon` üzerinden istasyon sayfası ve mini oynatıcıda kullanılıyor.
- İstasyon sayfası `playing-section` görünümünü kullanır; oynat/duraklat/önceki/sonraki
  ve kalp SVG'leri yuvarlatılmış Figma ailesiyle tutarlıdır. Mobilde mevcut küçük
  kontrol boyutu kullanılarak 375 px ekranın sağında düğmelerin kesilmesi giderildi.
- Yerel gerçek sayfa önizlemesi: `/tr/istasyon/metro-fm?station-preview=1`;
  sadece `.local` fixture'ı, simüle oynatma ve sahte API verisi. Üretime dahil olmaz.
- Oynatma/oy verme/yerelleştirme davranış testleri dahil frontend 140 dosya /
  2032 test geçti; TypeScript kontrolü ve üretim derlemesi geçti. Masaüstü ve 375 px mobilde ikonların
  ölçüleri, oynat/duraklat geçişi ve servis görselleri kontrol edildi.
- Bu çalışma, önceki arama hover ve mobil klavye düzeltmeleriyle birlikte lokalde;
  henüz push/merge/deploy yapılmadı.

### İstasyon ekranı — dikey yerleşim ve parlama düzeltmesi

- Önceki arama ve oynatıcı ikonları PR #109 / `b4198ac5c` ile canlıya alındı.
  Bu bölümdeki takip düzenlemeleri henüz yereldir.
- Güncel Figma `1339:3468` ve `1339:3643`, MCP kotası nedeniyle açık dosyanın
  Properties panelinden yeniden incelendi. Sayfa içindeki alan 1512×351 px;
  logo/içerik grubu `1339:4388` 509×224 px, x=153/y=63.
- `1339:3469` parlama elipsi 521×521 px, x=-64/y=-41, `#114751` %50,
  layer blur 246.09. Repodaki özgün PNG zaten bu katmanın bulanıklığını ve
  351 px sayfa kesimini içeren 704×351 px çıktıdır. PNG'ye elips ölçüleri ve
  offset'leri ikinci kez uygulanıyordu. Varlık değiştirilmeden doğal oranına,
  alanın x=0/y=0 başlangıcına döndürüldü; ışık kontrollerin altına da ulaşır.
- Kullanıcı tercihiyle istasyon kontrol aralığı 20→12 px oldu; mini player
  ve mobil kontrol aralığı değişmedi. Masaüstü alanı 351 px'e toparlandı;
  mevcut 274 px reklam rezervasyonu ve reklam yükleme davranışı korundu.
- İlk denemede bilgi etiketleri ve değerlendirme açıklamanın üstüne taşındı.
  Kullanıcının sonraki geri bildirimiyle aşağıdaki düzeltmede eski sıra geri alındı.
- 1030/1512 px masaüstü ve 375 px mobil önizleme kontrol edildi. Masaüstü
  yüksekliği 351 px, kontrol aralığı 12 px; mobilde yatay taşma yok ve
  oynat/durdur geçişi çalışıyor. Görseller `.local/design-checks/playing-layout-*`.
- İlgili beş dosyada 89 test, frontend TypeScript ve üretim derlemesi geçti.
  Önizleme örnek API verileri ve simüle oynatma kullanır; üretime dahil değildir:
  `/tr/istasyon/metro-fm?station-preview=1` (22508 portu).


### 10 Ekim 2026 — İstasyon bilgileri, içerik reklamı ve header

- Kullanıcı isteğiyle bilgi alanı eski DOM/görsel sırasına döndü: istasyon
  açıklaması → yıldızlar/inceleme → ülke, format, bitrate ve tür etiketleri.
  Önceki kontrol aralığı, parlama ve 351 px çalma alanı düzenlemesi korundu.
- Figma Web masaüstü followers `2035:9886`, menu `2035:10015`, kullanıcı
  grubu `2035:10032` açık Figma dosyasında yeniden incelendi (MCP kotası dolu).
  Kullanıcı adının sol altındaki vurgu 25×5 px, `#FF4199`; avatar 45×45 px.
  Header bu vurguyu kullanır; fotoğrafsız/hatalı fotoğraflı kullanıcılar için
  mevcut `PublicProfileAvatar` ortak bileşeni mobil ve masaüstüne bağlandı.
- Followers referansında zil bulunmuyor. Uygulamadaki mevcut bildirimi koruyan
  uyarlama: masaüstünde ülke → arama → ayırıcı → zil → kullanıcı adı/avatar.
  Bildirim açma, Escape ile kapanma ve mobil profil menüsü doğrulandı.
- İstasyon içerik reklamının desktop AdSense formatı `horizontal` yerine
  `auto`: dar banner şekli zorlanmıyor. Yerleşim içerik konteynerinin tam
  genişliğinde, metin/yaratıcı merkezli ve daralan ins otomatik yan boşluklu.
  Google iframe boyutlarına müdahale edilmedi; premium, görünürlük ve tek
  istek yaşam döngüsü korunuyor. Referans: Google AdSense yardım 9183460.
- 1456 px tarayıcıda içerik reklamı x=152…1304 (1152 px), SDK'nın oluşturduğu
  ins 1152×280 px olarak doğrulandı. Yerelde reklam kreatifi dolmadığından
  gerçek kampanya görseli doğrulanmadı. Nihai kreatif boyutunu Google seçer.
- 375 px mobilde yatay taşma yok; profil menüsü çalışıyor. Masaüstünde
  bildirim paneli ekranda kalıyor. Görseller `.local/design-checks/` altında
  `station-header-review-desktop.png`, `station-header-review-mobile.png`,
  `station-content-ad-review-desktop.png`.
- Frontend 140 dosya / 2032 test, TypeScript ve üretim build geçti.
  Değişiklikler `codex/design` üzerinde yereldir; bu adımda deploy yapılmadı.

### 10 Ekim 2026 — Gerçek verili, salt okunur yerel çalışma

- Tasarım incelemelerinde yeni varsayılan adres:
  `http://127.0.0.1:22509/tr/istasyon/metro-fm`. `station-preview=1` kullanılmaz.
  Gerçek uygulama giriş noktası, footer ve oynatıcı dahil tam sayfa açılır.
- `.local/live-readonly.config.mts` ve `.local/live-readonly-policy.mjs` yalnızca
  bu bilgisayarda kullanılan, Git tarafından yok sayılan geliştirme dosyalarıdır.
  Üretim uygulaması veya veritabanı bağlantısı değiştirilmedi.
- Herkese açık istasyonlar, arama, çeviriler ve yayın bilgisi canlı HTTP API'sinden
  okunur. İzin verilen GET/HEAD yolları dışındaki istekler yerelde engellenir;
  çerez, yetkilendirme başlığı ve istek gövdesi canlıya aktarılmaz.
- Önizleme ziyaretçi olarak çalışır. Favori, oy, yorum, profil değişikliği ve
  dinleme geçmişi yazma istekleri canlıya ulaşmaz. Yerel sayfa analitiği ve gerçek
  AdSense yüklemesi kapalıdır; reklam alanlarının yerleşimi korunur. Radyo yayını
  ve parça bilgisi gerçektir; hesap gerektiren ekranlar bu modun kapsamı dışındadır.
- Başlatma (Node 24 ve pnpm PATH üzerinde, repo kökünden):

  ```sh
  PORT=22509 BASE_PATH=/ pnpm --filter @workspace/megaradio exec vite --config ../../.local/live-readonly.config.mts --host 127.0.0.1
  ```

- Metro FM gerçek kaydı, KRAL FM araması, tam footer, gerçek yayının
  oynatılıp durdurulması ve parça bilgisi doğrulandı. Yazma isteği 405 ile yerelde
  reddedildi; izin listesi kontrolleri geçti. Görseller:
  `.local/design-checks/live-readonly-station.png` ve `live-readonly-footer.png`.
- Eski 22508 fixture ortamı özel durumların tasarım kontrolü için kalabilir;
  günlük inceleme 22509 üzerinden yapılır. Bu geçiş için deploy yapılmadı.

### 10 Ekim 2026 — Diğer sayfalarda Ctrl+K aramasının tasarım uyumu

- Kullanıcı isteği: ana sayfa dışında sayfayı terk etmeden açılan arama penceresi,
  daha önce onaylanan ana sayfa aramasıyla aynı görsel dili kullanır.
- Figma MCP bağlam ve screenshot çağrıları kota nedeniyle sonuç vermedi.
  Referans `591:4887` açık Figma dosyasında yeniden incelendi: 614×393 px,
  20 px köşe, 2 px beyaz kenar ve %20 beyaz dolgu. Uygulamadaki kullanıcı
  onaylı sayaç şeridi, ülke bilgisi ve beğeniler korunarak uyarlama yapıldı.
- `QuickSearchDialog`, `home-search.css` stillerini ve mevcut yerel Figma
  mercek/X/ayırıcı SVG'lerini paylaşır. Ayrı başlık, iç input kutusu,
  klavye yardım şeridi ve tekrar eden çalan istasyon satırı kaldırıldı.
  Erişilebilir diyalog adı/açıklaması, odak kilidi ve Escape ile odak dönüşü korunur.
- Tür/ülke araması ve yerelleştirilmiş bağlantılar korunur. İstasyonlarda
  beyaz Ubuntu metni, ülke bayrağı ve ortak K/M beğeni biçimi kullanılır.
  API'nin döndürdüğü 20 sonuç da kaydırılabilir; Radix ScrollArea, üst/alt
  16 px boşluk ve satır vurgusundan ayrılmış kaydırma alanını kullanır.
- Mobil klavye görünür alanı mevcut viewport hook'u ile takip edilir.
  1456 px masaüstünde panel 614 px; 375 px mobilde 343 px ve yan boşluklar
  16 px. 375×360 kontrolünde çerçeve y=16…344 arasında kaldı ve End tuşuyla
  20. sonuca erişildi. Bu kontrol fiziksel iOS klavye testi değildir;
  viewport kayması ve dinleyici temizliği ayrıca davranış testiyle doğrulandı.
- 63 arama/ülke testi, frontend TypeScript ve üretim build geçti. İlk tam
  test çalışmasındaki jsdom ResizeObserver eksikliği ilgili testlerde giderildi;
  başarısız iki test dosyası yeniden çalıştırılıp geçti.
- Gerçek veriyle önizleme: `http://127.0.0.1:22509/tr/istasyon/kral-turk-fm`.
  Görseller `.local/design-checks/quick-search-glass-{desktop,mobile,short-viewport}.png`.
  Değişiklikler yereldir; deploy yapılmadı.

### Arama penceresi — masaüstü dikey konum

- Kullanıcının geri bildirimiyle masaüstü üst boşluğu %7'den görünür yüksekliğin
  %20'sine alındı; 96–220 px arasında sınırlandırılır. Bu değer evrensel bir
  standart iddiası değil, mevcut panel için seçilen yerleşimdir. İncelenen
  örnekler: Tailwind'in resmi komut penceresi örneği
  (`https://tailwindcss.com/blog/vanilla-js-support-for-tailwind-plus`) ve
  Mantine Spotlight (`https://mantine.dev/x/spotlight/`).
- 1456×853 ekranda üst kenar 59.7→170.6 px oldu; sonuçlar açılınca giriş
  yeri değişmez. Sonuçlu panelin alt kenarı 597.6 px olarak doğrulandı.
  Mobilde mevcut 16 px güvenli boşluk ve klavye takibi aynen korunur.
- Üretim derlemesi geçti. Görsel:
  `.local/design-checks/quick-search-position-desktop.png`. Henüz yayımlanmadı.

### 10 Ekim 2026 — Favoriler genişlik denemesi geri alındı

- Kullanıcı dar görünümü beğenmedi; Favoriler önceki tam genişlik düzenine döndü.
  250 px sabit sol menü, 30 px dış boşluk, geniş ekranda üç sütun ve profil
  mini player offset'i geri getirildi. Ortalanmış genişlik denemesi yayımlanmadı.
- 22508'deki yerel test hesabında gerçek radyolarla görsel önizleme korunur;
  bu liste kullanıcının kişisel favorileri değildir.

### 10 Ekim 2026 — Profil ayarları Figma Web düzeni

- Referanslar: Web/profile `2035:9624` (1512×1428), mobil profile `2129:7343`
  (375×1244). MCP kotası nedeniyle açık Figma dosyası ve Properties paneli
  kullanıldı. Oynatma kartı `2035:9625`: 587×415 px, 10 px radius, #151515.
- Tam genişlik ve 250 px sol menü korundu. Sade Profil başlığının altında
  breadcrumb, yuvarlak avatar/yatay kimlik kartı ve eşit iki ayar paneli var.
  Otomatik oynatma checkbox, oynatma seçenekleri pembe radyo kontrolleri;
  sağ kartta ülke, dil ve herkese açık profil ayarı bulunuyor.
- Ad, e-posta, parola, bildirim ve mevcut abonelik kontrolleri aynı kart
  diliyle aşağıda korunur. Avatar yükleme, taslak koruma, kaydet/iptal ve
  anlık bildirim işlemleri mevcut sözleşmeleriyle çalışır.
- Figma Frame 168 (`2035:9638`; dışa aktarılan SVG düğüm kimliği `2035:9649`)
  özgün vektörü `public/icons/profile/listening-activity.svg` olarak alındı.
  Masaüstü istatistik şeridi hesap API'sindeki dakika cinsinden dinleme süresi
  ve favori sayısını gösterir. API'nin sağlamadığı değerler “—”; Figma'daki
  örnek radyo/şarkı sayıları eklenmedi. Mobil referansta bu şerit görünmez.
- Yeni metinler 14 dile eklendi. 375, 1030 ve 1512 px genişliklerde yatay
  taşma yok. 1512 px'de kart başlangıcı x=280, sağ boşluk 30, iki panel
  586×415 px; ek breadcrumb nedeniyle referanstan dikey fark bilinçli.
- Profil testleri 39/39; frontend typecheck ve üretim derlemesi geçti.
  Derlemede mevcut büyük chunk uyarıları sürüyor. Yerel önizleme
  `http://127.0.0.1:22508/tr/profil/ayarlar`; bu değişiklik yayımlanmadı.
- Görseller: `.local/design-checks/profile-settings-desktop.png`,
  `profile-settings-mobile.png`, `profile-settings-mobile-details.png`.


### Profil takip listeleri — 10 Ekim 2026

- Figma dosyası tarayıcıda yeniden doğrulandı: Web followers `2035:9886`,
  follows `2038:10444`; mobil follows `2131:10413` (katman adı followers).
  MCP Starter kotası nedeniyle açık Figma dosyasının ölçüleri kullanıldı.
- Profil ayarlarındaki sayaçlar `/profile/followers` ve `/profile/following`
  sayfalarına gider. Yerelleştirilmiş yollar, tam genişlik profil kabuğu,
  pembe aktif sekme, yuvarlak avatar ve masaüstü 130 px satırlar kullanılır.
  Mobilde satırlar kompakt, eylem hedefleri en az 44 px'dir.
- Kimlikler ve takipçi sayıları PostgreSQL ilişkilerinden gelir; isim/avatar
  mevcut herkese açık profil yoluna bağlanır. Yeni GET
  `/api/user-engagement/connections/:direction` yalnızca oturum sahibinin
  listesini döndürür, sayfalanır ve `no-store` kullanır.
- Takipçilerde Kaldır gelen ilişkiyi, takip edilenlerde Takibi bırak giden
  ilişkiyi siler. Silme sonrası sayfalama başa alınır ve hesap sayaçları ile
  açık profil önbellekleri yenilenir. Hata, boş liste ve hesap değişimi ayrıdır.
- 22508 tasarım sunucusundaki örnek dinleyiciler yalnızca Git dışındaki
  `.local/profile-preview.config.mts` içindedir. Canlı hesaplar değiştirilmedi.
- Doğrulama: frontend tüm testleri (2043), ek yerelleştirilmiş rota ve liste
  kontrolleri (365), backend takip rotası testleri (9), kütüphane/frontend/API
  typecheck ve frontend build başarılı. 1512 px ve 375 px görsel kontrolü yapıldı.
  Kanıtlar `.local/design-checks/profile-followers-desktop.png` ve
  `profile-following-mobile.png`. Deploy yapılmadı.


### Tek profil ekranı — 10 Ekim 2026

- Esas profil `/profile/settings` (TR `/tr/profil/ayarlar`). Eski
  `pages/profile.tsx` panosu kaldırıldı; yalnızca dil, sorgu ve hash korunarak
  `replace` yönlendirmesi yapar. Profil kabuğu ve oynatıcı yeniden kurulmaz.
- Profil breadcrumb'ı doğrudan bu adrese bağlanır. Esas profilde
  `Ana Sayfa > Profil`, alt ekranlarda `Ana Sayfa > Profil > ...` gösterilir;
  istemci ve SSR breadcrumb hedefleri aynıdır.
- Takip/favori/dinleme özetleri mevcut yeni profilde zaten vardır. Eski
  panonun mükerrer listeleri ve gerçek haftalık veriye dayanmayan sayaçları
  taşınmadı. Şifre ekranı ve bildirimlerdeki eski profil bağlantıları düzeltildi.
- Doğrulama: 399 frontend testi, 14 SSR breadcrumb testi, frontend typecheck
  ve build başarılı. Masaüstünde eski adres ve breadcrumb tıklaması; mobilde
  takip listesinden breadcrumb ile dönüş tarayıcıda doğrulandı.
  Görseller: `.local/design-checks/single-profile-desktop.png` ve
  `single-profile-mobile.png`. Değişiklikler lokalde, deploy yapılmadı.


### Gerçek dinleme süresi — 10 Ekim 2026

- `useGlobalPlayer` dinleme kaydını `useListeningHistory` üzerinden yürütür.
  Süre `playing` sonrası medya saatinin ilerlemesinden hesaplanır; başlangıç
  yüklemesi, duraklatma ve buffering sayılmaz. Her 30 saniyede, duraklatma,
  istasyon değişimi, görünürlük kaybı ve `pagehide` sırasında tam saniyeler kaydedilir.
- Gönderilmeyen kayıtlar localStorage'da kayıt başına ayrı anahtarla saklanır.
  Ağ dönüşü/yeniden açılış aynı kimliği yeniden gönderir. Hesap kimliği hem
  istemcide hem sunucuda denetlenir; geçmiş dinleme başka hesaba taşınmaz.
  Cookie ve OAuth Bearer aynı yetkili taşıma katmanını kullanır.
- `postgres-listening-store.ts` geçmiş ve toplam güncellemesini aynı transaction'da
  yapar. Kullanıcı satır kilidi eşzamanlı cihazları, kullanıcı+kayıt hash'i tekrar
  gönderimleri korur; istasyon birleştirme kilit sırası korunur.
- Mevcut `users.source` içinde `listeningTotalSeconds` ve dakika sözleşmesini
  sürdüren `totalListeningTime` saklanır. İlk kayıtta geçmiş `listen` satırlarının
  toplamı ile eski dakika değerinden büyük olan başlangıç kabul edilir; iki eski
  gösterim toplanmaz. Recommendation `play` olayları tekrar dinleme sayılmaz.
  `/api/auth/me` ilk yeni kayıt öncesinde de mevcut gerçek geçmişten toplamı okur.
  Başarılı yeni kayıt profil sorgu önbelleğini günceller; ekranda saat/dakika görünür.
- Yayına çıkarken **önce API, ardından web** güncellenmeli. Bu iş yalnızca frontend
  deploy'u ile tamamlanmaz. Şema migration'ı gerekmez. Eski mobil kayıt gövdeleri
  desteklenir; yeni tekrar-gönderim güvencesi `recordId` kullanan istemciler içindir.
- Doğrulama: tüm frontend testleri; dinleme, profil ve oynatıcı yaşam döngüsü
  odak testleri; 28 API/PostgreSQL testi (10'u ayrı yerel PostgreSQL'de, sıfır skip);
  libs/frontend/backend typecheck ve frontend build. Üretim veritabanına yazılmadı.
  Test kayıtları `.local/listening-*-tests.log`; henüz deploy yapılmadı.
- Gerçek cihazda iOS uygulamanın zorla kapatılması testi yapılmadı. Son 30 saniyenin
  `pagehide` öncesi tarayıcı tarafından öldürülmesi gibi olay üretmeyen kapanışlar
  garanti edilemez; periyodik kayıtlar ve kalıcı bekleyen kuyruk kaybı sınırlar.


### Messages — 10 Ekim 2026

- Güncel Figma Web `messages` frame’i `1339:5867` (1512×966) incelendi.
  MCP okuma kotası dolu olduğundan açık Figma dosyasının Properties panelinden
  ölçüler, renkler ve tipografi doğrulandı: sohbet sütunu 289 px / #1B1B1B;
  içerik #0E0E0E; balon #3F3F3F, 10 px radius, Ubuntu Medium 14 px;
  alt bant #272727 / 119 px, giriş #3A3A3A / 54 px ve 4 px radius.
- `messages.tsx` ve sayfaya özel `messages.css`: nötr seçili satırlar, balonların
  üst köşe kuyrukları, altta hizalanan kısa sohbetler, emoji ve kare Mega pembe
  gönder düğmesi. Var olan Figma ikon ailesinden gönder simgesi tekrar kullanıldı.
- Kişiler sekmesi, bağlantı/çevrim içi durumu, zaman ve okundu bilgisi, görsel
  ekleme tasarım diline uyarlandı. API, WebSocket, hesap izolasyonu, eski mesaj
  yükleme, IME, bildirim ve oynatıcıya göre yükseklik hesaplama mantığı korundu.
- 1512×966 masaüstü, 390×844 mobil ve 390×420 daralan ekran kontrolü yapıldı.
  Kişi arama, boş/dolu sohbet, geri dönüş, metin ve emoji gönderme yalnızca
  `.local/profile-preview.config.mts` içindeki bellekte tutulan örnek sohbetlerle
  doğrulandı; gerçek kullanıcılara mesaj gönderilmedi. Gerçek iOS klavyesi yerine
  daraltılmış viewport ve mevcut visualViewport testleri kullanıldı.
- 23 mesajlaşma/hesap izolasyonu/responsive testi, frontend typecheck ve build
  başarılı. Görseller: `.local/design-checks/messages-desktop.png` ve
  `messages-mobile.png`. Bu aşamada deploy yapılmadı.

### Mesajlar: Emoji / GIF ve yerel görsel yükleme — 10 Ekim 2026

- Emoji düğmesi içinde klavyeyle erişilebilir Emoji/GIF sekmeleri, gecikmeli
  arama, sayfalama, tekrar deneme, gönderim önizlemesi ve iptal eklendi.
  GIF seçimi tek başına mesaj göndermez. Nötr yüzeyler, Ubuntu ve Mega pembe
  seçim çizgisi mevcut mesajlar tasarımıyla aynı. 18 dilde medya durum metinleri var.
- KLIPY hesabı ve `MegaRadio-Web` anahtarı kullanıcı onayıyla oluşturuldu.
  Monetization **OFF**, anahtar **TESTING** (100 API isteği/saat).
  Anahtar yalnızca Git dışındaki `artifacts/megaradio/.env.local` dosyasında
  `VITE_KLIPY_API_KEY` olarak bulunur. Bu, tarayıcıda kullanılması amaçlanan bir
  uygulama anahtarıdır; hesap oturum anahtarı değildir.
- [KLIPY entegrasyon şartları](https://docs.klipy.com/integration-requirements)
  uyarınca API ve medya doğrudan istemciden gelir. Kaynak sırası ve medya URL’leri
  korunur; dosyalar yeniden barındırılmaz. Arama alanında gereken `Search KLIPY`
  atfı var. Oturum token’ı, hesap kimliği veya sohbet içeriği servise gönderilmez.
- Veritabanındaki mevcut text alanları kullanılır; migration yok. `gif` mesajının
  `imageUrl` alanı yalnızca `klipy:<slug>` kabul eder. Geçmiş açılınca Items API ile
  güncel medya çözülür. Search slug’ındaki teslimat eki Items yanıtında kaldırılabilir;
  istemci tek öğe çözümlemesini destekler, kaydedilen kimliği değiştirmez.
- Yerel 22508 tasarım API’sinde eksik multipart yükleme yolu eklendi. PNG/JPEG/GIF/
  WebP imzası ve 5 MB sınırı doğrulanır; görseller `.local/chat-images/` altında
  saklanır. Test sohbetleri bellektedir, gerçek kişilere mesaj göndermez.
  Gönderim başarısızsa görsel önizlemesi korunur; sohbet değişirse bekleyen yükleme
  yeni sohbete gönderilmez. 22509 salt okunur gerçek veri sunucusu hâlâ yazma testi için değildir.
- 390×844 mobil ve 390×420 daralmış viewport kontrol edildi. Klavye alanı küçülünce
  açık seçici geçici olarak geçmişin yerini kullanır; arama ve gönder kontrolleri görünür kalır.
  Gerçek iOS klavyesi bu ortamda test edilmedi.
- Yayın sırasında backend GIF desteği ve frontend birlikte çıkarılmalı;
  `VITE_KLIPY_API_KEY` frontend build ortamına eklenmeli. Genel kullanıma açmadan önce
  [KLIPY Partner Panel](https://partner.klipy.com/api-keys) üzerinden üretim erişimi
  başvurusu gerekir; üretim onayı bu çalışmada alınmadı. Deploy yapılmadı.
- Doğrulama: 31 frontend ve 9 backend mesajlaşma testi, paylaşılan kütüphaneler/
  frontend/backend typecheck ve frontend build başarılı. Gerçek KLIPY araması,
  GIF gönderimi ve geçmişten tekrar çözümleme ile yerel dosya yükleme tarayıcıda
  doğrulandı. Görseller: `.local/design-checks/messages-gif-{desktop,mobile}.png`.

### Profil ve mesajlar yayın hazırlığı — 10 Ekim 2026

- Önce geriye uyumlu API (dinleme toplamları, bağlantı listeleri, GIF mesaj
  doğrulaması), ardından yeni web arayüzü yayınlanır. Şema değişikliği yoktur.
- KLIPY üretim erişimi henüz onaylanmadığından test anahtarı yayına taşınmaz.
  Anahtar tanımlanmamış derlemelerde GIF sekmesi gizlenir; emoji ve görsel
  yükleme kullanılabilir. Yerel GIF testi mevcut `.env.local` ile devam eder.
- 2.198 frontend testi ve tip kontrolleri başarılı; ek anahtarsız emoji kontrolü
  dahil 7 GIF testi başarılı. Değişen API yollarındaki 378 test, dinleme toplamları
  için yalnızca yerel PostgreSQL üzerinde eşzamanlı kayıt/tekrar/geri alma
  senaryoları dahil geçti. SPA, API ve web sunucusu üretim derlemeleri başarılı.
- Geniş API paketi: 2.815 geçti, 24 başarısız, 11 atlandı. Aynı 24 başarısız
  durum `origin/main` kaynaklarının ayrı kopyasında yeniden üretildi; yeni
  başarısızlık yok. Yerel genel test veritabanı `127.0.0.1:22512/radiohub_test`;
  PostgreSQL `pg_trgm` uzantısı test şemalarından bağımsız public şemada kurulur.

## Sohbet davranış sözleşmesi (10 Kasım 2026)

Kullanıcı, birebir sohbette onaylanan tüm mesaj etkileşimlerinin grup sohbetinde
ayrıca talep beklemeden kullanılmasını istedi. Ortak menü ve silme onayı,
cevaplama/kopyalama/sabitleme, çoklu seçim, kişisel veya herkesten silme,
son mesaja dönme oku ve geçmiş kaydırma davranışları aynı bileşenleri kullanır.
Değişikliklerde iki sohbet türünü birlikte kontrol et. Yeni bir grup tasarımı veya
ayrı bir etkileşim modeli oluşturma. Kalıcı kural AGENTS.md içinde de kayıtlıdır.

Uygulama notu: mobil `messages.tsx` ve `group-chat.tsx` artık
`useChatMessageMenu`, `useChatHistoryScroll` ve `ChatThreadControls` bileşenlerini
ortak kullanır. Mevcut `ChatMessageActions`, `ChatDeleteConfirmation` ve
`ChatScrollIndicator` grupta da kullanılır. Grup servisinde cevap, pin, kişisel
silme ve gönderene ait herkesten silme kalıcıdır; socket değişiklikleri eski
sayfalara da uygulanır. `0048_chat_group_message_actions.sql` grup mesajlarına
ilgili alanları ve indeksleri ekler. Önizleme mağazası aynı verileri saklar.
Grup UI akışları ve birebir menü regresyonu tarayıcıda; cevap/pin/gizleme/silme
ve üyelik/katılım sınırları ayrı, geçici bir PostgreSQL kümesinde doğrulandı.
Üretime şema uygulanmadı ve API yayını yapılmadı; gerçek hesaplar için API ile
0048 şema güncellemesi birlikte yayına alınmalıdır.

### Sohbette ihtiyaca göre mini player (10 Kasım 2026)

`useChatInlinePlayerVisibility`, birebir ve grup sohbetinin FlatList görünürlük
verisini kullanır. Çalan istasyonun kartı görünürken floating player gizlenir;
kart görüş alanından çıkınca görünür, geri dönünce gizlenir. Güncel mesajlardan
türetilen görünürlük silinen/gizlenen mesajları da dikkate alır. Player konumu
gizlenirken korunur. Logo baskın rengi soldaki yumuşak zemine ve ince çerçeveye
uygulanır. Taşıma eğitimi yalnızca player gerçekten görünür olduğunda sayılır;
istek üzerine yeniden başlatılabilir. Mock ses bağlamıyla grup önizlemesinde
çıkış/geri dönüş doğrulandı; görünürlük, taşıma, eğitim, favori ve ses toggle
regresyonları geçti. Kullanıcının sohbeti veya gerçek ses oturumu değiştirilmedi.

### Özel sohbette radyo keşfi (10 Kasım 2026)

Özel sohbet header'ındaki keşif düğmesi önce `PrivateRadioDiscovery` ile geçici
müzik/ruh hâli seçimi açar (1–3 seçim; Aşk dahil). Aynı `GroupMusicStyles`
seçim görselleri ve `GroupRadioDiscovery` ger-bırak/dinle/onayla akışı kullanılır.
Seçim her yeni açılışta sorulur; keşif içinde Değiştir ile düzenlenebilir. Karşı
kullanıcı veya grup profili değiştirilmez. Aşk havuzu gerçek katalogdaki love
ve romantic sorgularını birleştirir; alakasız türler eşleşmez. Keşif geçmişi
ortaktır; sohbette önceden paylaşılan istasyonlar da geçmişe alınır.

Ön dinleme presence yayınlamaz; Beğendim, paylaş açıkça seçilince mevcut özel
mesaj servisiyle station mesajı gönderilir ve dinleme presence'ı o mesaja
bağlanır. Takip/mesaj izni, yinelenen gönderim kilidi, sohbet değişimi ve hata
durumları korunur. Tür kapısı, oturum sıfırlama, katalog eşleşmesi ve ortak
keşif paylaşım regresyonları kontrol edildi. Tarayıcı önizlemesi gerçek
katalogla kontrol edildi; testte gerçek kullanıcıya mesaj veya ses gönderilmedi.

### Higgsfield ile özel keşif girişi (10 Kasım 2026)

Kullanıcı küçük seçim modalını yetersiz buldu ve Higgsfield desteğini açıkça istedi.
Higgsfield GPT Image 2.6 ile ekran konsepti ve ayrı dünya materyali üretildi;
job kimlikleri `output/higgsfield-group-discovery/private-entry-higgsfield-provenance.json`
içinde kayıtlıdır. Üretilen dünya doğrudan mobil
`assets/images/chat/discovery-world-higgsfield.png` dosyasında kullanılır.
`PrivateDiscoveryHero` hafif hareketi azaltılmış hareket tercihine göre durdurur.

Giriş artık küçük ayar kutusu yerine tam ekran, 'Tarzınızı bulun' başlıklı
bir keşif sayfasıdır. Dünya/ülke izleri, açıklayıcı metin ve 'Dünyayı keşfet'
düğmesi ger-bırak ekranına geçişi anlatır. Gerçek marka işareti/wordmark,
kapatma ikonu ve 1–3 seçim davranışı korunur. Grup seçimleri aynı kompakt
stilde kalır; özel giriş yalnızca ortak bileşenin discovery görünümünü kullanır.
430×850 ve 375×667 önizlemeleri, düzenleme ve sonraki ekrana geçiş kontrol edildi.
Küçük cihazda seçim alanı kayar; alt eylem ve kapatma düğmesi görünür kalır.

#### Özel keşif girişi — final kontrolü

Kullanıcının onayladığı yerleşim korunarak 430×932 ve 320×568 boyutlarında
seçim, seçim kaldırma, boşta kilitli eylem, üçlü sınır, kayan tür alanı ve sabit
alt eylem kontrol edildi. Uzun kullanıcı adı 272 px alanda ellipsis ile kısalır;
kapatma çalışır. Dünya ve bayrak görselleri yüklendi. Üç dekoratif bayrak artık
uygulamaya gömülüdür (discovery-flag-tr/jp/br.png); dış servis gerektirmez.
Azaltılmış hareket tercihinde dünya kayması sıfır konumuna döner. Geçici QA
sayfası kaldırıldı. Gerçek kullanıcı mesajı gönderilmedi veya ses başlatılmadı.

### Özel keşif açılış performansı (10 Kasım 2026)

Onay sonrası beklemenin nedeni katalog ve en fazla 54 logo doğrulamasının
bitmesinden önce kürenin hiç çizilmemesiydi. `radioDiscoveryQuery` ortak
sorgu seçenekleriyle tür seçimi sırasında 180 ms gecikmeli ön hazırlık başlar;
onay ekranı aynı hesap/tür/yenileme anahtarını ve devam eden isteği kullanır.
Sıfır seçimde hazırlık yapılmaz. Hızlı seçim değişimlerinde bekleyen zamanlayıcı
temizlenir. Hesap ayrımı, geçmişten eleme ve exhaustion/refill anahtarı korunur.

Küre ve cetvel katalogdan bağımsız hemen görünür. Veri hazır değilken alt alanda
kısa hazırlık bilgisi verilir; erken ger-bırak isteği tek sefer saklanır ve
doğrulanmış deste gelince uygulanır. Carousel görünür olduktan sonra kaydırma
başlatılır; azaltılmış harekette sıfır süreli animasyon da commit kaybetmez.
Hata durumunda bekleyen çekiş temizlenir. Logo/kırık yayın eleme ve ülke
çeşitliliği kontrolleri kaldırılmadı. Ön hazırlık ses açmaz veya mesaj göndermez.

Yerel aynı Rock+Elektronik senaryosunda onaydan kürenin görünmesine kadar
önce 1912 ms, sonra 272 ms ölçüldü; bunlar ağ/cihaz garantisi değildir. İkinci
ölçüm sırasında arka plan hazırlığı sürüyordu ve sonrasında normal tamamlandı.
Sorgu paylaşımı, taze önbellek, hesap/yenileme ayrımı, erken çekişin tek commit
olması ve hata sonrası eski çekişin oynatılmaması test edildi. Özel seçim,
katalog, geçmiş ve paylaşım regresyonları geçti. Değişen dosyalarda TypeScript
hatası yok; projenin 523 mevcut genel hatası değişmedi.

### Keşifte yönlü germe ve bütünleşik esneme (10 Kasım 2026)

`WorldRadioDial` bırakma callback'ine left/right yönünü aktarır; eski CarPlay
callback'leri ek argümanı kullanmaz, varsayılan hareket katsayısı .18 kalır.
Sohbet keşfi .85 katsayıyla görünür bir çekiş alır. Sağ çekiş negatif carousel
mesafesine, sol çekiş pozitif mesafeye dönüşür; negatif indeksler güvenle
normalize edilir. Ön yükleme sırasında bekleyen çekiş yönü de korunur.

`discoveryPullMotion` bütün küre, gerçek marka işareti/wordmark, dalgalar ve
sonuç kartlarının aynı hareketi kullanmasını sağlar. En fazla %18 yatay
esneme, %7.5 dikey sıkışma, 20 birim yatay ötelenme ve 3 derece yatış
uygulanır. Birim ölçeği küçük ekranlarda korunur. Yaylanma mevcut tuner
spring'inden gelir; azaltılmış hareket tercihinde çekiş deformasyonu yoktur.

Yönün gesture callback'inden signed carousel adımına aktarılması, negatif
sarma, bekleyen sağ çekiş ve küçük ekran/reduced motion senaryoları test
edildi. Sessiz UI önizlemesinde gerçek sağ çekişte gövde matrisi yaklaşık
1.146 yatay / .969 dikey ölçek ve +13.9 ötelenme verdi; carousel matrisleri
her iki kayma yönünü doğruladı. QA ses bağlamı radyo başlatmadı, mesaj
göndermedi. Geçici sayfa ve kendine ait QA keşif geçmişi kaldırıldı.

### Keşif hareketinin sadeleştirilmesi — CarPlay referansı (10 Kasım 2026)

Kullanıcı önceki %18 yatay esnemeyi küre için fazla oval buldu. Son durum bu
bölümdür: `discoveryPullMotion` en fazla 14 birim yatay direnç ve %1.2
tekdüze ölçek verir; kürede ayrı scaleX/scaleY veya dönme yoktur. Sohbet
tuner hareket katsayısı CarPlay gibi .18'dir. Logo destesi de yalnızca
yatay ötelenir. Sağ/sol bırakma yönü ve erken çekişin yönü korunur.

Dialog, başlık, aura ve blur düzlemlerinden tuner transformları kaldırıldı.
`GroupDiscoveryDeck`, CarPlay `carouselGeometry` hesabını kullanır; 3D
perspective/rotateY ve dikey kart sıçraması yoktur. Logo rengi ara kartların
her geçişinde değişmez; audition'ın yerine oturan istasyonu için güncellenir.
Radyo adı iki satırlık 60×unit alanda durur. İlk talimat ve sonuç adı+kontrol
alanları eşit yüksekliği, karar alanı da en az 116 px yüksekliği korur.

Sessiz fixture ile ilk küre, kısa ad ve uzun ad aşamalarında dialog y=133.75,
yükseklik=664.5 px ölçüldü (430×932). Gerçek ger-bırak sırasında da dialog
transform:none ve aura transform:none kaldı. Fixture ses veya mesaj
göndermedi; geçici sayfa ve QA geçmişi kaldırıldı. Yön, yuvarlak form,
geçmiş, ön hazırlık, sabit başlık ve glow'un son istasyonda kalması
regresyonları geçti. 523 mevcut genel TypeScript hatası değişmedi; bu
değişikliğin dosyalarında hata yok.

### Keşifte gerçek yayın sağlığı — hızlı ve sınırlı kontrol (10 Kasım 2026)

Önceki sohbet keşfi gerçek logo ön yüklemesi ve sunucu excludeBroken/lastCheckOk
filtrelerini kullanıyordu; canlı decoder testi yalnızca CarPlay akışındaydı.
Bu nedenle sağlıklı görünen ama gerçekte açılmayan yayın seçilebiliyordu.

`DiscoveryRadioVerifier` aynı `verifyWorldRadio` kontrolünü en fazla iki
sıradaki adayda, sessiz ve paralel çalıştırır. Tüm 54 radyo decode edilmez.
Başarı 15 saniye, başarısızlık 120 saniye geçerlidir; karantina ID, isim/ülke ve
yayın aliaslarını kapsar. Başarılı kayıt platform/kalite/yayın ve logo
imzasına bağlıdır. Seçilen adaya öncelik verilir; gerekiyorsa eski spekülatif
kontrol iptal edilir. Bir kontrol 5 saniyede sonlanır; geçersiz/iptal edilmiş
sonuçlar yayımlanmaz. Kapanma ve AppState arka planında kontroller durur.

Tuner animasyonu ve ekran açılışı kontrolü beklemez. Hazır adaylar, ülke
çeşitliliğini ve tekrar etmeme kuralını bozmadan tercih edilir. Kontrolden
geçmeyen aday ana oynatıcıya verilmez. Gerçek oynatma isteği de başarısızsa
en fazla bir alternatif otomatik denenir; tüm başlangıç isteğine 8 saniyelik
bütçe uygulanır. Kullanıcının durdurması/başka istasyona geçmesi yayın
arızası sayılmaz. İlk soğuk kontrol hâlâ gerçek ağ süresine bağlıdır.

`startDiscoveryPlayback`, birebir ve grupta oynatma çağrısının dönmesini
yeterli saymaz; aynı istasyonun gerçek playing/error durumunu dinler.
Zaman aşımı/iptalde bekleyen başlangıç durdurulur, sonradan kendiliğinden
çalmasına izin verilmez. Zaten çalan aynı istasyon pause toggle'ına düşmez.
Paylaş ancak başarılı dinlemeden sonra açılır; sonradan hata veren yayın da
karantinaya alınır. Yeni radyo mesajlarında eski favicon yerine merkezi
getStationLogoUrl ile keşifte doğrulanan optimize logo kullanılır.

Gerçek yerel tarayıcıda iki sessiz decoder kontrolü: Radio Swiss Jazz AAC192
1483ms, KEXP90.3 2306ms, hazır kayıtların tekrar alınması 0ms. Kasıtlı bozuk
adres reddedildi. Bu ölçümler ağ/SLA garantisi değildir; ana oynatıcı veya
gerçek kullanıcı mesajı başlatılmadı. Kanıt: output/higgsfield-group-discovery/
discovery-live-health-check.json. Testler: logo/placeholder/yükleme hatası,
eski sağlık kaydı, playlist URL sabitleme, ikili sınır, öncelik/iptal/TTL,
gerçek oynatıcı olayı, paylaşım kilidi, tek alternatif ve başlangıç bütçesi.
Geçici QA sayfası kaldırıldı; üretim yayını veya şema değişikliği yapılmadı.

### 2026-11-10 — Ger bırak logo hareketinin anında başlaması

Keşif logo destesi ilk bırakmadan önce görünmez ve etkileşimsiz hazırlanır.
Normal bırakma artık React state/effect veya JS köprüsünü beklemeden UI
worklet üzerinden carousel hareketini başlatır. Yönlü hedefler önceden
hesaplanır; ilk karede belirgin hareket için keşifte cubic-out kullanılır.
CarPlay varsayılan eğrisi korunur. Azaltılmış hareket ve klavye yolu korunur.
Radyo/logo doğrulaması, geçmiş ve ülke çeşitliliği kuralları değiştirilmedi.

Doğrulama: discovery-release-start, group-discovery-commit,
discovery-pull-motion ve radio-discovery-warmup testleri geçti. Gerçek
tarayıcıda fiziksel sürükleme ile logo sonuç ekranına geçiş doğrulandı;
ana ses oynatıcısı veya mesaj gönderimi başlatılmadı. Geçici QA rotası ve
kendi QA geçmişi temizlendi. Ekran kanıtı: output/higgsfield-group-discovery/
discovery-immediate-release.png.

### 2026-11-10 — Sohbet kartlarında logo rengi ve nötr mini player şeridi

ChatFloatingMiniPlayer üst taşıma/boyut şeridi iki görünümde de nötr #222222;
logo rengi yalnızca alt oynatıcı gövdesinde başlar. Tüm çerçevedeki yoğun
renk nötr ince çerçeveye alındı. ChatRadioCard ortak bileşeninde logo baskın
rengi soldan başlayıp %62 genişlikte tamamen söner; orta geçiş %26'da düşük
yoğunluktadır. Sağdaki kalp/play alanı nötr kalır.

Birebir ve grup prop'larıyla gerçek ortak kart, aynı gerçek FM4 logosundan
#ffe501 rengi üreterek tarayıcıda doğrulandı; normal ve kompakt oynatıcı üst
şeridi de nötr. Ses veya gerçek mesaj gönderimi başlatılmadı. Geçici QA
rotası kaldırıldı. Önizleme: output/higgsfield-group-discovery/
chat-logo-color-refinement.png.

### 2026-11-10 — Konuşma listesi kaydırma, arşiv ve kişisel sohbet işlemleri

Mobil app/messages ortak ChatInboxSwipeRow kullanır. Sola kaydırma Diğer ve
Arşivle/Çıkar seçeneklerini açar; bir satır açılınca diğeri kapanır. Yatay
niyet yakalanır, dikey kaydırma listeye bırakılır. Web'de sürükleme ardından
sentetik click ayrıca engellenir. Basılı tutma ve sağ tık alternatifleri vardır.
Menü: sessize al/aç, okunmadı/okundu, temizle, birebirde sil; grupta ayrıl
(davetliyse reddet), ayrıldıktan sonra sil. Temizleme/silme/ayrılma onaylıdır.
Arşivlenenler satırıyla arşive erişilir ve konuşma geri çıkarılır.

Sunucu: auth, hedef ilişkisi/üyelik ve grup silmeden önce ayrılma denetimli
GET/POST /api/messages/inbox-state. Flag'ler kullanıcıya özeldir. Temizle/sil
mesaj payload'ına dokunmadan yalnızca aktörü hidden_for dizisine ekler.
DM gönderme ile silme aynı advisory transaction kilidini kullanır; sonraki
yeni mesaj silinen konuşmayı geri getirir. Sessiz hedeflere push gönderilmez.
Okundu işareti gerçek read durumunu, bildirim önbelleğini ve socket'i günceller.
İşlem actor socket'ine yansır; sorgular geçersizleştirilir. Ayrılan grup üyeleri
left_at ile sınırlandırılmış geçmişi salt okunur görür, gönderemez; son yönetici
ayrılınca mevcut yönetici devri korunur. Eski left üyeler için güvenli tarih
backfill'i vardır. Önizleme flag/kesim tarihlerini ayrı kullanıcı storage'ında
tutar; demo mesaj birleştirmesi temizlenen geçmişi geri getirmez.

Migration: 0049_chat_inbox_actions.sql ve journal kaydı. Üretime uygulanmadı;
gerçek hesaplarda endpoint ve migration birlikte yayınlanmalıdır. Gerçek
PostgreSQL entegrasyonu çalıştırılmadı; 28 backend mock/route testi ile
yetki, SQL sınırları, işlem ve leave davranışları kontrol edildi. API typecheck
geçti. Mobil inbox action/gesture ve inbox list testleri geçti; dokunulan
dosyalarda TypeScript hatası yok (projede önceden var olan genel hatalar var).
Gerçek tarayıcıda swipe, birebir/grup menüsü ve silme onayı gözlendi; arşiv
yenilemede korundu ve deneme arşivlemesi geri alındı. Kullanıcının hiçbir
mesajı silinmedi, grubundan ayrılınmadı ve mesaj gönderilmedi.
Kanıt: output/higgsfield-group-discovery/inbox-swipe-actions.png,
inbox-more-private.png, inbox-more-group.png.

### 2026-11-10 — Sabit radyo bandından çalma ve dinleyiciler

ChatPinnedRadioBanner birebir ve grupta aynı ChatPinnedBanner görünümüne
küçük siyah play/pause düğmesi ekler. Metin pinleri ses kancasına abone olmaz
ve eski yüksekliğinde kalır. Gerçek dinleyici varsa altta 20px fotoğraf, küçük
yeşil nokta ve kişi sayısı açılır; dört fotoğraftan fazlası +N olarak görünür.
İsimler erişilebilir etiketle okunur. Mesaj metnine dokunma hâlâ mesaja gider;
sabitlemeyi kaldır kontrolü korunur.

ChatRadioCard ve bant useChatRadioPlayback ile aynı engine/presence yolunu
kullanır. Aynı owner/sohbet/istasyon için eşzamanlı başlangıçlar kilitlidir.
Hatalı veya hesap/sohbet değişmiş bekleyen istek presence yayınlamaz.
Ayrılmış grupta tarihî radyo dinlemek yeni grup presence'ı yayınlamaz. Sabit
radyo mevcut istasyonsa ayrıca mini player açılmaz.

Dinleyiciler gerçek grup üye presence'ından veya birebir listening kayıtlarından
gelir; stationId eşleşmesi, kullanıcı dedup ve expiresAt uygulanır. Birebir
server registry artık doğrulanmış mesaj payload'ından stationId de taşır;
farklı mesajlardan aynı radyoyu açanlar da eşleşir. Eski sunucu kayıtları
mesaj/pin eşlemesiyle uyumludur. Bu sunucu değişikliği üretime yayınlanmadı;
yeni migration gerektirmez. Kesin zaman eşlemeli ses senkronizasyonu eklenmedi.

Doğrulama: dört ilgili mobil test (ortak start/pause, stale owner, favori,
inline görünürlük, süre sonu/dedup) ve dokuz backend presence/radio testi geçti.
API typecheck geçti; dokunulan mobil dosyalarda TypeScript hatası yok, genel
projede önceden mevcut hatalar sürüyor. Tarayıcıda ortak bileşenle grup 4 kişi,
birebir 2 kişi ve düz metin görünümü doğrulandı. Ekranlardaki dinleyiciler
açıkça işaretlenmiş QA fixture'ıdır; iki gerçek hesapla canlı yayın testi veya
ana ses yayını başlatılmadı, mesaj gönderilmedi. Geçici QA rotası kaldırıldı.
Kanıt: output/higgsfield-group-discovery/pinned-radio-group.png ve
pinned-radio-private.png.

### 2026-11-10 — Kaydırılan konuşma satırı yerleşim düzeltmesi

ChatInboxSwipeRow artık bütün satırı sola taşımıyor. Avatar/isim sol kenarda
kalırken içerik genişliği hareketle daralır. Tarih, sessiz simgesi ve okunmamış
rozeti sütunu genişlik/opacity animasyonuyla sıfırlanır, kapanışta geri gelir.
İşlem paneli 136px, iki adet 68px dokunma alanı; satır yüksekliğini doldurur.
Önceki ayrı, dikey boşluklu kutular kaldırıldı; ayraç dış satırda sabittir.
Birebir/grup aynı bileşende. Grup okunmamış sayısı da 99+ ile sınırlanır.

Gerçek tarayıcıda 320/375/430px ölçümleri: açık satırın içerik sağ kenarı
Diğer panelinin sol kenarıyla tam çakışır (430:279px, 320:169px, 375 grup:
224px). Açık meta sütunu 0px/opacity0; kapanan meta 64px/opacity1. İçerik
avatar/isimleri kesmez; uzun önizleme metni satır içinde ellipsis kullanır.
Yatay bırakma sohbet açmaz; tek satır açılma ve arşiv/menü davranışı korunur.
Mevcut inbox gesture/state ve inbox list testleri geçti. Üretim verisi veya
sunucu değişikliği yapılmadı. Kanıtlar: output/higgsfield-group-discovery/
inbox-swipe-integrated.png, inbox-swipe-320.png, inbox-swipe-group-375.png.

### 2026-11-10 — Diğer menüsü ortak kompakt yüzeye taşındı

ChatContextMenu, ChatMessageActions ile ChatInboxActions'ın ortak yüzeyidir.
Mevcut mesaj menüsünün 232px genişliği, 49px satırları, renk/gölge/ayraçları
korunur. Inbox More ve konuşmaya basılı tutma, swipe satırının native
measureInWindow ölçümünü alır; menü satırın sağ hizasında altında veya yer
yoksa üstünde açılır. Ayrı alttan açılan panel kaldırıldı. Temizle/sil/ayrıl
onayları aynı kompakt yüzeyde korunur; arşiv ve diğer servisler değişmedi.

Tarayıcı: 430px birebir menü x182/y286, 232x206; 320px grup x72/y378,
232x206. Listenin altındaki Selin satırına basılı tutma menüsü yukarıda
y412'de açıldı, alt sınırı618px (satır y624). Aynı ekranın mesajına basılı
tutmada Cevapla/Kopyala/Sabitle/Sil mevcut menüsü 232x206 olarak doğrulandı.
Silme onayı görüldü ama hiçbir mesaj/konuşma silinmedi veya gruptan ayrılınmadı.
Inbox state/gesture ve list testleri geçti; dokunulan TypeScript dosyalarında
hata yok. Kanıt: output/higgsfield-group-discovery/inbox-compact-menu.png.

### 2026-11-10 — Bildirim adı ve eski paused mini player giriş düzeltmesi

Diğer menüsündeki konuşmaya özel mute/unmute, Türkçede Bildirimleri kapat/aç
olarak adlandırıldı (EN/DE karşılıkları da güncellendi). Yeni tekrarlı seçenek
eklenmedi. Mevcut sunucu DM push/in-app notification guard'ı ve grup muted
recipient filtresi kontrol edildi. Önizlemede kapat/aç dönüşümü ve çan işareti
doğrulandı, test ayarı geri açıldı; gerçek push gönderilmedi. Mevcut server
yayın gereksinimi devam eder. Kanıt: inbox-notifications-off.png.

Mert'in temizlenen sohbetine yeniden girildiğinde isMiniPlayerVisible bayrağı
ve currentStation'ın paused halde kalması mini player'ı gereksiz açıyordu.
Ortak useChatMiniPlayerEligibility, görünürlüğü sohbet ziyareti + istasyon
kimliği + gerçek playing durumuna bağlar. Girişte eski paused/loading/idle/error
yetmez; zaten çalan radyo veya içeride çalma başlatılması yeterlidir. Aynı
ziyaret içinde pause sonrası resume kontrolü korunur. Sohbet değişimi/blur,
istasyon değişimi veya hata/stop önceki yetkiyi taşımaz. Inline/pinned kart
görünürlük kuralı ayrıca korunur. Global oynatıcı yaşam döngüsü değişmedi.

Testler: yeni eligibility testi ve mevcut inline player/inbox testleri geçti.
Gerçek tarayıcıda izole QA state fixture'ı ile paused girişte 0, playing
durumunda 1, ziyaret içi paused durumda 1, paused yeniden girişte 0 mini player
ölçüldü. Ana ses yayını başlatılmadı, geçici QA rotası ve tutorial anahtarı
temizlendi. Kanıt: output/higgsfield-group-discovery/chat-mini-paused-entry.png.

### 2026-11-10 — Bildirim kapalı göstergesinin okunurluğu

Ortak ChatInboxMeta, birebir/grup sağ sütununu birleştirir. Tarih/grup etiketi
üstte, 6px altında dolu üzeri çizili bell-off 22px ve #B4B5BD; eski 14px
çizgisel simge kaldırıldı. Okunmamış rozeti aynı alt sırada durur; sağ sütun
64px, alt sıra en fazla 99+ rozetle de sığar. Açık swipe sırasında mevcut
genişlik/opacity animasyonu korunur. Erişilebilir bildirim kapalı etiketi
TR/EN/DE eklendi. Kullanıcının bildirim tercihleri değiştirilmedi.

430px gerçek Mert satırında tarih y210.25-224.25, simge y230.25-252.75;
320px'de simge 22px ve sağ kenarı295px, ekran içinde. Dokunulan dosyalarda
TypeScript hatası yok. Kanıt: output/higgsfield-group-discovery/
inbox-clear-notification-icon.png.

### 2026-11-10 — Grup listesinde gönderen ve mesaj zamanı

Grup sağ sütunundaki Grup etiketi son etkinlik zamanıyla değiştirildi. Ortak
formatInboxTime, bugün HH:mm, dün yerelleştirilmiş Dün, eski günlerde kısa
tarih ve eski yılda yıl gösterir. Takvim günü cihaz timezone'unda karşılaştırılır;
yuvarlanan 24 saat kullanılmaz. Açık listede yerel gece yarısında etiketler
yenilenir. Aynı zaman formatı birebir satırlarda da kullanılır.

Alt satırda gönderen ve mesaj özeti ayrı, tek satırlık Text bileşenleriyle
gösterilir; gönderen en çok %45 alan kaplar. Uzun isim mesajı tamamen kapatmaz.
Radyo özetlerinde de gönderen korunur; kendi mesajı lastSenderId ile Sen
olarak yerelleştirilir. Davet/ayrılmış/boş/silinmiş durumları ayrı ele alınır.
Önizleme, group threads'teki gerçekten son görünür mesajı kaynak alır; temizleme
kesim tarihi korunur. Grup filtre araması Grup sohbetlerinde ara olur.

Backend grup sorgusuna lastSenderId ve boş fullName için username fallback
eklendi; migration gerekmez, üretime yayınlanmadı. Mobil tip sözleşmesi ve
önizleme send/update alanları eşlendi. Yeni preview/date testi ve mevcut
inbox testleri geçti; 17 backend grup testi ve API typecheck geçti. Dokunulan
mobil dosyalarda TypeScript hatası yok. Tarayıcıda 430/320px grup filtresi
gönderen, radyo, saat/Dün ve okunmamış rozetiyle doğrulandı. Mesaj gönderilmedi.
Kanıt: output/higgsfield-group-discovery/group-inbox-sender-time.png ve
group-inbox-sender-time-320.png.

### 2026-11-10 — Profil menüsünde Mesajlar erişimi

Girişte Çal'ın hemen altına Mesajlar taşındı; Ülke/Dil/İstatistikler/Hesap
sonrasında gelir. Mevcut profil satırı/ayraç/ok stili korundu; Mesajlar için
stabil profile-messages testID'si eklendi. Gerçek hesapta ortak chat-unread
ve chat-groups cache anahtarlarından toplam okunmamış sayısı, varsa 99+
sınırlı Mega rozetiyle gösterilir; odak dışında polling yapılmaz.
Tarayıcıda gerçek profil sırası ve Mesajlar'a dokununca /messages geçişi
doğrulandı. Dokunulan profile.tsx içinde TypeScript hatası yok; diff check
geçti. Kanıt: output/higgsfield-group-discovery/profile-messages-top.png.

### 2026-11-10 — Profil fotoğrafı seçici ve ilk ziyaret yönlendirmesi

Hatanın nedeni, mevcut avatarı olan kullanıcıda Alert.alert seçeneklerinin
web'de görünmemesiydi. Avatar dokunması artık uygulamanın ChatContextMenu
yüzeyinde Fotoğrafı değiştir/kaldır açar. Kaldırma ayrıca onaylıdır. Web'de
picker doğrudan kullanıcı tıklaması içinden çağrılır; native galeri izni web'de
beklenmez. iOS'ta galeri native modal kapandıktan sonra açılır. Backend ile
aynı 5 MB ve JPEG/PNG/WebP sınırları seçimin ardından kontrol edilir. Hatalar
web'de görünür ve erişilebilir bildirimle gösterilir; kullanıcı/hesap değişimi
bekleyen yükleme ve silme sonucunun başka hesaba yazılmasını engeller.

useProfilePhotoCoach hesap başına ilk profil ziyaretinde oklu kompakt rehber
gösterir. Avatar dokunması veya kapatma rehberi bitirir. Gizli profilde
keşfedilmek için herkese açma bilgisi verilir; gizlilik otomatik değiştirilmez.
PreviewAvatarCoach parametresi yalnızca dev web'de önizleme içindir ve gerçek
ilk ziyaret kaydını tüketmez. Fotoğraf alanı ref ile ölçülür; rehber okunun
konumu buna göre belirlenir. TR/EN/DE metinleri eklendi.

Tarayıcıda mevcut fotoğrafa dokunma, değiştir menüsü, gerçek tekli dosya
seçici olayı ve kaldırma onayı doğrulandı. Kişisel fotoğraf yüklemek yerine
geçerli PNG gövdesiyle üretilen 5MB+1 byte test dosyası seçildi: client,
yükleme çağrısından önce En fazla 5 MB uyarısı gösterdi; ardından menü tekrar
açılabildi. Kullanıcının fotoğrafı yüklenmedi/silinmedi ve gizliliği değişmedi.
Gerçek başarılı sunucu yüklemesi mevcut fotoğrafı değiştirmemek için yapılmadı;
mevcut avatar FormData/response API sözleşmesi backend kaynağıyla kontrol edildi.
Fotoğraf sınırları, MIME, hesap başına ilk gösterim, gizli ekran ve tüketmeyen
önizleme testleri geçti. Dokunulan dosyalarda TypeScript hatası yok. Native
iOS/Android cihazda galeri testi yapılmadı. Kanıt: output/higgsfield-group-discovery/
profile-photo-coach.png ve profile-photo-actions.png.

### 2026-11-10 — Profil alt boşluğu ve ortak tutorial düzeltmesi

Aktif mobil uygulamada profil ScrollView'un mini player için ikinci kez eklediği
70px alt pay kaldırıldı. Alt tab dock zaten player yüksekliğini akışta ayırıyor.
430×932 önizlemede listenin sonunda Delete Account ile dock arasındaki mesafe
player kapalıyken 35.875px, açıkken 35.875px ölçüldü. Ses başlatılmadan, yalnızca
geçici QA sekmesinde duraklatılmış player ile kontrol edildi; geçici route silindi.

Mini player taşıma rehberinin mevcut gri balon/ok/tipografi/işaret ucu CoachHint
ortak bileşenine çıkarıldı; profil fotoğrafı rehberi aynı bileşeni kullanıyor.
Kullanıcının yeniden gösterim isteği için rehber sürümü v2 oldu. Geliştirme
önizlemesindeki zorlanmış gösterim normal ilk ziyaret kaydını tüketmez.
Telefon çerçeveli /?screen=profileCoach önizlemesi rehber açık bırakıldı.
Fotoğraf sınırları ve tutorial yaşam döngüsü testleri ile mini player rehberi
testleri geçti; dokunulan dosyalarda TypeScript hatası yok (repo genelindeki
mevcut hatalar devam ediyor). Kanıt: output/higgsfield-group-discovery/
profile-photo-coach-shared-preview.png ve profile-dock-bottom-fixed.png.

### 2026-11-10 — Fotoğraf geri bildirimi ve istatistik görsel eşleştirmesi

Aktif mobil profilin fotoğraf yükleme göstergesi artık fotoğrafın üzerinde,
40×40 avatarla aynı konumdaki örtü içinde merkezlenmiş 20×20 göstergedir.
Fotoğraf yüklenirken görünür kalır. Başarı/hata geri bildirimi akıştan çıkarıldı:
ProfilePhotoFeedback mutlak konumlu, kapatılabilir ve kendiliğinden kaybolan
bir katmandır; native taraftaki mükerrer Alert kaldırıldı. Başarı 4500ms, hata
6500ms ardından kapanır; süre ve animasyon temizliği unmount'ta yapılır.
Web'de avatar/örtü 40×40, gösterge20×20 ve merkez farkı0px ölçüldü. Premium
bölümü bildirim açık/kapalıyken y86'da kaldı. Başarı otomatik kapanması ve hata
elle kapatması doğrulandı. Gerçek kullanıcı fotoğrafı değiştirilmedi.

Figma MCP hesap kotası nedeniyle tasarım bağlamı çağrıları kullanılamadı.
Açık Figma arayüzünde statistic435:1600 frame'i ve Properties ölçüleri okundu.
Frame436:1687 grafiği SVG olarak UI'dan indirildi; özgün çizgi, gradient ve
parlama değiştirilmeden assets/images/statistics/listening-wave.svg olarak
kullanılıyor. Kaynak/ölçü kayıtları aynı klasörde SOURCE.md'de. Eklenen geçici
export ayarı kaldırıldı. Sayfa #1B1C1E zemine, kartlar #282828/radius10,
Ubuntu Medium/Bold ölçülerine alındı. İyonicons geri oku mevcut Mega SVG ile
değiştirildi. Gerçek hesaba ait istatistik değerleri korunuyor, Figma demo
sayıları kullanılmıyor. 375px genişlikte ana kart345×123 ve alt kart165×123,
15px ara/kenar boşluğu ölçüldü;320px'te yatay taşma yok. Telefon önizlemesinin
saat alanıyla zemin birleşimi görsel olarak doğrulandı. Profil fotoğraf testleri
geçti. TypeScript genelinde mevcut523 hata sürüyor; dokunulan dosyalarda hata
yok. Native cihazda görsel test yapılmadı. Kanıtlar:
output/higgsfield-group-discovery/statistics-figma-fixed.png ve
profile-photo-feedback-overlay.png.

### 2026-11-10 — Rate Us özgün pencere ve alt fotoğraf bildirimi

Kullanıcının yeni Figma yorumları doğrultusunda RateUsModal yeniden eşleştirildi.
Figma MCP çağrı kotası devam ettiği için App sayfasındaki rate-us/Frame234
1711:10380 açık Figma UI üzerinden incelendi. 302×204, radius6, #000000 ve
1px #292929 kutu, Ubuntu Bold20/23 başlık, Medium15/17 açıklama ve67×27 Mega
pembe buton uygulandı. Özgün62×62 yıldız grubu ve24×24 beyaz close-circle
UI'dan SVG olarak dışa alındı (assets/images/rate-us/SOURCE.md). Close-circle
Figma tarafından ZIP içinde verildi; özgün SVG çıkartıldı. Geçici export ayarları
kaldırıldı. Görünen butonlar referans boyutunda; görünmez dokunma alanları44px.
Mağaza/native review davranışı değiştirilmedi; QA sırasında review gönderilmedi.
Dev previewRateUs parametresi kapanırken gerçek gösterim hatırlatmasını tüketmez.

ProfilePhotoFeedback önceki üst gri balon yerine kullanıcının gösterdiği siyah,
ince çerçeveli Mega kutusunun stilini kullanıyor. Düğme/ikon eklenmedi. Profil
scene'inin altında, akış dışında bottom16 ile konumlanır; scene zaten tab ve
mini player dock'undan yukarıda biter. Premium bandını örtmez, içeriği kaydırmaz.
Başarı7s, hata9s görünür; Android erişilebilirlik zaman önerisi süreyi uzatabilir.
Mesaj ekran okuyucuya duyurulur; zamanlayıcı/animasyon unmount'ta temizlenir.
Apple Feedback ve Material Snackbar kılavuzları bu yerleşim kararında incelendi.

Web'de302×204 kutu,62×62 yıldız ve44px dokunma hedefleri ölçüldü. Close ile
kapanma ve fotoğraf bildiriminin otomatik kaybolması doğrulandı; bildirimde0
buton var. 320px ekranda pencere272px'e daralıyor, yatay taşma yok. Profil fotoğraf
testleri geçti. TypeScript mevcut523 hatayı bildiriyor; dokunulan dosyalarda
hata yok. Native cihaz testi yapılmadı. Kanıtlar: output/higgsfield-group-discovery/
profile-rate-us-figma.png ve profile-photo-feedback-mega.png.

### 2026-11-10 — Kalıcı bildirim standardı ve cihaz bazlı yorum yönlendirmesi

Onaylanan ProfilePhotoFeedback görünümü hem ana repo hem aktif mobil frontend
AGENTS.md dosyasına kalıcı tasarım sözleşmesi olarak kaydedildi. Benzer kısa
başarı/hata mesajlarında yeni varyasyon yerine ortak bileşen kullanılacak.

Rate Us butonundan quota ile görünmeyebilen requestReview çağrısı kaldırıldı.
Açık kullanıcı eylemi iOS'ta action=write-review içeren App Store yorum yazma
bağlantısına; Android'de showAllReviews=true içeren Play yorumlar bölümüne gider.
Expo belgesinde Android için doğrudan yorum düzenleyicisi bağlantısının eşdeğeri
yoktur; parametreyle yıldız seçimi de sunulmaz. Puan ve metin kullanıcıya aittir.
Native mağaza şeması başarısızsa aynı mağazanın HTTPS bağlantısı denenir.
Web'de iPhone/iPad/Android algılanır; iPad masaüstü UA modu da desteklenir.
Masaüstünde otomatik Android yerine mevcut kutu stilinde App Store/Google Play
seçimi sunulur. Eşzamanlı tekrar basışlar kilitlenir; iki bağlantı da başarısızsa
pencere açık kalır. Yeni bağımlılık eklenmedi.

scripts/tests/store-review.test.cjs: native ve web cihaz ayrımı, iPad, masaüstü,
doğru uygulama/yorum parametreleri, HTTPS fallback ve hata yayılımı geçti.
Masaüstü butonuna basınca iki mağaza seçeneğinin açıldığı UI'da doğrulandı;
mağazaya gerçek yorum gönderilmedi. Native cihaz mağaza açılışı bu ortamda test
edilmedi. TypeScript'te dokunulan dosyalarda hata yok; mevcut repo hataları sürer.
Kanıt: output/higgsfield-group-discovery/rate-us-device-choice.png.
Kaynak: https://docs.expo.dev/versions/latest/sdk/storereview/#write-reviews

### 2026-11-10 — Konum izninde kullanıcı eylemi ve ülke yedeği

Aktif mobil uygulamada Home mount ve RootLayout başlangıcının otomatik konum
izni istemesi kaldırıldı. locationStore.fetchLocation varsayılan olarak yalnızca
mevcut foreground iznini okur; requestPermission:true sadece Home konum eyleminde
verilir. Başlangıç ve uygulama aktif olduğunda izin zaten verilmişse GPS sessizce
yüklenir. İzin geri alınmışsa koordinatlar temizlenir. Permission/canAskAgain,
GPS hatası ve cihaz konum servisleri durumu ayrı tutulur. Tek uçuş kilidi korunur.
Web reverse geocoding desteklenmese bile geçerli GPS koordinatı kaybedilmez.

Konum yokken nearby query fiziksel/IP ülkesi, yoksa seçili ülkeyle çalışır;
yapay GPS/mesafe oluşturulmaz. Yeni TR/EN/DE eylemler: Yakınımdaki radyoları bul,
Konumun bulunuyor, Konumu yeniden dene, Konum ayarları. İzin engelliyse native
uygulama ayarlarına geçilir; web'de onaylanan ortak ProfilePhotoFeedback stilinde
site ayarı açıklanır. İzin reddedilse/GPS alınamasa ülke listesi kullanılabilir.
Sistem izni verilmiş ve koordinatlar alınmışsa eylem gösterilmez.

nearby-discovery.test.cjs mevcut13 teste8 izin/yükleme durumu testi eklenerek
21 senaryoda geçti: otomatik prompt yok, mevcut izin, açık kullanıcı eylemi,
reddetme/engelleme/geri alma, GPS hatası, kapalı servisler, eşzamanlı prompt
koruması ve web geocode hatası. TypeScript önceki logla karşılaştırıldı, yeni
hata yok (repo mevcut hataları sürüyor). Web önizlemesinde Austria radyoları ve
engellenmiş izin durumundaki Konum ayarları bağlantısı doğrulandı. Gerçek konum
izni verilmedi/değiştirilmedi; native cihaz izin penceresi testi yapılmadı.
Kanıt: output/higgsfield-group-discovery/home-location-opt-in.png.

### 2026-11-10 — Keşif banner sırası ve gizlilik geri bildirimi

Home yatay keşif banner şeridi (Jazz dahil) Kullanıcı Favorileri bölümünün hemen
üstüne taşındı; mevcut görsel ve etkileşimler korundu. DOM'da banner'ın sonraki
bölümünün Kullanıcı Favorileri olduğu ve üç banner'ın kaldığı doğrulandı.

Profil gizlilik değişikliği başarılı API kaydından sonra onaylanan ortak kutuda
Hesabın artık gizli / Profilin artık herkese açık. Herkes seni keşfedebilir
mesajlarını gösteriyor. Hata durumunda optimistic switch geri alınır ve aynı
kutuda hata metni gösterilir. Geri bildirim state'i artık profileNotice adında;
avatar ve gizlilik aynı ProfilePhotoFeedback bileşenini kullanıyor. TR/EN/DE
metinleri eklendi. Geciken kayıt başka hesaba veri veya bildirim uygulamaz;
owner değişiminde yükleme state'i sıfırlanır.

Gerçek handler AST'den alınarak sahte API ile private/public payload+başarı,
hata rollback ve owner değişimi senaryolarında çalıştırıldı; hepsi geçti.
Profil fotoğraf testleri geçti; TypeScript logunda önceki duruma göre yeni hata
yok. Her iki mesaj web'de sadece dev preview ile gösterildi; kullanıcının gerçek
hesap gizliliği değiştirilmedi. Görsel kanıtlar: output/higgsfield-group-discovery/
home-banner-above-users.png, profile-privacy-private-notice.png ve
profile-privacy-public-notice.png.

### 2026-11-10 — Profil fiyatında yalnızca kontrast

Kullanıcı etiket/badge varyasyonunu reddetti. Misafir ve oturum açık Remove Ads
satırında özgün düz €5.99/yr metni, Ubuntu-Regular13 ve konumu korundu. Yalnızca
#888 renk #B9B9C1 yapıldı. Eklenen kutu, çerçeve, zemin ve ayrıştırılmış dönem
stili kaldırıldı. Web'de13px, şeffaf zemin, doğru fiyat ve yeni renk ölçüldü.
İnce iyileştirme istenince mevcut satırın yapısına sadık kal; yeni süs/etiket
üretme. Kanıt: output/higgsfield-group-discovery/profile-price-contrast-only.png.

### 2026-11-10 — Telefon bildirimi anahtarı ve uygulama içi zil ayrımı

Aktif mobil ProfileSwitch artık satırın yazısına dokununca da tepki verir;
çocuk switch tıklaması üst satıra yayılmaz. checked/disabled web ARIA durumları
native accessibilityState ile birlikte verilir. usePushPreferences ortak kancası
anlık optimistic on/off, tek uçuş kilidi, başarısız kayıtta rollback, owner guard,
6s API zaman aşımı, yükleme/kayıt/tekrar dene ve sistem izin durumunu yönetir.
Hatalar ve onaylar onaylı ProfilePhotoFeedback kutusundadır. TR/EN/DE metinler.

notificationPreferences server yanıtını doğrular; push cache hesap bazındadır,
önceki hesap belirsiz global anahtar taşınmaz. Opt-out foreground banner'ı hemen
bastırır; API hatası eski cache'i geri getirir. Disk cache hatası başarılı sunucu
kaydını başarısız gibi göstermez. Açık dev previewNotifications=1 ayrı preview:
owner cache kullanır ve gerçek tercih/izin değiştirmez.

Native başlangıç/oturum/resume yalnızca mevcut OS izniyle token kaydı yapar;
yeni izin istemek kullanıcı opt-in eylemine bağlıdır. Android default channel
izin isteğinden önce kurulur. Opt-in için token/backend kayıt ve tercih onayı
beklenir; başarısızlık açıklanır. Sistem izni engelliyse Ayarlar, tekrar
sorulabiliyorsa Bildirim izni ver sunulur. Foreground sunum hesabın push cache'iyle
kontrol edilir; oturum yok/belirsiz durum gizlidir. Listener async unmount temizliği
ve cold-start navigation timer temizliği eklendi.

Uygulama içi zil listesi pushEnabled'a bağlanmadı. notifications query hesabın
anahtarını kullanır, sayfa odaklanınca bağımsız yenilenir. API tarafında mesaj ve
takip bildirim kaydı push gönderiminden ayrı kalır. Ek olarak şimdi çalan,
favori ve öneri helper'larının master preference'ı atlayan doğrudan web push
çağrıları ortak kontrollü mobile+web yoluna alındı; kategori tercihi uygulanır,
önerilerin varsayılanı kapalıdır. Sunucu değişiklikleri canlıya dağıtılmadı.

Mobil testler: cache/ack/rollback/disk hatası, hesap ayrımı, çift tıklama,
optimistic anlık durum, owner değişimi, OS izin reddi, sessiz başlangıç ve
foreground sunum geçti. API notification-settings/master/category gate testleri
17/17 ve API TypeScript geçti. Mobil TypeScript'te önceki hatalara ek yeni hata
yok. Web önizlemesinde anahtar ve satırla aç/kapa, tekrar girişte kalıcılık
ayrı test verisiyle doğrulandı; gerçek hesap tercihi/cihaz izni değiştirilmedi,
kimseye push gönderilmedi. Kilit ekranı fiziksel cihaz testi yapılmadı.
Kanıt: output/higgsfield-group-discovery/profile-push-switch-fixed.png.
Kaynaklar: Apple User Notifications/lockScreenSetting; Android notification
runtime permission belgeleri (2026-11-10 kontrolü).

### 2026-11-10 — Oy satırı A, K/M gösterimi ve ortak tek oy sözleşmesi

Higgsfield ikinci karşılaştırmasının A seçeneğinden yalnızca oy satırı uygulandı.
Aktif mobil player'da mevcut çizgi iki ince solan parçaya bölündü; ortada mevcut
thumb SVG'si Mega pembe20px ve Ubuntu-Medium16 beyaz sayı bulunur. Kullanıcının
son düzeltmesiyle sayı823,6K biçimindedir; bin/oy etiketi yoktur, erişilebilir
ad tam823.554 değerini korur.44px dokunma hedefi320px görünümde ölçüldü. Kilit,
cast ve paylaş özgün diziliminde kaldı. Başarı hareketi web VoteButton'ın aynı
1.15/1.1 yaylanması ve600ms hafif pulse davranışıdır; reduced motion korunur.

Web mini-player'ın orijinal26px Figma Deezer background/mark SVG dosyaları
mobilde aynen kullanıldı. Ana sosyal sırada SoundCloud yerine Deezer bulunur;
üç nokta menüsünde SoundCloud korunur ve Deezer ayrıca eklenir. Arama URL'si
mevcut trackSearchUrls fonksiyonundadır; metadata yoksa diğer servisler gibi
disabled olur.320px menüde her iki servis doğrulandı.

İncelemede eski POST vote endpoint'inin kimliksiz/sınırsız votes+1 yaptığı
bulundu. Yeni0050 migration station_votes üzerinde station_id+user_id primary
key ekler; mevcut kayıtlı toplam değiştirilmez, tarihsel hesaplı rating oyları
yeniden sayılmadan kimlik kaydına taşınır. Yeni kabul edilen oy toplamın üstüne
bir kez eklenir. Aynı hesabın tekrar isteği200/alreadyVoted=true ile aynı toplamı
döndürür. Giriş gerekir; misafir için401/LOGIN_REQUIRED. Sayı benzersiz kişi veya
Mega'ya özel beğeni değildir: kaynak katalog oylarını da içerir. Radio Browser
kendi oy endpoint'inde IP/radyo başına10 dakika kuralı kullanır; Mega için
hesap/radyo başına kalıcı tek oy ürün kararı seçildi, evrensel standart iddiası yok.
Kaynak: https://docs.radio-browser.info/#vote-for-a-station

Yeni store canonical station lock + transaction + ON CONFLICT kullanır; SQL
hatasında kimlik ve artış birlikte rollback olur. Alias ve birleştirilen
radyoların oy kimlikleri korunur. Legacy rating yolu da hesaplı kullanıcılar
için aynı kayıt işlevinden geçer, thumb/rating ile ikinci oy üretmez; kimliksiz
rating yeni popülerlik oyu eklemez. Sync'in mevcut protectLocalCounters yolu
providerVotes'u ayrıca arşivler, yerel toplamı ezmez.

Web ortak VoteButton ve RadioBrowser sayfasındaki ayrı POST yolu birleştirildi;
mobilde yalnızca ortak StationVoteButton oy gönderir, profil sayfasındaki ikon
sadece gösterimdir. Kayıtlı oy durumu hesaplı query key kullanır, yeniden
dokununca aynı kısa bildirim çıkar. Hata/hesap değişimi/geciken cevap koruması,
çift tıklama kilidi, unmount temizliği ve erişilebilirlik korunur. Mobil başarı/
hata açıklaması yeni stil yerine onaylı ProfilePhotoFeedback kutusundadır.

Doğrulama: API station-votes ve station CDC testleri16/16 geçti. Kontrollü
transaction adapter'ında100 eşzamanlı aynı hesap isteği yalnızca1 artış yaptı;
başka hesap, alias, rollback/retry ve HTTP kimlik sahteciliği de test edildi.
Mobil actual handler testi çift basış/tekrar/giriş/hata/hesap değişimi ve sessiz
önizleme izolasyonunu; sayı sınırlarını ve iki arama URL'sini doğruladı. API/web
TypeScript geçti. Mobilde önceden bulunan hatalar sürer; dokunulan dosyalarda
hata yok. Özel PG_TEST_DATABASE_URL bulunmadığından gerçek PostgreSQL migration/
integration ve fiziksel native cihaz testi yapılmadı. Sunucu değişiklikleri ve
0050 migration canlıya uygulanmadı; prod oyu gönderilmedi. Önizlemede oy eylemi
gerçek toplamı değiştirmez. Kanıtlar: player-vote-a-compact-applied.png ve
player-deezer-soundcloud-menu-320.png (output/higgsfield-group-discovery).

### 2026-11-10 — Oy satırı dikey denge ve seçili favori kalbi

Oy satırının yüksekliği ve oynatma kontrol konumu korunarak üst/alt boşluklar
24px/24px yapıldı. Satır merkezi492px, iki komşu bölüm aralığının merkezi de
492px ölçüldü. Çift yüzde daralması kaldırıldı:230px hedef satır daha önce207px
oluyordu; şimdi230px. Her iki ince çizgi yaklaşık11.5px uzadı. Diğer kontrol
dizilimi ve sayı/ikon ölçüleri değişmedi.

Figma bağlayıcısı Starter kotası nedeniyle tasarım bağlamı döndürmedi. Tarayıcıda
Jf3ZOklsARouzh5Mop0rRz/139:658 orijinal vuesax/bold/heart bileşeni24×24 olarak
doğrulandı. Kaynak SVG gri navigasyon dolgusunu içeriyor; önceki style.tintColor
expo-image web'de uygulanmıyordu. Aynı orijinal SVG korunup tintColor prop'u
#FF4199 yapıldı. Gerçek DOM SVG filtresi flood-color=#FF4199 ve görünür pembe
dolu kalp doğrulandı; favori olmayan durumda outline kalır.

Dev-only preview favori etkileşimi artık yalnızca ekran state'ini değiştirir;
görsel doğrulama gerçek hesap/guest favorilerine yazmaz. Prod callback korunur.
Mobil TypeScript'in mevcut hataları sürer, player/StationVoteButton'da hata yok;
diff whitespace kontrolü temiz. Görsel kanıt: output/higgsfield-group-discovery/
player-vote-centered-pink-heart.png. Fiziksel cihaz testi yapılmadı.

### 2026-11-10 — Radyo aramasında özgün ad, birleşik kelime ve isim önceliği

Kullanıcı son Higgsfield raporuna göre işlem yapılmamasını belirtti; raporun
isteğe bağlı önerilerinden hiçbirisi uygulanmadı. Bu çalışma yalnızca aramadır.

Gerçek katalogda /api/stations?search=maximum47 sonuç döndürüyordu; Radyo Maximum
düşük oyla ilk30'un dışında kalıyordu. viyana sorgusu route'ta vienna ile
değiştirildiği için ViyanaFM dışlanıyordu. Tam viyanafm araması1 sonuç verirken
viyana4 İngilizce isim sonucu veriyordu. Sorun yalnızca ilk kelime araması değildi.

Mobil searchStations mevcut /api/stations/precomputed public okuyucusunu global
ve slim=1 ile kullanır; bu endpoint özgün sorguyu değiştirmez. En fazla iki
paralel, en çok100 adaylı istek: özgün sorgu ve gerekiyorsa boşluk/noktalama/
aksanı kaldırılmış biçim. Aynı sorgu iki kez gönderilmez. İstemcide gerçek
sonuçlar kimlikle birleştirilip tüm kelimelere göre süzülür; tam ad/marka ve
isim eşleşmesi, etiket/ülke ve tema kanallarından önce sıralanır. Katalog
indirimi, radyo başına istek, isim özelinde istisna veya yapay sonuç eklenmedi.
250ms debounce korunur; AbortSignal,5s istek sınırı, otomatik tekrar kapatma ve
sorgu anahtarında smart-v2 eklendi. Giriş100 karakter, en az2 karakter arama.

Ortak API okuyucusunda stationSearchSql özgün terimi koruyup eşanlamlıları OR
alternatif olarak açar. Çok kelimeli arama kelimeleri AND ile birleştirir; eski
OR davranışının ilgisiz radyo sonuçları kaldırılır. Büyük/küçük harf, Türkçe
aksan/ı-İ, boşluk/noktalama ve Latin dışı alfabeler için station_search_key
eklenir. '%'/'_'/'\\' literal kalır, kullanıcı girdisi SQL'e gömülmez.
Tam ad, normalize tam ad, Radio/Radyo ön ekinden arındırılmış marka, isimde tüm
kelimeler, alternatif isimler ve metadata sıralaması kullanılır; oy yalnızca
eşit ilgililikte sonraki ölçüttür. Ülke/sağlık/görünürlük filtreleri korunur.

0051 migration immutable normalizasyon fonksiyonunu,0052 reviewed concurrent
GIN expression index'ini ekler. İndeks kurucusunun dar allowlist'i yalnızca bu
ikinci incelenmiş tanımı kabul edecek şekilde genişletildi; yanlış tanım/owner/
operator class ve çoklu SQL reddi korundu. Arama cache'i search-v2 versiyonludur.
Bu API/migration değişiklikleri canlıya dağıtılmadı. Mevcut API ile çalışan mobil
uyumluluk yolu istenen iki örneği önizlemede şimdiden bulur; tüm katalogda yeni
SQL sıralaması/normalizasyonu sunucu dağıtımıyla devreye girecektir.

Doğrulama: mobil gerçek servis+ranker testleri isim önceliği, birleşik/ayrı ad,
aksan, alias, literal karakter, dedupe, sınırlı istek, iptal ve hata durumlarını
geçti; mevcut oy testleri de geçti. API search/index testleri9/9 geçti. İzole
PGlite (WASM PostgreSQL) ortamında gerçek production listStations SQL'i;53
Maximum adayı/50 popüler tema, Viyana/Viyana FM/VİYANA FM/viyana-fm, ŞİRAN,
Kiril/Arap harfleri, literal%, boş sonuçlar ve JS/SQL normalizasyon eşitliğinde
4/4 test geçti. EXPLAIN normalizasyon GIN indeksini kullandı. Test aracı yalnızca
/private/tmp/mega-search-sql-validation altına pnpm ile kuruldu, uygulama lock/
dependency dosyaları değiştirilmedi; canlı DB'ye yazılmadı. Tekrarlanabilir yerel
SQL harness output/search-validation/station-search-sql.test.mts içindedir;
kalıcı normal PostgreSQL fixture testi postgres-public-catalog.test.ts'e eklendi.
API TypeScript geçti; mobilin mevcut523 hatasına dokunulan dosyalarda yeni hata
eklenmedi. Fiziksel cihaz testi yapılmadı.

Gerçek API kullanan web önizlemesi: maximum -> Radyo Maximum ilk4 sonuç içinde;
viyana -> ViyanaFM; viyana fm -> ViyanaFM. Arama sonuçlarında radyoya basılmadı,
ses başlatılmadı. Kanıtlar output/search-validation/maximum-results.png,
viyana-results.png, viyana-fm-separated-results.png.
PGlite test motoru belgesi: https://pglite.dev/docs/ ve https://pglite.dev/extensions/.


### 2026-11-10 — mobil çalma ekranı metadata doğruluğu ve servis geri bildirimi

Kapsam yalnızca kullanıcının açtığı son Higgsfield önerisidir: eksik şarkı
bilgisiyle soluk görünen servis ikonlarına dokunulabilmesi. HD, premium aralığı
ve diğer rapor önerileri uygulanmadı. Aktif uygulama kardeş repo
`../megaradioIOSAndroidReact/frontend` (8081/8082). Spotify/Apple/YouTube/Deezer
ikonları ve Diğer menüsündeki SoundCloud dahil beş servis aynı akışı kullanır.
Şarkı yoksa ortak ProfilePhotoFeedback kutusu yerleşimi oynatmadan görünür;
Türkçe kesin eksik bilgi metni “Bu istasyon şarkı bilgisi paylaşmıyor.”. Yüklenme
ve geçici hata ayrı açıklanır; 14 dil için fallback metin vardır.

Metadata sözleşmesi: HTML/JSON/URL/teşhis/reklam yükü gösterilmez; fakat tek bir
bozuk alan diğer temiz başlık/sanatçı alanını silemez. Entity/ICY sarmalayıcıları
açılır. Gerçek Live başlığı/sanatçısı ve sanatçısıyla ayırt edilen istasyon
adıyla aynı başlık korunur. İstasyon+ülke tohum verisi şarkı sayılmaz. Kısa
süreli boş/başarısız sorgu son temiz aynı-istasyon verisini en çok 120 saniye
tutar; normalize/store işlemi bu süreyi yenileyemez. İstasyon/çalma nesli
değişince eski istek sonucu yok sayılır. Native ICY sağlıklıysa REST atlanır;
ICY kesilirse sürekli kurulu sınırlı fallback tekrar devreye girer. Tek uçuş ve
zamanlayıcı temizliği korunur. Web 30s/native 60s sorgu ritmi artırılmadı.

API ICY ayrıştırıcısı yalnızca ilk “ - ” ayırıcısını böler, başlığın devamını
korur; tek karakterli U/爱 gibi gerçek isimleri reddetmez. now-playing API
istasyon adını uydurma şarkı başlığı olarak doldurmaz. Bu sunucu değişiklikleri
henüz dağıtılmadı. Mevcut API'den FM4 için gelen gerçek Berglind / Dreck Dieser
Welt | FM4 OKFM4 değeri mobil regresyon testine alındı.

Doğrulama: mobil now-playing-validation, metadata-provider-recovery ve
web-audio-toggle geçti; API stream-metadata-title testi geçti. API TypeScript
geçti. Mobil mevcut 523 tanıdan 522'ye indi, yeni tanı yok; tüm proje temiz
iddiası yok. Tarayıcıda Spotify/Deezer ve menüden SoundCloud eksik-bilgi
davranışı doğrulandı, ses/oy/favori işlemi yapılmadı. 430x932 ve masaüstü
kontrolü yapıldı; kanıt output/metadata-validation/service-info-mobile.png.
Fiziksel iOS/Android ICY/lock-screen testi bu turda yapılamadı.

Arama: Çin/Japon/Kore/Arap/Kiril ve desteklenen 14 UI dilinin örnekleriyle
mobil ranker testi geçti; izole PGlite gerçek production SQL testleri 4/4,
Çince 北京, Japonca 東京, Korece 서울 dahil geçti. Mevcut gerçek katalogda
北京 sorgusu 北京新闻广播 / 北京交通广播 / 北京音乐广播 sonuçlarını verdi.
UI dili aramayı sınırlamaz; orijinal yazıyla arama desteklenir. Otomatik
çeviri, romanizasyon veya basitleştirilmiş/geleneksel Çince dönüşümü vaat
edilmez. Canlı DB'ye yazılmadı.


### 2026-11-10 — player hata kutusunda yerleşim kayması

Kullanıcıdaki Opss/radio failure durumunda normal logo responsive, hata kartı
ise sabit255px kaldığı için alt bölüm aşağı itiliyordu. Güncel Figma
93WU6qa5fB9HBxkXXsc9WV /1:4199 design-context ve screenshot alındı: siyah42%,
radius12.75,102px özgün broadcast vektörü ve Ubuntu Medium14px mesaj
doğrulandı. Normal player frame1:3957 için ikinci MCP çağrısı kotaya takıldı;
normal yerleşimde değişiklik yapılmadı.

Aktif mobil repo app/player.tsx artık normal/loading/failure için aynı
LOGO_SIZE sabit geometri slotunu kullanır. PlayerErrorState artworkSize prop'u
ile bu slota uyar; Figma ikon oran/konumu ölçeklenir, metin14/16 okunaklı
kalır. Özgün SVG, renk ve offline varyasyonu korunur.

Tarayıcı sessiz preview430×932: normal ve hata slotu190×190,y103; şarkı
y376,Spotifyy416 her iki durumda birebir aynı.320px genişlikte183×183,
masaüstünde274.5×274.5: hata slotla eşit, taşma yok. Mevcut522TypeScript
tanısına yeni tanı eklenmedi. Görsel kanıt:
output/player-error-layout/radio-error-430.png. Gerçek ses başlatılmadı.


### 2026-11-10 — Figma player radyo logo oranı

Kullanıcının güncel Jf3ZOklsARouzh5Mop0rRz /App referansı tarayıcıdan
doğrulandı (MCP kotası dolu). Arama ile bulunan gerçek uzun station-playing
frame2294:8820,375×1691; radio-logo çerçevesi183×183,x96,y127,radius9.15.
İç bitmap190.18×190.18,-3.59/-3.59 crop; API logoları dinamik olduğu için
çerçeve ölçüsü esas alındı. Eski1677:4627 ise375×812/255px logolu başka
varyasyon, bu iş için esas alınmadı.

Mobil player'daki Math.min(responsive.artworkSize,...) telefon190px sınırı
430px ekranda Figma oranını bozuyordu. Yalnızca player'daki gereksiz üst sınır
kaldırıldı;375px'te183,430px'te209.84,tablet üst sınırı274.5 ve dar ekran
mevcut183 davranışı korundu. Ortak logo/loading/error slotu aynı ölçüyü alır.
375/430px tarayıcı kontrolü geçti;430px normal ve hata durumunda şarkıy395.84,
Spotifyy435.84 eşit. Mevcut TypeScript tanılarına yenisi eklenmedi. Ses
başlatılmadı. Kanıt output/player-logo-size/figma-logo-dimensions.png ve
player-430.png,error-430.png.


### 2026-11-10 — Home/player görsel keskinliği, tasarım korunarak

Mobil frontend player premium52px PNG yerine Home'daki özgün30px Figma SVG
kullanır; slot30px kalır. Bayrak kaynağı w40→w160,28px yuvarlak konumu
değişmez. Home tür kartları aynı kart/text ölçüleriyle tek görsel ölçeği ve
merkezli kırpım kullanır; geniş telefonlarda yatay esneme kaldırıldı.

Büyük logo helper yalnızca gerçekten yayımlanmış768/512/384 WebP alanlarını
256'dan önce seçer; tahmini URL kurulmaz. Player mevcut station-details sorgusunu
(mobil slim kayıtta original olmayabilir) kullanarak aynı yönetilen klasördeki
arşiv original'ini kontrol eder. Mevcut256 görsel hemen çizilir; tek önbellekli
arka plan boyut kontrolü,4s deadline,64 kayıt sınırı. Kare en az512px orijinal
veya kare SVG upgrade edilir; kompozisyonu değiştiren dikdörtgen/küçük/hatalı
kaynak reddedilir. Görsel yükleme hatasında mevcut çalışan URL'ye fallback.
Eski istasyondan gelen sonuç unmount/kimlik korumasıyla yeni logoyu değiştiremez.
Yeni dependency, üretim yazma/işleme/backfill veya ses akışı değişikliği yok.

Salt okunur gerçek kaynak doğrulaması Virgin original800×800, Mango original
192×192. Virgin kalite artışına uygun; Mango mevcut256 optimize kopyayı korur,
yapay büyütme yapılmaz. Banner kaynakları593–595×214–215; daha yüksek özgün
asset mevcut olmadığı için başka fotoğraf veya interpolasyonla değiştirilmedi.
Tam Retina keskinliği için bu banner'ların yüksek çözünürlüklü özgünleri ve
küçük orijinalli radyo logoları ayrıca temin edilmeli.

Gerçek player-artwork-quality testleri güvenli kaynak kimliği, boyut/crop,
SVG, anında fallback, önbellek/tek istek, unmount yarışı ve ağ hatasında geçer.
Mevcut TypeScript tanılarına yenisi eklenmedi. Tarayıcıda ülke160×96→28px,
premiumSVG30px ve orantılı Home tür artwork ölçüleri doğrulandı. Ses açılmadı.
Kanıt output/visual-quality/home.png,player-detail.png.


### 2026-11-10 — Home konum eylemi açıklığı ve bildirim süresi

Konum/GPS yokken görünen kafa karıştırıcı Konum ayarları etiketi yerine
Daha yakın radyolar için konumu aç kullanılır. Var olan granted+GPS hata
durumunda yeniden deneme etiketi korunur. Tarayıcı izin reddinde açıklama
Tarayıcının site ayarlarından konuma izin ver. olarak kısaldı; native ayarlar,
servis kapalı ve konum alınamadı metinleri de ayrı/kısa kalır. Yeni anahtarlar
TR/EN/DE fallback'e eklendi, eski sunucu çevirisinin uzun metni ezmesi önlendi.

Ortak ProfilePhotoFeedback stiline dokunulmadan optional durationMs eklendi.
Yalnız Home konum mesajı3500ms; diğer bildirimlerin7000/9000ms varsayılanları
korunur. Android erişilebilirlik timeout tercihi daha uzunsa saygı gösterilir.
Konum izni başlangıçta istenmez; ülke radyoları GPS/izin olmadan kullanılabilir.
21 mevcut nearby keşif/izin testi geçti; TypeScript'e yeni tanı eklenmedi.


### 2026-11-10 — Figma sleep timer, dört durum ve kompakt üst oynatıcı

Referanslar Jf3ZOklsARouzh5Mop0rRz /App alarm312:601 (seçim), action-sheet
312:606 ve alarm1677:4600 (sayaç), iki station-playing kapalı/ON durumu.
MCP design-context ve programatik read kota nedeniyle kullanılamadı; Figma
tarayıcı Properties + doğrudan ekran görüntüleriyle güncel ölçüler doğrulandı.
375×812 frame: siyah#000 panel375×542,y270,radius20; düğme166×50,x105,
panele görey429,radius30; sayılar Ubuntu Bold36; sayaç açıklaması Ubuntu
Medium14/32px iki satır, grupy185,w204; sayaç36Bold.

Aktif mobil repo SleepTimerModal artık tek Modal'da setup/counter kiplerini
taşır. Özgün collapse/heart/more SVG'leri, yeşil eşitleyici,104px dinamik
logo/şarkı/artist ve ortalı istasyon başlığıyla kompakt üst oynatıcı eklendi.
Büyük player/modal üst üste kalmaz; üstteki boşluğun ortasında dengeli durur.
Modalın tamamını slide eden eski RN animasyonu yerine native-driver panel
translate + üst bölüm fade, reduced-motion ve safe-area davranışı vardır.
Süre dolunca aynı panel kapanır; Kapat timer'ı durdurmaz; Durdur yalnız timer'ı
iptal eder. Başlat panel kapandıktan sonra sayacı kurar. Diğer menüsü de panel
kapandıktan sonra açılır. Ana player clock/ON daha kompakt Figma oranına gelir.

Webde contentOffset ilk30 dakikayı kaydırmadığı için yanlış0 görünüyordu.
Çark artık içerik hazırken imperative scrollTo ile doğru satıra başlar; native
snap ve web mouse/trackpad debounce snap birlikte çalışır. Saat/dakika seçimi
gerçek değerle eşleşir;0 süre engellenir. Dar kısa ekranda sıra aralıkları
küçülür, düğme en az44px kalır. Yeniden boyutlanınca çark seçimi yeniden hizalanır.
TR/EN/DE kısa özel timer çevirileri eklendi.

Store saniye azaltma yerine mutlak bitiş zamanına göre kalan süreyi hesaplar;
gecikmiş JS tick süreyi uzatmaz. Eski intervalin yeni timer'ı bitirmesi kimlik
kontrolüyle engellenir; replace/cancel/reset temizler ve callback bir kez
çalışır. Uygulama öldürülmesi/persisted native alarm bu kapsamda eklenmedi.

Doğrulama: gerçek-store sleep-timer testi (gecikmiş tick, tek expiry,
replace/cancel yarışı, geçersiz süre, çark sınırları,HH:MM:SS) geçti. Web
audio toggle ve now-playing regresyonları geçti. Tarayıcı375×812 panel542/y270
birebir;3h2m→03:02:00, Kapat→ON korunur, tekrar aç→sayaç sürer, Durdur→ON
yok, tekrar aç→seçim;0 süre başlatılamaz; More→timer yok/options tekpanel.
320×568 ve430×932 taşma/çark-düğme çakışması yok. Ses başlatılmadı, gerçek
favori/mesaj yazılmadı. Fiziksel cihazda arka plan/işletim sistemi suspend
testi yapılmadı. Mevcut TypeScript tanılarına yenisi eklenmedi.
Kanıt output/sleep-timer/setup-375.png,counter-375.png,setup-430.png,
counter-430.png,compact-320.png,active-player-430.png.

### 2026-11-10 — Sleep timer compact equalizer alignment
- Active localhost:8082 mobile preview maps to sibling `megaradioIOSAndroidReact/frontend`. Fixed there, not sandbox/web app.
- Removed centered transform from compact equalizer. Shared equalizer now accepts geometry scale (default1 preserves main player); compact .65 renders12.35×13 and starts at text x139 on375/430 layouts.
- Retained104px logo/radius5, Ubuntu Medium18/16 title/artist and20px column gap. App alarm312:601 upper player is flattened bitmap, so exact editable text/radius properties cannot be independently certified. Others Starboy417:2319/2124/2404/2575 are centered main-player variants, not this compact source; their typography was not copied into timer.
- Verified375×812 and430×932: equalizer/title/artist left edges identical. Existing timer store test passes; no new TS diagnostics against prior baseline. Screenshot: output/sleep-timer/aligned-430.png.

### 2026-11-10 — Share artwork glow clipping
- Mobile `ShareModal.tsx`: moved existing logo-color Gaussian from inside ScrollView into a noninteractive absolute background layer behind header/content. It now fades naturally across the header boundary rather than being abruptly clipped at scroll viewport top.
- Native-driven scroll offset keeps glow attached to artwork; reset on modal open. Existing sizes, spacing, colors, and share actions preserved. Shared LogoShadow unchanged.
- Browser verified430×932 and375×600 with scroll (112px matching glow translation); no new TypeScript diagnostics. Preview: output/share/soft-glow-430.png.

### 2026-11-10 — Transient Figma player lock dialog
- Restored centered dialog per user request, current Figma screen-looked2293:8640 inspected through browser Properties after MCP quota limit. Dialog302×170,radius6,black#000,stroke#292929; existing original24px pink lock SVG reused.
- Lock notice auto-dismiss2200ms and tap-background dismissal both leave controls locked; existing toggle unlocks and keeps brief inline confirmation. Rapid-toggle timer replacement/unmount cleanup retained.
- Browser verified auto-dismiss, immediate background dismissal, remaining unlock action and pink icon. No new TypeScript diagnostics. Preview output/player-lock/notice.png. Existing player scroll position remains unchanged.

### 2026-11-10 — Shared discovery visuals in CarPlay
- User requested copying chat discovery's Higgsfield frequency/artwork treatment into CarPlay while preserving its mechanics and layout.
- Extracted existing artwork material/inner logo clipping into DiscoveryArtwork, consumed unchanged by GroupDiscoveryDeck and scaled to CarPlay's existing150px slot. Same PNG material, border proportions and neighboring-card fade; no new generated assets.
- CarPlay WorldRadioDial now selects existing elastic appearance. Existing gesture thresholds, phase, momentum, world feed/selection/playback logic and country tooltip are untouched. Frequency container accommodates the80px visual in its existing90px region.
- Browser checked430×932, carousel drag changed station, world-discovery keyboard trigger entered finding state; landscape primary transport controls remain within viewport. Existing movement/release tests pass; no new TypeScript diagnostics. Screenshot output/car-mode/shared-discovery-430.png.

### 2026-11-10 — Account dialog header/footer seams
- Root cause in localhost8082 phone wrapper: account modal dims iframe by40%, but status bar used60% darkness and home indicator area remained undimmed. Updated running /private/tmp/megaradio-mobile-preview/index.html account-modal filter to brightness.6 for both strips and explicit profile/account top background#1B1C1E. Footer base remains dock#171717. Captured wrapper source output/account/preview-wrapper.html for reproducibility.
- Mobile AccountSettingsScreen background Pressable generated a full-screen blue browser focus outline. Set backdrop non-tabbable and remove only its web outline (inputs/buttons keep focus behavior).
- Browser verified raw cancel/reopen, backdrop tabindex-1/outline0px, wrapper top/bottom brightness.6. No account submission or password entry. No new TS diagnostics; final small outline style uses existing supported RN web style keys. Proof output/account/header-footer-fixed.png.

### 2026-11-10 — Sleep timer continuous status/header background
- SleepTimerModal header shade now spans native top safe area and header together; compact content opacity unchanged. Former shade was inside header only.
- Dedicated sleepTimer preview theme replaces reused more flag. Phone status strip now uses timer's fixed844px glow at-234/-172 and matching effective shade(.135×.65); foreground.65. It no longer follows underlying player scroll. Footer stays panel black; cleanup clears sleepTimer flag.
- Added dev-only sleep=1 preview query and wrapper sleepTimer route for reproducible QA. Browser verified430×932 phone frame; existing timer tests pass and no new TS diagnostics. Proof output/sleep-timer/header-unified.png; running wrapper snapshot output/sleep-timer/preview-wrapper.html.

### 2026-11-10 — Account success/error Figma results
- Browser inspected message-error-template2952:10187 after MCP quota limit. Original warning-2 SVG2952:10382 exported and installed in mobile assets/images/account/error.svg. Dialog302×183,radius6,icon46×46 at y46,text Ubuntu Bold14 at y116; existing success artwork reused.
- Invalid name/email, password missing/mismatch, unavailable password change and save errors now use icon result card. Error returns to same form after3200ms/tap without clearing draft; success closes after2200ms. Long messages expand safely.
- Added translated password success/mismatch text and dev-only previewAccountResult for visual QA. Password-success template is NOT wired to fabricated success: existing verified-password backend gap remains, explicitly surfaced as error.
- Browser tested actual blank-name validation, timed return preserving draft, immediate tap dismissal; measured success302×183/radius6/icon46. No account/password write performed. No new TS diagnostics. output/account-results contains previews.

### 2026-11-10 — Four Home discovery banners
- Home now shows Jazz, Folk Music, News, Talk as a horizontal snap carousel with next-card peek and four understated progress marks. Existing location above Favorites From Users preserved.
- Original Folk593×214 Figma export reused unchanged from web public uploads; original Jazz retained. New News/Talk panoramic text-free broadcast photography generated with built-in imagegen and bundled locally (2172×724); live Ubuntu text/translation overlay preserves readability/localization.
- Verified catalog news3393/talk1979 entries, real genre slugs. Browser swipe verified all four; News navigates genre-detail?slug=news, Talk slug=talk. No new TS diagnostics. Proof screenshots output/home-banners/{jazz,folk,news,talk}.png.

### 2026-11-10 — Mega Radio2026 / Parçalar, Home invitation variations
- User selected Sahin Yogurtcu's team (Starter) for the new Figma file GauTNYjuTmAi5U7BFFtB3d. Page Parçalar, editable board1:6.
- MCP editing quota blocked execution, so used browser SVG paste (real TEXT/VECTOR/FRAME layers). Source reference rebuilt from current mobile purple card; original Figma similarly named You like MegaRadio was correctly identified as rate-us and not reused incorrectly.
- One existing-style reference plus three friendship/discovery/light-flirt signup variants, matching existing palette/Ubuntu/radius/button. No generated bitmap UI; UI text verified editable Ubuntu Bold20. Board named Home kapanış — keşif, sohbet ve tanışma;1:6.
- Exported actual Figma board to output/home-closing/figma-2026/variants.png, browser proof canvas.png, import source parts.svg. No app code changed; user will review variants in Figma.

### 2026-11-10 — Onboarding/login-flow demo entry
- Added dev-only onboarding?preview=1 entry, bypassing the completed-onboarding redirect without clearing user storage/session. Preview completion goes to existing auth-options; production flow unchanged.
- Running phone wrapper supports ?screen=onboarding, with black status/footer matching onboarding. Opened and kept demo tab109 at first Enjoy slide for user review.
- Browser confirmed first screen; no new TS diagnostics. output/onboarding/demo-open.png.


### 2026-11-10 — Mobil splash ve onboarding Figma eşlemesi
Kullanıcının localhost:8082 mobil önizleme isteğiyle kardeş megaradioIOSAndroidReact/frontend uygulamasında splash ve onboarding 1–2–3 güncellendi. Figma kaynakları 2:2, 40:2, 2:10065, 46:549. Özgün 3x varlıklar, metin/düğme/nokta ölçüleri ve tam yüzey status/home birleşimleri uygulandı. Native splash config güncel; fiziksel derleme yapılmadı. Doğrulama ve görseller: output/onboarding-final/README.md ve all-four.png. Yeni TypeScript hatası yok; baseline hataları sürüyor.


### Login frekans hareketi — 2026-11-10

Mobil uygulama `app/auth-options.tsx` girişinde Figma 46:445 / 1785:5867 / 1831:5806 özgün vektörleri kullanıldı. Kullanıcı açıkça özel motion istedi: üç yay 180ms gecikmeyle 3.6s döngüde %2.4 genişler, logo sabit kalır. `LoginFrequency` ortak bileşeni reduce-motion, focus ve AppState ile animasyonu durdurur. Provider sırası Apple/Google/Facebook/Mail; Facebook mevcut serviste bağlı değildir, gerçek giriş gibi gösterilmez. Önizleme `http://localhost:8082/?screen=auth`; TS önceki tabana göre yeni hata vermedi.


### Auth ikon kalitesi ve geri gezinme — 2026-11-10
Kullanıcının mobil önizleme isteğiyle kardeş `megaradioIOSAndroidReact/frontend` uygulaması güncellendi. Apple/Google/Facebook/Mail 38px PNGleri yerine Figma özgün SVG grupları export edildi; kaynak kaydı assets/images/auth/figma/SOURCE.md. Email login1831:5829 ve forgot2005:6162 Properties üzerinden geri oku24×24/x41/y72 doğrulandı. AuthNavigation giriş/kayıt/şifre sıfırlama ve başarı durumunda sabit44px hedef ve doğrudan açılış için fallback sağlar. Önizleme saat alanı artık auth formunu örtmez; arka plan birleşimi #1B1C1E. Login başlığının sabit64px genişlik kısıtı kaldırıldı. Forgot boş eposta uyarısı görünür, mevcut ProfilePhotoFeedback ile yerleşimi kaydırmadan gösterilir.
Tarayıcıda login→forgot→geri ve login→signup→geri doğrulandı; yalnız boş forgot formu gönderildi, gerçek giriş/kayıt/reset isteği yapılmadı. Ekran görüntüleri kardeş uygulama output/auth-quality/{login,forgot}.png. TypeScript mevcut baseline ile karşılaştırıldığında yeni diagnostic yok. Fiziksel cihaz testi yapılmadı.

### Auth yazı alanı odağı — 2026-11-10
Mobil önizlemedeki tarayıcı varsayılan iç dikdörtgen outline login/signup/forgot TextInputlarında web-only outlineWidth0 ile kaldırıldı. Klavye odağı kaybolmaması için tüm yuvarlak input konteynırında Mega pembesi çerçeve kullanıldı; boşta da2px şeffaf border ayrıldığı için focus/error ölçüyü değiştirmez. Forgot alanında yazarak görsel doğrulandı; output/auth-quality/focus.png. Native OS outline ile karıştırılmamalı; fiziksel cihaz testi yapılmadı. TS önceki baseline'a göre yeni diagnostic yok.

### Login akışı hata kutusu — 2026-11-10
Kullanıcının düzeltmesiyle forgot-password alt bildirim kaldırıldı; login ve signup ile aynı üst AuthErrorNotice bileşeni kullanıldı. Login'in mevcut kutu stili korundu ve üç ekran ortaklaştırıldı. Bu auth akışı istisnası mobil AGENTS.md'ye kaydedildi. Yalnız boş form doğrulaması kullanılır; reset epostası gönderilmez. TypeScript önceki baseline'a göre yeni hata yok.

### Mevcut yardımcı ekranların inceleme paneli — 2026-11-10
Kullanıcı eski/gözden kaçmış ekranların önizlemesini istedi. Routes ve geçmiş çalışma kaydı karşılaştırıldı; kesin hiç görülmemiş denmeden, son tasarım kontrolü doğrulanmamış ekranlar ve yardımcı sayfalar /private/tmp/megaradio-mobile-preview/review.html içinde12 seçenek olarak toplandı. public-profiles, notifications, languages, station-country, play-at-login, link-error, open-link eksik-parametre durumu, about/privacy/terms, all-stations, favoriler boş durum. Index wrapper'a publicProfiles/linkError/openLinkError salt-okunur önizleme eşlemeleri eklendi. Kullanıcı açıkça Records'un bu sürümde olmadığını hatırlattı: Records ve kapalı song-history panele alınmadı, route veya üretim özelliği etkinleştirilmedi. Hiç uygulama kaynağı değiştirilmedi.

### Akış sıralı tam ekran incelemesi ve bağlantı durumları — 2026-11-10
Kullanıcı paneli bütün mevcut ekranlar için istedi. Yedi akışta65 önizleme (sayfalar ve mevcut modal/boş/hata durumları) eklendi: açılış/giriş, keşif, çalma, favoriler/kullanıcılar, sohbet, profil/ayarlar, bağlantı hataları. Final/düzenlenecek/incelenecek seçimi tarayıcı localStorage'da saklanır; otomatik final ilan edilmez. Menü araması, ileri/geri ve ayrı önizleme bağlantısı mevcut. Kayıt: docs/audits/mobile-screen-review-manifest.json; panel kaynak kopyası docs/mobile/preview/review.html, canlı dosya /private/tmp/megaradio-mobile-preview/review.html. Grup ikinci adımı/üyeler/mesaj menüleri gibi bağlı durumlar ilgili akıştan açılır. Records/kapalı song-history eklenmedi.
Eski CommunityDirectory.tsx silindi; public-profiles uyumluluk adresi /users'a Redirect yapar. Backend public-profiles API'si (yeni dizinin veri kaynağı) kaldırılmadı.
link-error ve open-link yükleme/hata ekranları SharedLinkState ile ortaklaştırıldı: mevcut account/error.svg, siyah #000000 kutu/#292929 border/radius6, Ubuntu, Mega pembe düğme, geri ve ana sayfa. Bunlar bozuk/eksik link veya ulaşılamayan/gizli hedef geri dönüşleridir; uygulama çökmesi değildir. Geçerli linkin fetch/play/router mantığı korunmuştur. Yeni TypeScript diagnostic yok.

### Panelde satır başına Final onayı — 2026-11-10
Her ekranın soluna erişilebilir checkbox eklendi. İşaret final, kaldırma pending yapar; mevcut durum dropdown'u ve final sayacı senkron kalır. Aynı localStorage anahtarı kullanıldığı için önceki işaretler korunur. Checkbox ekranı değiştirmez; ekran düğmesinden bağımsızdır. Splash kutusuyla işaret/kaldır doğrulandı ve ilk durumuna geri alındı; kullanıcı adına final kararı bırakılmadı. Kaynak panel kopyası güncellendi.

### Onboarding geçişi ve dokunma hissi — 2026-11-10
Kullanıcı1→2→3 geçişinde sekme ve ok düğmelerinde basma hissi istedi. Kardeş mobil app/onboarding.tsx eski/sabit sayfa + değişen giriş katmanı yerine üç sayfayı baştan monte eden tek yatay Animated şerit kullanır; özgün Figma boyutları/görseller/300ms easing korunur. Geçiş ref kilidi ardışık tıklamayı engeller; yalnız etkin sayfa erişilebilir ve etkileşimlidir. Ok ve Get Started için85ms basışta0.93scale/1.5px düşüş, kontrollü overshoot'suz spring dönüşü ve native Light haptik eklendi; reduce-motion animasyonu atlar. Haptik fiziksel cihazda test edilmedi. Tarayıcıda1→2→3, tek etkin buton, son konum-375/-750 ve düğme transformunun sıfırlanması kontrol edildi. Yeni TS diagnostic yok. Final işareti kullanıcıya bırakıldı.

### Giriş alt bağlantıları ve bağımsız onboarding oku
Figma email login1831:5829 canlı görünümünde alt bağlantılar ve Forgot Password çizgisiz doğrulandı. Login textDecorationLine kaldırıldı; footer/continue/forgot text Ubuntu-Medium15/17/beyaz. Forgot sayfasındaki footer alt çizgisi de kaldırıldı. Kullanıcının reddettiği tüm düğme scale/translateY hareketi silindi. Onboard-1 Frame40:8 özgün34×34 SVG oku export edildi (next-arrow.svg);58px pembe daire sabit, yalnız ok75ms/-3px hazırlık,110ms sağa44px çıkış, yeni sayfada220ms/-30→0 dönüş yapar. Opacity kenarlarda söner, daire içinde clip edilir. Reduce-motion ve çift tıklama kilidi korunur. Tarayıcıda1→2→3 ve buttonTransform:none/ok sontransform0/opacity1 kontrol edildi. Statik tasarım görselleri yeniden üretilmedi. TS önceki baseline'a göre yeni diagnostic yok.

### 2026-11-11 — Mobil auth vektörleri ve tür navigatörü
- Mobil frontend sibling: `megaradioIOSAndroidReact/frontend`.
- Login/signup/forgot küçük PNG ikonları özgün Figma24×24 SVG exportlarıyla değiştirildi (Group18/19/20); expo-image kullanılır. Aynı ikonlar üç formda paylaşılır; input slot24px ve metin boşluğu10px.
- Forgot2005:6162 Properties: başlık UbuntuBold24/beyaz; açıklama2005:6192 UbuntuMedium15/beyaz,17px satır. Önceki sistemfont/gri açıklama kaldırıldı.
- Müzik türleri60/sayfa, global407/7sayfa. CatalogPagination integrated varyantı: sık4px aralık, koyugri seçili sayfa, pasifler transparan; AllStations varsayılan görünümü korunur.
- Mobil web önizlemelerinde üç form görsel olarak doğrulandı. Sayfalama1–60→61–120 kontrolü geçti. TypeScript mevcut baseline'a göre yeni hata üretmedi; repoda önceki hatalar var. Gerçek hesap/form gönderimi yapılmadı.

### 2026-11-11 — Ortak mobil yükleme göstergesi
- MegaLoadingIndicator52 dosyadaki göstergelerin ortak kaynağıdır; platformun farklı native/web spinner çizimleri yerine tek SVG halka kullanılır.
- Sayfa44px/kontrol24px; eski mor/gri renkler Mega#FF4199'a normalize edilir, dolu düğmede beyaz korunur.800ms doğrusal dönüş; reduced-motion statik, arka planda animasyon durur.
- Tür içindeki radyolar AllStations ortak ekranını kullanır; aynı büyük göstergeyi alır. Genres ve diğer ana liste initial-loading durumları büyütüldü. Veri sorgusu ve oynatma yaşam döngüsü değiştirilmedi.
- Tür detayı önizlemesi render edildi; profil yükleme önizlemesinde ortak SVG ve progressbar erişilebilirliği doğrulandı. TypeScript baseline'a göre yeni hata yok. Cihaz üstünde native görsel doğrulama yapılmadı.

### 2026-11-11 — Tüm istasyonlar arama ve navigasyon
- Genres ve AllStations180ms ease-out üste kaymayı ortak useCatalogPageScroll kancasından alır; aynı sayfaya dokunma hareket üretmez, kullanıcı sürükleyince/unmount'ta animasyon iptal olur.
- getStations arama sorgusu eski /api/stations yerine Home aramasının /api/stations/precomputed okuyucusunu kullanır. countryName/genre/page/limit korunur, response total/count normalize edilir, ReactQuery AbortSignal ile eski sorgu iptal edilir. Tüm katalog indirme/per-station istek yok.
- Search clear: Figma93WU6qa5fB9HBxkXXsc9WV1:6247 Properties24×24 teyit edildi; mevcut özgün favorites/clear.svg tekrar kullanılır,44px dokunma hedefi korunur.
- Global canlı önizleme: viyana→ViyanaFM(1sonuç), maximum→RadyoMaximum dahil47sonuç; X temizleme ve sayfa2(61–120) doğrulandı. TypeScript mevcut baseline'a göre yeni hata yok.

### 2026-11-11 — Arama tutarlılığı, ikinci doğrulama
- Canlı eski `/api/stations` okuyucusu `viyana` sözcüğünü `vienna`ya çevirip gerçek ViyanaFM'yi kaybediyordu; precomputed okuyucusu literal ve farklı yazımları ayrı sonuçlandırıyor, boşluklu FM sorgularında OR mantığıyla ilgisiz15k sonuç verebiliyordu.
- Ortak stationSearchRequests: en fazla3 paralel, slim ve iptal edilebilir okuma (anlamlı ad, birleşik ad, şehir eşadı). Tek başına FM/AM terimi candidate isteğinden çıkarılır; orijinal tüm tokenlar rankStationSearch'te kontrol edilir. Böylece ilgisiz FM kataloğu indirilmez; orijinal ad kaybolmaz.
- rankStationSearch artık oy DESC, eşit oyda ad/marka yakınlığı ve stabilID kullanır; favicon şartı/isteği yok. Home, useSearchStations, CarPlay ve ChatStationPicker ortak servis üzerinden aynı sıralamayı alır.
- AllStations/tür detayında en fazla500 eşleşen sonuçluk sınırlı arama havuzu sorgu+ülke+tür bazlı bir kez çekilir,60'lık yerel sayfalama yapılır; sınır dolunca başlık/sayaç500+ gösterir. Normal katalog sunucu sayfalaması değişmedi. Tüm katalog indirilmiyor, logo kontrolü/per-station fetch yapılmıyor.
- Arama kelimesi değişir değişmez eski kartlar/sayı gizlenir, ortak loading ve başlıkta… gösterilir; eski sorgu yanıtı yeni metnin sonucu gibi görünmez. Query cache anahtarlarısmart-v4-votes oldu.
- Canlı globalviyana→ViyanaFM dahil5eşleşme; viyana fm→ViyanaFM+Vienna FM; Pop içindevienna/vienna fm→ViyanaFM doğrulandı. Kral11sonuçta oy sırası10438→2311→1035→893… . station-search.test.cjs oy/alias/Unicode/literal/cancel/scope/logosuz sonuç testleri geçti. TypeScript baseline'a göre yeni hata yok.

### 2026-11-11 — Ad eşleşmesi önceliği ve iki görsel düzeltme
- Kullanıcı düzeltmesi: salt oy sırası doğru değil. stationSearch tüm çağrılarda exact ad1000, normalize exact900, ad içi sıralı kelimeler750, ad tokenları700, şehir eşadı500, metadata100; oyDESC sadece aynı score'da, ID stabil son bağlayıcıdır. Tek kelimekral için ad eşleşmeleri aynı düzeyde olduğundan oy sırası korunur; kral fm için KRALFM tam eşleşmesi yüksek oylu KRALTÜRKFM'nin önüne gelir.
- Home/useSearchStations/AllStations/tür detayı/ChatStationPicker/Favoriler araması ortak rankStationSearch kullanır; sorgusuz Favoriler kişisel sırası değişmez. Cache anahtarlarısmart-v6-relevance.
- AllStations arama altı20px; DOM ölçümüsearchBar.bottom126→firstCard.top146 doğrulandı.
- Favorites1:5087 Figma Properties UbuntuMedium12/14,#A6A6A6; sayaç beyazdan bu renge/fonta alındı. Render rgb166,166,166 veUbuntuMedium12 teyit edildi.
- station-search.test.cjs: tam/normalize ad, kısmî eşleşmeler ve oy bağlayıcısı testleri geçti; TypeScript baseline'a göre yeni hata yok. Canlı kral fm ilksonuçKRALFM doğrulandı.

### 2026-11-11 — Ortak konum araması, takip tonu ve profil paylaşımı
- stationSearchFields artık name/country/state/city/countryCode/countrycode/tags/genres okur; Favoriler'deki ekran bazlı alan genişletmesi kaldırıldı. Ad eşleşmesi/oy bağlayıcısı korunur.
- Ortak servis, ad adaylarına ek olarak bir bounded+slim state okumasını paralel yapar; tanınan Viyana/Wien/vienna eşadları aynı city hedefini kullanır. Böylece adı farklı olup kaydında şehir bulunan radyolar da gelir. En fazla4 okuma; iptal/scope/limit korunur, logo kontrolü yok.
- STATION_SEARCH_VERSION tüm query cache anahtarlarının tek kaynağıdır. getStations(search) da aynı servise yönlenir; useStations arama sonuçlarını ülke kataloğunun disk cache'inden almaz/yazmaz.
- Canlı AllStationsviyana76sonuç: ViyanaFM yanında ORF/ KroneHit/FM4 gibi şehir kayıtları; Home aynı sonuç kümesinin sınırlı özetini gösterir. Favorilerde viyana→ViyanaFM+FM4 doğrulandı. Ülke/şehir/genres metadata testleri station-search.test.cjs içinde.
- UsersDirectory Unfollow mevcut pembenin kırık tonu#955572; Follow#FF4199 aynı. Gerçek takip durumu değiştirilmeden Cuneyt/diğer takip edilenlerde iki ton görsel ve DOM'dan teyit edildi.
- UserProfileScreen eski ayrı Modal'ı kaldırıldı; kendi profilimizle aynı ProfileShareSheet `profile` hedef prop'u alır. Oturum+hedef identity guardı korundu, private-profile kontrolü devam eder; teknikHTTP hata metinleri gösterilmez. Gerçek Cuneyt profilinde panel açılışı, aktif paylaşım kontrolleri, bottom720=viewport720/width430 ve dışa dokunarak kapanış doğrulandı. Dışarı paylaşım/follow değişikliği yapılmadı.
- Kontrol manifestinde Favoriler/arama/sıralama/boş, Takipçiler, Takip edilenler, Profil paylaş zaten mevcut; final işaretleri değiştirilmedi. Public-profile-actions ve station-search testleri geçti; TypeScript baseline'a göre yeni hata yok.

### 2026-11-11 — Ortak arama / logosuz radyo

Mobil sibling frontend üzerinde: Figma App radio-logo2269:8153 özgün gri SVG ve 8x PNG alındı; ortak fallback ve native CarPlay kaynağına bağlandı. Bilinen Mega/default/no-image URL’leri gerçek logo metadatasından ayrıldı. Tam tür sorguları ortak katalog niyetine yönlenir, ülke kapsamı korunur; oy DESC, eşit oyda gerçek logo metadatası. Görsel probe yok. İsim aramasında tam eşleşme önceliği korunur. Tür katalog verisi tek paylaşılan beş dakikalık cache kullanır. Preview demo profil paylaşımında gerçek servis çağrısı/geçersiz link yerine açıklama gösterilir.

Kontrol: station-search, public-profile-actions ve discovery-world-validation testleri geçti; TypeScript mevcut hata tabanına göre yeni hata yok. Web önizlemede Global Pop ve gri fallback, demo paylaşım açıklaması doğrulandı. Native CarPlay bu turda cihaz üzerinde çalıştırılmadı.

### 2026-11-11 — Profil onayı / bildirim hedefleri

Mobil hesap silme modalına navigationBarTranslucent eklendi. Telefon önizlemesinde deleteModal için saat ve home-indicator karartması .6 ile modalın %40 siyah katmanına eşitlendi; önce üst .4, alt karartmasızdı. Açık profil metni EN/TR/DE kısa anahtara geçti: “Artık herkes seni keşfedebilir.” Bildirim hedef çözümleyicisi radyo ekleme/favori ekleme/çıkarma/system payload stationId/slug, kullanıcı ve mesaj hedeflerini ortak çözer. Radyo önce gerçek servisten çözülür, ortak player’a atanıp /player açılır; geçersiz kayıt hata rotasına gönderilmez, ortak işlem bildirimi kullanılır. stationId query param’ı player tarafından kullanılmıyordu; sadece new_station dalı vardı. Bildirim artwork ve açma aynı query cache’i kullanır. Hedef testleri geçti, mevcut TS tabanına yeni hata yok. Hesap silme onayı gönderilmedi; gerçek bildirim okundu mutasyonu test amacıyla çalıştırılmadı.

### Bildirim merkezi ayrıştırması — 2026-11-11

Kullanıcı sağdaki “New message” etiketini reddetti. Microsoft Teams resmi activity-feed anatomy referansı (https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/design/activity-feed-notifications): avatar, etkinlik türü ikonu, aktör+sebep, timestamp ve önizleme. Mega uyarlaması: avatar köşesinde mesaj/follow tür rozeti; radyo artwork yuvarlatılmış kare, kullanıcı fotoğrafı daire. Sağda küçük yerelleştirilmiş zaman + yalnız okunmamış kayıtta6px Mega noktası. Ayrı metin etiketi yok. Mesaj önizlemesi tek satır. iPhone15/SE web genişliklerinde doğrulandı; TypeScript tabanına yeni hata eklenmedi.

Bildirim son kontrolü: sağ zaman 11/15 Ubuntu-Regular #A4A4AE, 5px Mega okunmamış noktasından8px aralık; sabit5px işaret alanı okununca zamanın kaymasını önler. Zaman notificationTime yardımcıyla yerelleştirilmiş kısa birim (TR 3dk, EN3min), geçersiz/geçmiş/gelecek sınırları testli. 393px ve375px önizlemede zaman/nokta merkez farkı0px, yatay taşma yok; TS hata tabanına ek hata yok.

### Bildirim açılışı optimizasyonu — 2026-11-11

notificationQueryOptions tek owner-scoped anahtarını Home zil onPressIn ve Notifications focus/mount paylaşır. Focus refetch() yerine staleTime30s ile dedupe eden prefetchQuery kullanır; in-memory gc60s→15dk, sinyalli8s timeout, en fazla1 retry,401/403 retry yok. Push/sohbet invalidation aynı anahtarı bozar ve yeniden veri alır. Hazır previewRows sunucu listesini bekleyerek skeleton altında tutulmaz. FlatList ilk8/batch6/window5, viewable satırlar dışındaki eksik artwork istekleri kapalı; aynı stationId artwork ve açma cache’ini paylaşır. Tarih Intl formatter’ları dil bazlı bounded cache kullanır. notification-loading.test.cjs gerçek QueryClient ile zil/mount/focus tek istek, taze dönüşte0 ek istek, invalidation yenilenmesi, hesap ayrımı ve iptal testlerini geçti. Hedef/zaman testleri geçti; TS tabanına ek hata yok. Web görsel kontrol tamam; gerçek cihaz ms benchmarkı yapılmadı.

### Ortak yükleme standardı — 2026-11-11

Telefon push kapatma mesajı kısa anahtara taşındı (TR “Telefon bildirimi kapalı; zil açık.”, EN “Phone alerts off; app bell on.”); gerçek kaydetme/izin işlevleri korundu. Tercih alt metni de kısaltıldı.

MegaLoadingState: katalog/tür detayı, müzik türleri satırları, favori grid/liste, kullanıcı profili, kullanıcı rehberi, takip/takipçi, bildirim, konuşmalar ve geçmiş, grup kişi seçimi/geçmiş, radyo seçici, dil, ülke, girişte çal, istatistik, yasal/bilgi/About; Home tür şeridi/popüler/nearby/kullanıcılar/tüm radyolar. Yeni geometri gerçek sayfadaki grid/liste/öğe türüne göre seçilir; header/footer değiştirilmez. Hazır Home verisi arka plan isteklerinde korunur.

Skeleton eski ayrı layout exportları kaldırıldı; temel + MegaLoadingState tek kaynak. useSharedLoadingMotion ring800ms/shimmer1200ms iki saat, tüm elemanlarda tek accessibility/AppState abonelik çifti; isInteraction:false, reduced-motion/background durması, son kullanıcıda temizlik. MegaRefreshControl native pull hareketini koruyarak iOS/Android rengi birleştirir. Radyo görselleri Expo placeholder ve120ms yüklenme geçişi; profil fotoğrafları cache'li ExpoImage + aynı içerik silueti. Fotoğraf upload halkası20px yuvasına göre20px çizilir.

Kontrol listesi: Ortak durumlar / Yükleme durumları · ortak sistem ve Telefon bildirimi kapalı · kısa mesaj eklendi; final durumları değiştirilmedi. Build: Expo web export başarılı (/tmp/mega-loading-web-final). TypeScript tabanına ek hata yok. shared-loading-motion, loading-standard, push-preferences, public-profile-actions, notification-loading, notification-target testleri geçti. Native cihaz çalıştırması yapılmadı.


### 11 Kasım 2026 — mobil katalog sırası ve remove-ads paywall

Tür/Tüm İstasyonlar ekranında sıralama sunucudan isteniyor; sayfa içi sıralama
kaldırıldı. PostgreSQL okuyucuda ana sıralama logo önceliğinden önce gelir;
oy eşitliğinde click_count kullanılır. İlgili API cache anahtarları yenilendi.
21 izole sıralama/tür rota testi ve API typecheck geçti. Gerçek PostgreSQL
entegrasyon paketi test bağlantısı olmadığı için çalıştırılmadı; canlıya dağıtılmadı.
Figma App remove-ads-paywall frame 2414:8941 (375×812) tarayıcıdan doğrulandı.
Önizleme üst/alt alanlarında Profil temasının modalı ezmesi düzeltildi; Android
modalı status/navigation alanına uzanır. Satın alma işlemi yapılmadı.

Remove-ads önizleme performansı: aynı PremiumPaywall, Profil ekranını
mount etmeyen `app/remove-ads.tsx` doğrudan girişinden açılır. Wrapper hero
katmanı modal hazır mesajından önce gösterilmez; üst/alt birlikte hazırlanır.
Modal unmount olduğunda tema temizlenir. Native IAP hazırlığı etkileşimler
sonrasına ertelenir; iptalde görev ve geç kalan state güncellemeleri engellenir.
Web export geçti, mevcut TypeScript hata kümesine yeni hata eklenmedi.

### 2026-11-11 · Grup bilgileri: diğer müzik türleri
Aktif mobil kaynak `../megaradioIOSAndroidReact/frontend`: ortak GroupMusicStyles son sabit tür yerine Diğer türler açar. GroupGenrePicker mevcut AccountEditor siyah302px/radius6/#292929 kutusunu, ortak arama odağını ve44px kaydırma adımlı tür çarkını kullanır. Katalog lazy ve10dk cache, en fazla4 eşzamanlı sayfa; üç tür sınırı ve seçili tür kaldırma korunur. Grup düzenleme aynı bileşeni kullanır; özel sohbetin mevcut options listesi değiştirilmedi. Tür slugları servis/preview store'a mevcut genres alanıyla aktarılır, keşifte tireli tür adları normalize edilir.
Sunucu chat-group-routes yeni türleri cached public katalog whitelist'iyle doğrular; mevcut varsayılan12 tür uyumlu. Bu backend değişikliği deploy edilmedi.17 chat-groups testi, discovery catalog testi ve API tsc geçti; mobil TS mevcut tabana göre yeni hata vermedi. UI: Blues/Jazz ekleme,3 tür sınırı ve popup kapanışı kontrol edildi. Figma MCP Starter kotası dolu olduğundan mevcut doğrulanmış AccountEditor kutu ölçüleri yeniden kullanıldı.
2026-11-11 devam: Kullanıcı popup'taki ilk tür öncesi boşluğun azaltılmasını istedi. Çarkın88px başlangıç/son dolgu alanı kaldırıldı; aynı220px alanda5 tam44px dokunma satırı görünür, arama-altı10px. Kaydırma seçimi kendiliğinden değiştirmez; satıra dokunma açık seçimi yapar. Seçili satırın nötr zemini ve Ekle/Kaldır işlemi korunur.
2026-11-11 sonraki kullanıcı yönlendirmesi (alarm Figma93WU6qa5fB9HBxkXXsc9WV referans görseli): Tür seçici yeniden ortada sabit#111 bant, Ubuntu-Medium20/18 ve mesafeye göre solan5 satır kullanır. GenreWheel sanallaştırılmış FlatList ile eşdeğer çevrim slotlarını ortadan başlatır; ilk tür öncesinde boşluk bırakmaz. Scroll snap46px, web140ms idle hizalama; sınır eşdeğer slotlara yalnız kayma bitince yeniden merkezlenir. Satıra dokunma da merkezler. Bant popup genişliğinde; arama/çark arası18px. UI kaydırma sonrasıLatin jazz satırı ile bandın merkez farkı0px ölçüldü, Ekle sonucu grupta seçili doğrulandı. Mobil TS yeni hata yok.
2026-11-11 özgün band düzeltmesi: Kullanıcının uyarısıyla Figma93WU6qa5fB9HBxkXXsc9WV dosyası UI üzerinden incelendi. alarm/action-sheet1:3923 → Frame1181:3925 → Frame1171:3926:375×58,white6%. ÜstLine2 node1:3939 ve altLine3 node1:3940,236×1/opacity40%, farklı radial stoplar. İkisi Figma UI SVG export ile orijinal olarak indirildi, değiştirilmeden mobil assets/images/genre-picker altına alındı. GenreWheel bandı %6 beyaz ve çizgiler236/375 oranıyla gerçekSVGleri kullanıyor; center font22, yakın18, uzak16 ile hafif balık gözü. Heriki görsel doğal236×1 boyutuyla yüklenmiş doğrulandı. YeniTS hatası yok. KaynakREADME vegroup-genres-original-figma-band.png mevcut.

### 2026-11-11 · Çalmayan radyoyu bildir
Aktif mobil PlayerErrorState kartının üst içine sabit44px dokunma alanlı, Ubuntu-Medium13/16 “Sorunu bildir” eklendi; kart ve alt içerik ölçüleri değişmez. Offline durumda verilmez. stationIssueReporter mevcut POST /api/stations/report-error servisine USER_REPORT gönderir; başarı yalnız sunucu makbuzuyla, hatada yeniden deneme, eşzamanlı dokunma birleştirme ve cihaz başına24saat tekrar koruması vardır. Ortak ProfilePhotoFeedback kullanılır.
Mevcut PostgreSQL station_debug_logs ve korumalı /admin/error-logs alanı kullanılıyor. Admin kaynak koduna User Report filtresi/rozeti eklendi; bu admin değişikliği deploy edilmedi.31 rota testi ve izole rapor servisi testleri geçti; kalıcılık adaptörü testte mock, canlı PostgreSQL yazımı yapılmadı. Mobil TS mevcut hata tabanına yeni hata eklemedi. Önizleme raporu sunucuya göndermez ve bunu açıkça belirtir. UI gönderim öncesi/sonrası kart geometrisi aynı ölçüldü; player-report-radio.png kaydedildi.

### 2026-11-11 · Mobil premium plan güncellemesi
PremiumPaywall şarkı bilgisi maddesi yerine Sınırsız mesajlaşma gösterir; yalnız özellik metni değişti, mesaj kotası eklenmedi. Yeni satış seçenekleri yıllık€29.99,3aylık€9.99,aylık€3.99; Figma düzeni korunur. Üç aylık ürün megaradio_premium_quarterly/premium_quarterly olarak mobil IAP,store,restore ve sunucu IAP doğrulama/abonelik eşleştirmesine eklendi. Eski lifetime hakları/restore korunur, paywall yeni lifetime satmaz. Mağaza ürün fiyatı varsa gerçek fiyat kullanılır; ürün mağazadan dönmezse satın alma başlatılmaz. Apple/Google ürün/fiyat tanımı henüz doğrulanmadı, satın alma yapılmadı; backend deploy edilmedi. API typecheck ve quarterly mapping/feature parity/legacy restore kontrolleri geçti; mobil mevcut TS hata kümesine yeni hata yok.

### 2026-11-11 · Premium yükleme/animasyon son kontrolü
Kod ve web önizleme kontrolü:240ms açılış/220ms kapanış opacity animasyonu,useNativeDriver,true reduced-motion desteği ve effect temizliği var. Mağaza modülü/fiyat hazırlığı InteractionManager ile ilk çizim sonrasına bırakılıyor; webde IAP başlatılmıyor. Figma özgünhero.svg968KB yerel asset; görsel375×415 SVG içinde1500×1000 fotoğrafı koruyor, kaliteyi düşürmek için değiştirilmedi. DOM doğrulamasında iki görsel complete, modalopacity1,430×839 içerik,3plan ve footer hazır. Kapat/yeniden aç,3aylık seçim,gizlilik/dönüş ve seçimin korunması doğrulandı. Kare-süre/FPS ya da cold-cache ağ ölçümü yapılmadı; gerçek iOS/Android IAP gecikmesi ve native kare akıcılığı bu kontrolde doğrulanamaz. Ek tasarım/kod değişikliği gerekmedi. Final işareti kullanıcıya bırakıldı. Görsel:premium-final-check.png.


## Ortak Analytics sözleşmesi (11 Kasım 2026)

Aktif web ve mobil uygulamalarında sayfa/radyo ölçümü ortak AnalyticsSession üzerinden yürür. Yeni ekranlarda rota/overlay gözlemcisini kullan; seçimi play sayma, gerçek oynatma durumunu esas al. Dahili kullanıcı kimliği çıkışta temizlenir; e-posta, mesaj içeriği ve serbest arama metni gönderilmez. Yerel önizleme üretim Analytics verisini kirletmez. Yeni ekran veya oynatma kontrolünde bu sözleşmenin testini koru.

Canlı Google kayıtları, Search Console eski ilişki bulgusu, doğrulamalar ve yayın sınırları: [Analytics ve Search Console kontrolü](audits/analytics-search-console-2026-11-11.md).

### Mobile preview wrapper — photo viewer synchronization (2026-11-11)

The running 8082 server serves `/private/tmp/megaradio-mobile-preview`, not the tracked `docs/mobile/preview` directory. Wrapper changes must be mirrored to the running file and the existing outer review frame reloaded before visual verification. Verify the actual HTTP response includes the change; checking the 8081 application alone cannot validate status/home strip integration. Profile photo overlay uses `profilePhotoProgress` to shade both strips on the same animation clock. Dev-only `user-profile?previewPhoto=1` opens this state for reproducible full-device QA.

### Mobil tür kapsamı ve bayrak netliği (2026-11-11)
- Aktif mobil `app/(tabs)/genres.tsx`, AllStations/GenreDetail ile aynı ülke store ve CountrySelectorModal kullanır; ülke değişimi tür kataloğunu ve sayfayı sıfırlar. Başlık merkezi korunur.
- 60 basit tür satırı aynı render partisinde hazırlanır (`initialNumToRender`/`maxToRenderPerBatch`=60, batch gecikmesi=0). Ortak180ms `useCatalogPageScroll` değişmedi; yeni sayfa kaydırmayı beklemez. Global2. sayfa kontrolünde60 satır ve61–120/407 özeti güncel, kaydırma0.
- Ortak `CountryFlag`: ISO kodundan320px kaynak, görünür satır yüklemesi, memory-disk cache, geri dönüşte emoji. API223 ülke için40px kaynak veriyordu;40px yuvarlakta kırpma ve cihaz piksel yoğunluğu bulanıklık yapıyordu. Seçici ve katalog başlıkları ortak bileşeni kullanır.

### Mini player rapor geri bildirimi düzeltmesi (2026-11-11)
- `MiniPlayer` rapor kontrolü80px sabitgenişlik ve tek satır etiket kullanır; `Bildirildi ✓` satır atlamaz.
- Geçici geri bildirimde ortak `ProfilePhotoFeedback` stili korunur. Konum tahmini dock yüksekliği yerine oynatıcının `onLayout` ile ölçülen üst sınırına bağlanır; kutu mini player üstünde16px boşluk bırakır.
- Yerel hata önizlemesinde onay ve16px gerçek DOM mesafesi doğrulandı; önizleme gerçek istasyon için rapor göndermez.

### Cihaz önizlemelerinde ortak güvenli alan / ekran teması (2026-11-11)
- 15 Pro Max `index.html` ve `home-device.html` aynı `preview-theme.js` köprüsünü kullanır. Önceki yeni cihaz host'u yalnız Home, miniPlayer ve tabDock dinliyordu; Premium/Player/Sleep/Share vb. ekran bildirimleri eksikti. Premium üst hero geçişi ve alt#131313 önceliği artık ortak; altta Home tab rengi kalmaz.
- Ölçüler doğrulanan `__megaPreview` URL başlangıç parametresiyle aktarılır ve yalnız ilgili önizleme sekmesinin sessionStorage alanında korunur; iframe `name` eski hostlar için geri dönüş yoludur. Tarayıcı geçişte pencere adını temizlese de ölçüler kaybolmaz. Aktif mobil `previewSafeArea()` sadeceDEV/web/proxy/gömülü önizlemede bu ölçüleri okur;59px varsayımı Home, Player, Premium veAbout arkaplan uzatmalarından kaldırıldı. Android24px ve iPhone59px aynı koordinat hesabına bağlandı. Yerel/üretim sürümü bu yolun dışında; native SafeAreaContext ve mevcutedge-to-edge korunur.
- Ana15 Pro Max ölçüleri430×932, üst59/alt34 değişmedi. Yeni host'larda model ölçüsü kullanılır; yeni görsel veya tasarım boyutu üretilmedi. Kaynak ve çalışan `/private/tmp/megaradio-mobile-preview` kopyaları eşit.
- Araştırma: Expo System Bars ve React Navigation Supporting Safe Areas; arka plan kenarlara kadar sürer, içerik sistemin ölçtüğü güvenli alanı kullanır. AndroidRN0.81.5 / Expo54 projedeedgeToEdgeEnabled zaten açık. Bu tarayıcı testini gerçek native işletim sistemi testinin yerine sayma.
- Doğrulama: `scripts/tests/mobile-preview-theme.test.cjs`5 profil, Home→Premium→Player→Home; mobil `scripts/tests/preview-safe-area.test.cjs` native/production izolasyonu ve24/59px ölçüler. iPhone15Pro Premium veS8 Player görsel kontrolü.

### Ek cihaz önizlemeleri (2026-11-11)
- `home-device.html`: Xiaomi13 393×873, OnePlus9 412×915, HuaweiP30 360×780, SonyXperia5II 360×840 eklendi; bunlar boyut profilleri, cihaz/OS emülasyonu değildir.
- iPhoneDuo kapalı466×678 ve açık890×626 ayrı profiller. Apple specs dış1398×2034 ve iç2670×1878 panel ölçülerinden @3x varsayımıyla türetilmiş yaklaşık mantıksal test alanlarıdır. Native reserved-region, yan sistem çubukları, katlanma ve gerçek safe-area değerleri tarayıcıda emüle edilmez; native doğrulama yapılmadan cihaz desteği tamamlandı sayılmaz. Kaynak: https://www.apple.com/iphone-duo/specs/ ve https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo .
- Tasarım kaynaklarına müdahale edilmedi. Altı sekmede gerçek Home içeriği açıldı; ortak tema testi10 ölçü profiliyle geçti.

### Birebir keşifte ortak diğer türler (2026-11-11)
GroupMusicStyles özel options verildiğinde de aynı GroupGenrePicker/GenreWheel açar. PrivateRadioDiscovery Aşk listesinin son sabit türü Diğer türler olur; eklenen katalog türü seçili chip olarak korunur. Discovery görünümünde düğme komşularıyla aynı boyutta. Grup seçici, özgün Figma seçim bandı,3 tür sınırı ve katalog cache aynen ortak. UI Blues arama→Ekle→seçili chip→yeniden açınca Kaldır doğrulandı. Private discovery testi eski analytics hook mock eksikliği giderilerek geçti; mobil tsc mevcut tabana göre yeni hata yok.

2026-11-11 tür seçici davranışı: Ortak GroupGenrePicker içinde Kaldır seçimi günceller, popup açık ve aynı arama/çark konumunda kalır. Ekle seçimden sonra kapanır. Birebir keşifte3/3→Kaldır→2/3 ve popup açık, ardından Ekle→3/3 ve popup kapalı UI üzerinde doğrulandı; grup da aynı bileşeni kullanır.

### Birebir tür seçimi: seçililer ve kenar birleşimi (2026-11-11)
- GroupGenrePicker açılışındaki seçili türler katalog başına alınır; ilk seçili tür çarkın merkezinde açılır. Öncelik açılışta dondurulur: Kaldır açık popup/çark konumunu bozmaz. Yeniden açıldığında güncel seçililer başa gelir, eski arama temizlenir. Ortak olduğundan grup da aynı davranışı kullanır. UI Pop+Rock→Diğer türler merkezPop✓, sonrakiRock✓ doğrulandı.
- PrivateRadioDiscovery choosing durumu DEV preview köprüsüne privateDiscoveryChoices, picker genrePicker bildirir. Dış üst/alt zemin#1B1B1B, picker açıkken#101010; sohbet composer rengi artık taşmaz. Native Modal navigationBarTranslucent ile root zemini alt güvenli alana sürer; SafeAreaInsets korunur.
- iPhone15ProMax430×932 veS8 360×740 gerçek uygulama iframe görsel kontrolü;10 profil host teması regresyonu ve özel keşif testi geçti. TSC mevcut hata tabanına yeni hata eklemedi. DEV-only privateDiscovery host ekranı messages?previewDiscovery=1 yolunu açar, gerçek oturum/üretimde devre dışıdır. Kaynak/çalışan8082 host kopyaları güncellendi.

### Tür popup yükleme optimizasyonu (2026-11-11)
GroupGenrePicker sorgusu artık tarz formuyla mount olurken başlar; Diğer türler dokunuşunu beklemez. limit100 yerine500: mevcut407 tür5 istek yerine1 istekte tamamlanır; katalog büyürse mevcut en fazla4 eşzamanlı worker sayfaları tamamlar. Aynı global query key,10dk freshness ve30dk kullanılmayan cache süresi ile grup/birebir paylaşır. Tasarım ve çark davranışı değişmez. Proxy API tek ölçüm:100lük ilk sayfa1203ms/5 sayfa,500lük tamkatalog1273ms/1 sayfa; toplam eski süreyi ölçmedik, bunlar garanti hız iddiası değildir. Yeni tarayıcı oturumunda form→Diğer türler doğrudan dolu çarkla açıldı; private discovery testi geçti, yeniTSdiagnostic yok.

### 2026-11-11 · Car Mode keşif hareketi
- Car Mode ger-bırak logo halkası, sohbet keşfiyle aynı 1050 ms süre ve cubic ease-out ile bırakma anında UI üzerinde hareket eder; sağ/sol yönü korunur.
- Yalnız görsel faz animasyonu değişti. Doğrulanmış radyo seçimi, canlı yayın kontrolü, oynatma ve mevcut yerleşim korunur. Hareket azaltma ve iptal temizliği devam eder.
- Doğrulama: discovery-pull-motion ve discovery-release-start testleri geçti; TypeScript kontrolünde önceki çıktıya göre yeni hata yok. Car Mode önizlemesinde iki yönde keşif sonucu alındı.

### 2026-11-11 · Car Mode gerçek oynatma
- Car Mode önizlemesindeki seed radyo yalnız başlangıç içeriğidir; ger-bırak, kart seçimi ve play/pause gerçek AudioProvider üzerinden çalışır. Sahte previewPlaying durumu kaldırıldı; ses ve mute da gerçek oynatıcıya bağlıdır.
- Doğrulama: keşfedilen radyoda audio paused=false, readyState=3/4 ve ilerleyen currentTime görüldü. Pause paused=true; tekrar play paused=false. Önceki TypeScript çıktısına göre yeni hata yok; ger-bırak hareket testleri geçti.

### 2026-11-11 · Keşif bayrakları ve ortak ülke bilgisi
- Dünya ger-bırak geçişindeki görsel rezerv global katalog önbelleğinden hazırlanır; genel uygulama ülke filtresini devralmaz. Normal Car Mode gezinmesi ülke seçimini korur. Görsel rezerv yayın doğrulamasını veya sonuç seçimini değiştirmez ve ek decoder açmaz.
- Car Mode, birebir ve grup keşfinde her kayan kart kendi istasyon ülke bayrağını taşır; merkez yakınında okunur, kenarlara doğru söner. CountryFlag recyclingKey eski bayrağın yeni görselde kalmasını önler.
- StationCountryBadge ortak bileşeni Car Mode, çalma ekranı ve sohbet keşfinde aynı 44px hedef/28px bayrak, yerelleştirilmiş ülke adı, kısa süreli siyah tooltip ve Escape/blur kapanışını sağlar.
- Doğrulama: global rezerv/katalog cache testi ve mevcut dünya yayın uygunluk testi geçti; yeni TypeScript hatası yok. Tarayıcıda player bayrağına dokununca Almanya tooltip'i, geçiş kartlarında US/HU/GB/CZ/IR/FR/PL/RU bayrak kaynakları doğrulandı.
