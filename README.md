# web_loker

Dashboard pencarian lowongan berbasis Next.js, React, TypeScript, dan Supabase. Scraper Playwright berjalan di GitHub Actions, bukan saat tombol dashboard diklik.

## Menjalankan aplikasi

```bash
npm ci
npm run dev
```

Buka `http://localhost:3000`.

## Konfigurasi dan migrasi Supabase

Salin `.env.example` menjadi `.env.local`, lalu isi `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY`. Key service-role hanya digunakan di server Next.js dan GitHub Actions; jangan gunakan prefix `NEXT_PUBLIC_` atau mengirimkannya ke browser.

Jalankan `supabase.sql` terlebih dahulu untuk menyiapkan tabel aplikasi dan migrasi data yang sudah ada. Setelah itu jalankan `supabase/schema.sql` di Supabase SQL Editor untuk membuat `saved_links` serta menambahkan status detail scraper. Migrasi ini menyalin tautan JobStreet/Glints dari tabel lama tanpa menghapus tabel atau data lama. Kolom/tabel progres scraper lama dipertahankan sebagai data historis, tetapi tidak lagi digunakan aplikasi.

`TAUFIK_PASSWORD` dan `ALYA_PASSWORD` hanya diperlukan untuk migrasi login awal. `GEMINI_API_KEY` wajib diatur untuk analisis CV; analisis tidak menggunakan pencocokan lokal sebagai pengganti AI. Scraper tidak menggunakan Gemini maupun layanan scraping eksternal.

Username tetap `taufik` dan `alya`. `TAUFIK_PASSWORD` dan `ALYA_PASSWORD` hanya dipakai untuk memindahkan password lama ke tabel login pada login pertama setiap akun. Setelah kedua akun berhasil login, variabel tersebut dapat dihapus. Password tersimpan sebagai hash scrypt dan dapat diganti dari menu **Akun**. Login memakai cookie sesi HTTP-only, membatasi satu sesi aktif per username, dan berakhir setelah 30 menit tanpa aktivitas.

Menu **Upload CV** menyimpan satu CV PDF maksimal 10 MiB di bucket Supabase Storage privat `private-cv`, di lokasi terpisah per pengguna. Upload baru menggantikan CV akun yang sedang masuk; pratinjau memakai URL bertanda tangan yang berlaku 10 menit.

Analisis CV mengambil lowongan aktif tujuh hari terakhir, menyaring maksimal 20 kandidat berdasarkan kemiripan kata pada judul dan deskripsi, lalu mengirim CV yang sudah disamarkan beserta kandidat tersebut ke Gemini. Penyaringan lokal hanya mengurangi ukuran permintaan; ekstraksi kata kunci, evaluasi persyaratan, penjelasan, dan skor seluruhnya dibuat oleh AI. Skor AI adalah perkiraan, bukan jaminan penerimaan. Atur `GEMINI_API_KEY`; model default adalah `gemini-2.5-flash` dan dapat diganti lewat `GEMINI_MODEL`. Sebelum teks CV dikirim, bagian identitas awal, kontak, nomor telepon, alamat, dan tautan disamarkan. Gemini free tier memiliki kuota yang dapat berubah dan Google menyatakan konten free tier dapat digunakan untuk meningkatkan produk. Teks CV tidak disimpan dalam tabel; hasil pencocokan disimpan per akun di Supabase sampai **Analisis ulang** berhasil.

Navigasi antarhalaman mempertahankan state sementara dalam memori tab. Hasil analisis CV tersimpan di Supabase agar tetap tersedia setelah refresh atau login kembali.

## Scraper dan HTML debug

Tambahkan tautan pencarian JobStreet atau Glints lewat menu **Kelola tautan**. GitHub Actions membaca semua tautan aktif dari Supabase, menemukan link lowongan, mengambil detail, lalu menyimpan hasilnya. Tombol **Muat ulang data** hanya membaca ulang data Supabase. Mengganti URL menghapus lowongan yatim dari URL lama; URL baru mulai diproses pada run otomatis berikutnya.

Jalankan `npm run scrape:debug` dengan URL pencarian yang ingin diuji di `.env.local`:

```env
DEBUG_JOBSTREET_SEARCH_URL=https://id.jobstreet.com/id/Warehouse-jobs/in-Surabaya-Jawa-Timur?daterange=7
DEBUG_GLINTS_SEARCH_URL=
```

Mode debug menyimpan HTML halaman pencarian ke `debug/`, menemukan tautan detail secara otomatis dari halaman itu, lalu menyimpan HTML detail pertama yang ditemukan. Ia juga mencetak deteksi JSON-LD, `__NEXT_DATA__`, serta nama field tanggal. Periksa file daftar dan detail yang dihasilkan, lalu isi selector yang sudah diverifikasi pada `scraper/sources/jobstreet.ts` dan `scraper/sources/glints.ts`. Selector sengaja dikosongkan sampai struktur situs nyata diperiksa; jika link tidak ditemukan, debug akan meminta konfigurasi `listingLinkSelector`. Untuk detail, JSON-LD bertipe `JobPosting` dicoba lebih dulu.

Setelah selector diverifikasi, pasang Chromium lokal dengan `npx playwright install chromium`, lalu scraper dapat dijalankan dengan `npm run scrape`. Proses memakai Chromium headless, satu browser secara berurutan, jeda antar halaman, batas 3 halaman per pencarian, maksimum 40 detail per run, maksimum 3 percobaan detail, rentang posting 7 hari, serta penghapusan data yang tidak terlihat selama 14 hari. Jika captcha atau pemblokiran terdeteksi, tahap detail dihentikan dengan status error; scraper tidak mencoba melewati perlindungan tersebut.

## GitHub Actions

Workflow `.github/workflows/scrape.yml` berjalan setiap 12 jam: pukul 12.00 dan 00.00 WIB (cron UTC `05:00` dan `17:00`) serta dapat dijalankan manual lewat **workflow_dispatch**. Atur repository secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Workflow memakai Node.js 20 dan menginstal Chromium Playwright. Job dinyatakan gagal hanya jika seluruh tautan tersimpan gagal.

## Fitur lain

Daftar lowongan memiliki pagination, pencarian judul, serta filter **Hari ini** atau **Semua (7 hari)** berdasarkan zona waktu Asia/Jakarta. Lowongan tanpa tanggal posting yang diketahui tetap ditampilkan dengan label **Tanggal tidak diketahui**; data dibersihkan setelah tidak terlihat selama 14 hari. Detail menampilkan deskripsi teks bersih dan tautan ke lowongan asli. Penghapusan tautan hanya menghapus lowongan yatim yang tidak dipakai sumber lain.

Layanan dashboard membaca data Supabase di sisi server menggunakan `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY`; keduanya tidak dikirim ke browser. Scraper memakai key yang sama hanya di GitHub Actions. Perubahan ini tidak mengubah alur pencocokan CV.

Untuk memeriksa scraper: `npm run test:scraper`, `npm run lint`, dan `npm run build`.

## Deploy on Vercel

Deploy aplikasi Next.js ke Vercel dan atur environment aplikasi yang diperlukan:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TAUFIK_PASSWORD` dan/atau `ALYA_PASSWORD` hanya saat migrasi login awal
- `GEMINI_API_KEY` dan opsional `GEMINI_MODEL` untuk analisis CV
- `GITHUB_REPOSITORY`, misalnya `pemilik/repositori`
- `GITHUB_REF_NAME=main`
- `GITHUB_TOKEN` berisi Personal Access Token GitHub yang dapat menjalankan workflow pada repositori tersebut

Setelah redeploy, aktifkan GitHub Actions di repository dan tambahkan `SUPABASE_URL` serta `SUPABASE_SERVICE_ROLE_KEY` sebagai repository secrets. Untuk pemicu scrape segera dari Vercel, token GitHub perlu permission **Actions: read and write** pada repository. Jadwal otomatis tetap dijalankan oleh workflow tanpa konfigurasi tambahan di Vercel. Jangan menaruh service-role key atau token GitHub pada variabel yang diawali `NEXT_PUBLIC_`. Setelah keduanya berhasil login, password legacy environment dapat dihapus.
