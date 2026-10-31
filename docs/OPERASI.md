# Operasi scraper

## Memantau pembaruan

- Buka tab **Actions** di GitHub untuk melihat alur persiapan, job Glints, dan job JobStreet. Job JobStreet akan dilewati jika variabel repository `SCRAPER_RUNNER` belum diisi.
- Di aplikasi, buka **Kelola Tautan** untuk melihat status dan waktu pembaruan terakhir.
- Untuk verifikasi baca-saja dari mesin lokal, jalankan `npm run verify:scrape`. Atur `SCRAPE_SOURCE`, `SCRAPE_OWNER_ID`, atau `SCRAPE_SOURCE_URL` bila ingin membatasi sumber, akun, atau tautan.
- Jadwal workflow adalah 05:00 dan 17:00 UTC, setara dengan 12:00 dan 00:00 WIB. Jadwal GitHub Actions dapat terlambat beberapa menit.
- Pada repository publik, GitHub menonaktifkan workflow terjadwal otomatis setelah 60 hari tanpa aktivitas repository. Periksa Actions dan aktifkan kembali jadwal bila GitHub menonaktifkannya.

## Arti status

- **berhasil**: pembaruan sumber selesai tanpa detail gagal.
- **sebagian**: sebagian detail berhasil, tetapi ada detail yang perlu diperiksa.
- **gagal**: proses tidak selesai karena kesalahan lain.
- **diblokir**: situs mengembalikan 403 atau mendeteksi captcha/pemblokiran. Data lama tetap dipertahankan; jangan mencoba melewati pembatasan.
- **dibatasi**: JobStreet mengembalikan 429/503. Scraper menghormati `Retry-After`, menghentikan permintaan JobStreet pada run tersebut, dan menjaga data lama. Link dilewati selama minimal enam jam; permintaan manual dalam masa ini mendapat pemberitahuan, bukan error.

Jika JobStreet berstatus **dibatasi**, tunggu sampai waktu perkiraan pada pesan status sebelum menjalankan ulang. Jangan memicu permintaan tambahan selama pembatasan masih berlaku.
