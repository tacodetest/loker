# web_loker

Dashboard pencarian lowongan berbasis Next.js, React, TypeScript, dan Supabase. Scraper Playwright berjalan terpisah dari permintaan halaman dashboard; tombol dashboard memicu proses lokal saat pengembangan atau workflow GitHub Actions saat terkonfigurasi.

## Menjalankan aplikasi

```bash
npm ci
npm run dev
```

Buka `http://localhost:3000`.

## Konfigurasi dan migrasi Supabase

Salin `.env.example` menjadi `.env.local`, lalu isi `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY`. Key service-role hanya digunakan di server Next.js dan GitHub Actions; jangan gunakan prefix `NEXT_PUBLIC_` atau mengirimkannya ke browser.

Jalankan `supabase.sql` terlebih dahulu untuk menyiapkan tabel aplikasi dan migrasi data yang sudah ada. Setelah itu jalankan `supabase/schema.sql` di Supabase SQL Editor untuk membuat `saved_links` serta menambahkan status detail scraper. Migrasi ini menyalin tautan JobStreet/Glints dari tabel lama tanpa menghapus tabel atau data lama. Kemudian jalankan `supabase/migrations/20261031_saved_links_last_success_at.sql` untuk menambahkan waktu scrape berhasil terakhir. Kolom/tabel progres scraper lama dipertahankan sebagai data historis, tetapi tidak lagi digunakan aplikasi.

`TAUFIK_PASSWORD` dan `ALYA_PASSWORD` hanya diperlukan untuk migrasi login awal. `GEMINI_API_KEY` wajib diatur untuk analisis CV; analisis tidak menggunakan pencocokan lokal sebagai pengganti AI. Scraper tidak menggunakan Gemini maupun layanan scraping eksternal.

Username tetap `taufik` dan `alya`. `TAUFIK_PASSWORD` dan `ALYA_PASSWORD` hanya dipakai untuk memindahkan password lama ke tabel login pada login pertama setiap akun. Setelah kedua akun berhasil login, variabel tersebut dapat dihapus. Password tersimpan sebagai hash scrypt dan dapat diganti dari menu **Akun**. Login memakai cookie sesi HTTP-only, membatasi satu sesi aktif per username, dan berakhir setelah 30 menit tanpa aktivitas.

Menu **Upload CV** menyimpan satu CV PDF maksimal 10 MiB di bucket Supabase Storage privat `private-cv`, di lokasi terpisah per pengguna. Upload baru menggantikan CV akun yang sedang masuk; pratinjau memakai URL bertanda tangan yang berlaku 10 menit.

Analisis CV mengambil lowongan aktif tujuh hari terakhir, menyaring maksimal 20 kandidat berdasarkan kemiripan kata pada judul dan deskripsi, lalu mengirim CV yang sudah disamarkan beserta kandidat tersebut ke Gemini. Penyaringan lokal hanya mengurangi ukuran permintaan; ekstraksi kata kunci, evaluasi persyaratan, penjelasan, dan skor seluruhnya dibuat oleh AI. Skor AI adalah perkiraan, bukan jaminan penerimaan. Atur `GEMINI_API_KEY`; model default adalah `gemini-2.5-flash` dan dapat diganti lewat `GEMINI_MODEL`. Sebelum teks CV dikirim, bagian identitas awal, kontak, nomor telepon, alamat, dan tautan disamarkan. Gemini free tier memiliki kuota yang dapat berubah dan Google menyatakan konten free tier dapat digunakan untuk meningkatkan produk. Teks CV tidak disimpan dalam tabel; hasil pencocokan disimpan per akun di Supabase sampai **Analisis ulang** berhasil.

Navigasi antarhalaman mempertahankan state sementara dalam memori tab. Hasil analisis CV tersimpan di Supabase agar tetap tersedia setelah refresh atau login kembali.

## Scraper dan HTML debug

Tambahkan tautan pencarian JobStreet atau Glints lewat menu **Kelola tautan**. GitHub Actions membaca semua tautan aktif dari Supabase, menemukan maksimal 100 tautan detail per pencarian, mengambil detail, lalu menyimpan hasilnya. Tombol **Perbarui sekarang** pada tautan menjalankan scrape di latar belakang; halaman boleh ditinggalkan, dan status diperbarui setelah proses selesai. Jika situs menolak akses atau scrape gagal, status ringkas dan detail kesalahan terlihat di tautan tersebut. Status diblokir menjelaskan bahwa data lama tetap dipertahankan. Mengganti URL menghapus lowongan yatim dari URL lama; URL baru dapat diperbarui lewat tombol manual atau run otomatis berikutnya.

Jalankan `npm run scrape:debug` dengan URL pencarian yang ingin diuji di `.env.local`:

```env
DEBUG_JOBSTREET_SEARCH_URL=https://id.jobstreet.com/id/Warehouse-jobs/in-Surabaya-Jawa-Timur?daterange=7
DEBUG_GLINTS_SEARCH_URL=
```

Mode debug menyimpan HTML halaman pencarian ke `debug/`, menemukan tautan detail secara otomatis dari halaman itu, lalu menyimpan HTML detail pertama yang ditemukan. Ia juga mencetak deteksi JSON-LD, `__NEXT_DATA__`, serta nama field tanggal. Gunakan hasilnya untuk memeriksa selector dan format data saat struktur situs berubah. Untuk detail, scraper mengutamakan JSON-LD, lalu `__NEXT_DATA__` Glints, kemudian selector CSS yang terkonfirmasi.

Setelah selector diverifikasi, pasang Chromium lokal dengan `npx playwright install chromium`, lalu scraper dapat dijalankan dengan `npm run scrape`. Tahap pertama mengambil maksimal 100 tautan detail per pencarian (JobStreet memakai halaman `?page=N`; Glints memakai pengguliran), lalu tahap kedua mengambil detail dari antrean yang adil per sumber. Proses memakai Chromium headless dan concurrency 1. JobStreet dibatasi 30 detail per run dengan jeda acak 15–30 detik; Glints memakai jeda yang dikonfigurasi untuk sumber tersebut. Jika situs menolak akses (HTTP 403), captcha, atau pembatasan HTTP 429/503 terdeteksi, scraper berhenti secara sopan dan data lama dipertahankan. Untuk JobStreet, 429/503 menghentikan semua permintaan JobStreet pada run tersebut dan menerapkan cooldown minimal enam jam. HTML detail yang gagal didiagnosis disimpan maksimal 5 file di `debug/failed/` per run. GitHub Actions menyimpan folder `debug/` sebagai artifact.

Untuk menghindari HTTP 403 JobStreet dari IP runner GitHub-hosted, lihat panduan [runner Windows di jaringan rumah](./docs/SELF_HOSTED_RUNNER.md). Workflow tetap berjalan pukul 12.00 dan 00.00 WIB.

## GitHub Actions

Workflow `.github/workflows/scrape.yml` berjalan setiap 12 jam: pukul 12.00 dan 00.00 WIB (cron UTC `05:00` dan `17:00`) serta dapat dijalankan manual lewat **workflow_dispatch** untuk memilih semua sumber, Glints, atau JobStreet. Glints berjalan di GitHub-hosted Ubuntu. JobStreet hanya berjalan jika repository variable `SCRAPER_RUNNER` menunjuk ke self-hosted runner; ia tidak dijalankan dari Ubuntu GitHub-hosted. Atur repository secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Workflow memakai Node.js 22, menginstal Chromium Playwright, dan memverifikasi data secara read-only setelah scrape. Lihat [panduan operasi scraper](./docs/OPERASI.md) untuk cara memantau dan arti status.

## Fitur lain

Daftar lowongan memiliki pagination, pencarian judul, serta filter **Hari ini** atau **Semua (7 hari)** berdasarkan zona waktu Asia/Jakarta. Lowongan tanpa tanggal posting yang diketahui tetap ditampilkan dengan label **Tanggal tidak diketahui**; data dibersihkan setelah tidak terlihat selama 14 hari. Detail menampilkan deskripsi teks bersih dan tautan ke lowongan asli. Penghapusan tautan hanya menghapus lowongan yatim yang tidak dipakai sumber lain.

Layanan dashboard membaca data Supabase di sisi server menggunakan `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY`; keduanya tidak dikirim ke browser. Scraper memakai key yang sama hanya di GitHub Actions. Perubahan ini tidak mengubah alur pencocokan CV.

Untuk memeriksa scraper: `npm run typecheck:scraper`, `npm run test:scraper`, `npm run lint`, dan `npm run build`. Jalankan `npm run verify:scrape` untuk pemeriksaan Supabase read-only.

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
