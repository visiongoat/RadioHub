# Mega Radio — Figma tasarım çalışma notları

## Başlangıç

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
