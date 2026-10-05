# Ustatahir Konutları aidat sistemi

Site sakinleri kullanıcı adı ve şifreyle girip yalnızca kendi dairelerinin aidat durumunu, site giderlerinin özetini ve duyuruları görür. Yönetici hesabı bütün ekranlara (ödeme girişi, takip, giderler, raporlar, sakin hesapları) erişir.

- `index.html`: uygulamanın tamamı (GitHub Pages ile yayınlanır)
- `firestore.rules`: Firebase Firestore güvenlik kuralları. Kim neyi okuyup yazabilir, veritabanı bu dosyayla belirler; Firebase konsolunda Firestore → Kurallar bölümüne yapıştırılır.

Özellikler: ödeme/borç takibi, nakit tahsilat makbuzu (PDF), banka dökümünden ödeme eşleştirme, sakin ödeme bildirimi, arıza/talep takibi, anket, grup hesabı (birden çok daire), sözleşme/bakım hatırlatmaları, raporlar.

Veriler Firebase (ustatahir-pano projesi) üzerinde tutulur.
