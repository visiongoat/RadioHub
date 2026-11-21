# Analytics kontrolü — 21 Kasım 2026

## Canlı gözlemler

GA4: Mega Radio / Mega Radio — Web & Apps, hesap 415895122, mülk 530834250.
- Aktif iOS akışı: 14288752994, com.visiongo.megaradio; son 48 saatte veri alıyor.
- Aktif Android akışı: 14288778040, com.megaradio; son 48 saatte veri alıyor.
- Aktif Web akışı: 16263898669, G-3X2WGQC0J3; son 48 saatte veri alıyor. Canlı bundle aktivasyonu açık, GTM-WRF32ZCN yükleniyor; bağımsız web izninden önce yüklenmiyor.
- Eski iki iOS akışı 14288702752 ve 14288799332 veri almıyor. Silme onayı uygulanmadı; geçmişi/olası eski istemcileri korumak için bırakıldı.
- Canlı GTM konteyneri yalnız megaradio_page_view ile page_view gönderiyor. megaradio_event ve radyo parametreleri için yayınlanmış etiket yok. Bu nedenle uygulamanın dataLayer'a bıraktığı radyo/dinleme olayları Google'a gitmiyordu.
- Mobil Realtime ekranında gerçek screen_view, activity_heartbeat, listening_time ve reklam teslim olayları gözlendi; TV olarak atanmadı.
- Web sunucusundaki TV paneli GA4 configured / payload validation pending ve son 7 günde sıfır izinli rapor gösterdi. Asıl TV ingestion API hostunda admin oturumu yok; bu panel tek başına API relay durumunu doğrulamaz. Salon TV ağda erişilebilir, fakat GA'da bu cihaza ait doğrulanmış olay görülmedi. İzin, uygulama içi raporlama ve API teslimi ayrıca gerçek cihazla doğrulanmalı.

## Web düzeltmesi

Sayfa görüntülemenin sahibi mevcut GTM etiketi olarak kaldı. İzinli ve public rotadaki ürün olayları aynı Google tag'e tek doğrudan gtag event komutuyla, açık send_to ve client_surface=web ile gönderiliyor. Artık işlenmeyen megaradio_event zarfı üretilmiyor; GTM'de ikinci ürün-event etiketi eklenmemeli.

URL query/hash ve özel rotalar korunur. Olay adı ve alan allowlist'i korunur. E-posta, mesaj içeriği ve ham arama gönderilmez. Başlık sabit MegaRadio, page_location/referrer mevcut public filtrelerden geçer. Ret/geri çekme/private-route kilidi bütün yeni olayları durdurur. İzin öncesi olaylar sonradan gönderilmez.

Geç izin verme durumunda yalnız o anki güvenli hesap/oynatıcı bağlamı bellekte korunur; geçmiş olay kuyruğu yok. Dahili 24-hex ve user_ biçimindeki kimlikler desteklenir, e-posta reddedilir, çıkışta user_id null olur. Oturumsuz farklı cihazlar birleştirilmez. Native iOS/Android kimlikleri kendi Firebase akışlarında kalır. TV relay'i tv_platform/tv_ olaylarıyla Web akışını kullanır; GA'nın yerleşik Web platform sayacı TV ile internet sitesini tek başına ayıramaz.

## Kontroller

- Analytics/consent hedefli 4 dosya: 200 test başarılı.
- Footer/izin arayüzü 2 dosya: 62 test başarılı.
- İzole origin/main tabanında kütüphane tipleri, web TypeScript ve üretim build başarılı.
- Kirli ana çalışma alanındaki geniş test koşusunda ilgisiz legal-content-localization 14 testi başarısız; analytics testleri başarılı. Yayın yalnız üç analytics dosyasını ve bu notu içerir.

Kaynaklar: https://developers.google.com/analytics/devguides/collection/ga4/events ; https://developers.google.com/analytics/devguides/collection/ga4/user-id ; https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference .
