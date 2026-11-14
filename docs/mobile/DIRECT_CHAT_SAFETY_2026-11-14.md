# Birebir sohbet güvenliği ve canlı sohbet geçişi — 14 Kasım 2026

Birebir sohbet başlığı kişi menüsünü açar: profil, takipten çık, engelle/engeli kaldır ve şikâyet. Takipten çıkmak mesajlaşma iznini değiştirmez. Engelleme iki yöndeki yeni mesajları, tepkileri, sabitlemeyi ve etkinlik sinyallerini engeller; geçmişi silmez. Ortak gruplardan çıkarmak bu işlemin kapsamında değildir.

Sunucu tercihi oturumdan belirler. Engelleme ve mesaj/tepki/sabitleme yazımı aynı sıralı PostgreSQL transaction advisory lock çiftini kullanır. Engeli kaldırma yalnız oturum sahibinin satırını siler. Karşı tarafa engelleme bildirimi gönderilmez; nötr izin yenileme olayı gönderilir. Çevrimdışı veya yeniden girişten sonra da SQL tercihi geçerlidir.

Şikâyet ayrı onay ister. Yalnız son beş gelen, herkesten silinmemiş mesaj inceleme kuyruğuna kopyalanır. Gönderilen mesajlar ve tüm konuşma kopyalanmaz. Bu teslim otomatik yaptırım veya bir insanın incelemeyi tamamladığı anlamına gelmez; yönetici inceleme ekranı bu değişikliğe dahil değildir.

## Doğrulama

- Ayrı, yalnız localhost:25439 üzerinde çalışan PostgreSQL 17 test veritabanı; üretim verisine bağlanılmadı.
- 35 hedefli API/depolama testi geçti. Gerçek kilit beklemesiyle yarış testi, iki taraflı engel/tek taraflı kaldırma, eski geçmişin korunması ve şikâyet kanıtı kapsamı dahil.
- Tüm migration'lar ve ikinci, değişiklik yapmayan migration çalıştırması geçti.
- Sunucu TypeScript kontrolü geçti.
- Geniş API çalıştırmasında 5.799 test geçti; kalan sorunlar yerel fixture port whitelist'i, kurulu olmayan frontend jsdom/container-queries bağımlılıklarıdır. Bu çalışma için genel testlerin tamamı geçti denmez.
- Mobil kişi menüsü testi: engelle/kaldır, bağımsız takipten çıkma, hızlı çift dokunma, hata halinde sahte başarı göstermeme.
- Canlı sohbet teslim ve klavye gönderme regresyonları geçti. Mobil typecheck önceki 35 hatayı koruyor; yeni dosyalarda hata yok.
- iOS simülatör Debug build başarılı ve kuruldu. Metro yeniden başlatılıp uygulama açıldı. Bu oturumda GUI etkileşim aracı bulunmadığı için elle sürükleme/cihaz FPS testi yapıldığı iddia edilmiyor.

## Canlı sohbet geçişi

Başlık gesture nesnesi her parent render'da yeniden kurulmaz; kapanış callback'i güncel ref'ten okunur. Yeni parmak teması önceki geri dönüş yayını iptal eder. İptal edilen hareket geri toplanır. Yeniden görünürlük layout aşamasında offset'i sıfırlar. Klavye yüksekliği kapanışın başında sıfırlanarak tek karelik zıplama yaratılmaz; native klavye frame'i ve kapanış sonu temizliği korunur.

Sunucu PR'ı main'e alınmadan ve migration/API yayınlanmadan gerçek hesaplardaki engelleme özelliği canlı kabul edilmez. Yeni API istemcisi eksik serviste başarı göstermez. Mobil değişiklikler kaynakta ve simülatör derlemesindedir; bu iş için telefona yeni paket gönderilmedi.
