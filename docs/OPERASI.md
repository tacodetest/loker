# Operasi scraper

## Memantau pembaruan

- Buka tab **Actions** di GitHub untuk melihat job scrape Glints dan hasil verifikasi.
- Di aplikasi, buka **Kelola Tautan** untuk melihat status dan waktu pembaruan terakhir.
- Untuk verifikasi baca-saja dari mesin lokal, jalankan `npm run verify:scrape`. `SCRAPE_OWNER_ID` dan `SCRAPE_SOURCE_URL` dapat membatasi akun atau tautan.
- Jadwal workflow adalah 05:00 dan 17:00 UTC, setara dengan 12:00 dan 00:00 WIB. Jadwal GitHub Actions dapat terlambat beberapa menit.
- Pada repository publik, GitHub menonaktifkan workflow terjadwal otomatis setelah 60 hari tanpa aktivitas repository. Periksa Actions dan aktifkan kembali jadwal bila GitHub menonaktifkannya.

## Arti status

- **berhasil**: pembaruan sumber selesai tanpa detail gagal.
- **sebagian**: sebagian detail berhasil, tetapi ada detail yang perlu diperiksa.
- **gagal**: proses tidak selesai karena kesalahan lain.
- **diblokir**: situs mengembalikan 403 atau mendeteksi captcha/pemblokiran. Data lama tetap dipertahankan; jangan mencoba melewati pembatasan.
- **dibatasi**: Glints mengembalikan 403/429/503 atau captcha. Scraper menghormati `Retry-After`, menghentikan permintaan pada run tersebut, dan menjaga data lama. Tautan dilewati selama minimal tiga jam; permintaan manual dalam masa ini mendapat pemberitahuan, bukan error.

Jika Glints berstatus **dibatasi**, tunggu sampai waktu perkiraan pada pesan status sebelum menjalankan ulang. Jangan memicu permintaan tambahan selama pembatasan masih berlaku.
