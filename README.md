## Menjalankan aplikasi

Jalankan server pengembangan:

```bash
npm run dev
```

Buka `http://localhost:3000` setelah server siap.

## Konfigurasi layanan

Tambahkan variabel berikut ke `.env.local`:

```env
FIRECRAWL_API_KEY=...
FIRECRAWL_WEBHOOK_SECRET=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
GEMINI_API_KEY=...
TAUFIK_PASSWORD=...
ALYA_PASSWORD=...
APP_BASE_URL=https://your-production-domain.vercel.app
CRON_SECRET=...
```

Username tetap `taufik` dan `alya`. Jalankan `supabase.sql` untuk menyiapkan tabel login, sesi, dan migrasi kepemilikan data; semua data yang sudah ada ditetapkan ke akun Taufik, sedangkan akun Alya mulai dengan ruang data terpisah. `TAUFIK_PASSWORD` dan `ALYA_PASSWORD` hanya dipakai untuk memindahkan password lama ke tabel login pada login pertama setiap akun. Setelah kedua akun berhasil login, variabel tersebut dapat dihapus dari environment lokal dan Vercel. Password tersimpan sebagai hash scrypt dan dapat diganti dari menu **Akun** tanpa mengubah environment Vercel. Login membuat cookie sesi HTTP-only, membatasi satu sesi aktif per username, dan otomatis berakhir setelah 30 menit tanpa aktivitas.

`FIRECRAWL_API_KEY` hanya digunakan di server; jangan pernah menaruhnya di kode browser atau membagikan isi `.env.local`. `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` juga hanya digunakan server-side.

Menu **Upload CV** menyimpan satu CV PDF maksimal 10 MiB di bucket Supabase Storage privat `private-cv`, di lokasi terpisah untuk masing-masing pengguna; upload baru menggantikan CV milik akun yang sedang masuk. CV diperiksa formatnya dan pratinjau memakai URL bertanda tangan yang berlaku 10 menit.

Analisis CV mengambil lowongan JobStreet aktif tujuh hari terakhir dan memeringkatnya secara lokal menggunakan kata kunci dari teks PDF. Gemini API memberi penjelasan untuk maksimal sepuluh lowongan teratas; skor persentase adalah perkiraan lokal, bukan penilaian atau jaminan penerimaan. Atur `GEMINI_API_KEY` untuk mengaktifkan analisis (model default `gemini-3.5-flash-lite`; jika diperlukan, model dapat diganti dengan `GEMINI_MODEL`). Sebelum teks CV dikirim ke Gemini, bagian identitas di awal CV, kontak, nomor telepon, alamat, dan tautan disamarkan. Gemini API free tier memiliki kuota yang dapat berubah dan Google menyatakan konten free tier dapat digunakan untuk meningkatkan produk. Teks CV tidak disimpan dalam tabel; hasil pencocokan tersimpan per akun di Supabase sampai pengguna menekan **Analisis ulang**, dan ditampilkan kembali saat membuka menu CV.

Navigasi antarhalaman mempertahankan state sementara dalam memori tab. Hasil analisis CV juga tersimpan di Supabase per akun agar tetap tersedia setelah refresh atau login kembali; tombol **Analisis ulang** menjalankan pencocokan baru dan mengganti hasil yang tersimpan setelah berhasil.

## Pengambilan dan pengelolaan lowongan

Setelah login, pengguna dapat membuka halaman **Kelola tautan**, menyimpan satu URL JobStreet atau menekan **Perbarui semua tautan** untuk mengambil ulang semua sumber milik akunnya dalam satu batch. `POST /api/scrape` menerima 1–1.000 URL dan memulai batch asynchronous Firecrawl; UI menampilkan status dan jumlah lowongan per tautan di bagian bawah halaman. Tautan tersimpan di-refresh dengan mengambil ulang URL yang sama, tanpa mengubahnya; tombol **Ganti URL** disediakan terpisah jika alamat sumber memang berubah. Firecrawl memakai structured JSON, schema yang dihasilkan dari Zod, `onlyMainContent`, dan cache 10 menit.

Penggantian URL akan mengambil dan menyimpan hasil URL baru terlebih dahulu. Data lama baru dihapus setelah hasil baru valid dan berhasil disimpan. Penghapusan sumber hanya membuang lowongan yatim yang tidak lagi terhubung ke sumber lain. Deskripsi disimpan sebagai teks biasa maksimal 2.000 karakter.

Daftar lowongan dirender sebagai Server Component dengan pagination bernomor, urutan waktu posting terbaru (waktu yang terbaca lebih dulu, lalu data tanpa waktu posting berdasarkan waktu scrape), pencarian judul pekerjaan, dan filter **Hari ini** atau **Semua (7 hari)**. Filter Hari ini mengikuti tanggal kalender Asia/Jakarta dan hanya menyertakan waktu posting yang terbaca; Semua mencakup lowongan yang diposting dalam tujuh hari terakhir serta data yang baru di-scrape dalam rentang tersebut tetapi waktu postingnya tidak tersedia. Nomor halaman dan jumlah hasil menyesuaikan filter. Query Supabase dan halaman detail juga menerapkan batas 7 hari. Perusahaan dan lokasi ditentukan melalui filter di URL sumber JobStreet. Hanya lowongan JobStreet yang ditampilkan. Halaman daftar hanya mengambil kolom ringan, dan deskripsi diambil saat detail lowongan dibuka. Data daftar, detail, dan ringkasan dibaca langsung dari Supabase agar perubahan SQL langsung terlihat tanpa menunggu cache.

Endpoint scrape hanya menerima URL HTTP/HTTPS pada domain JobStreet (maksimal 1.000 URL per batch), memerlukan sesi login, dan dibatasi lima permintaan per menit per akun. Data sumber, lowongan, batch scrape, dan file CV dipisahkan berdasarkan akun; sesi pengguna lain tidak dapat mengaksesnya. Firecrawl mengekstrak `job_title`, `company_name`, `location`, `job_description`, dan `posted_time`, serta `job_url` agar detail lowongan dapat dibuka. `posted_time` disimpan sebagai teks persis seperti yang tampil pada kartu; filter dan umur posting dihitung dari teks itu dengan waktu scrape sebagai acuan. `FIRECRAWL_API_KEY` dan Supabase service-role key hanya digunakan server-side.

## Scrape otomatis dua kali sehari

Setelah menjalankan `supabase.sql`, tambahkan `APP_BASE_URL` (URL production HTTPS), `CRON_SECRET` (secret acak panjang), dan `FIRECRAWL_WEBHOOK_SECRET` (signing secret dari pengaturan Advanced Firecrawl) ke environment production Vercel. Buat job di cron-job.org dengan metode `POST` ke `https://<domain-production>/api/cron/scrape`, header `Authorization: Bearer <CRON_SECRET>`, dan jadwal `0 0,12 * * *` dengan zona waktu `Asia/Jakarta` (00.00 dan 12.00 WIB). Jangan menaruh secret di URL.

Endpoint terjadwal memproses tautan tersimpan untuk akun Taufik dan Alya, mencegah duplikasi per slot jadwal, dan melewati akun yang masih memiliki batch aktif. Firecrawl mengirim callback hasil setelah batch selesai; callback memverifikasi HMAC `X-Firecrawl-Signature` sebelum menyimpan lowongan. Karena paket Vercel Hobby hanya mengizinkan Cron Vercel sekali sehari, pemicu dua kali sehari berasal dari cron-job.org; pemanggilan endpoint dan scrape tetap menggunakan kuota fungsi Vercel dan kredit Firecrawl. Pastikan project Firecrawl memiliki signing secret yang sama dengan `FIRECRAWL_WEBHOOK_SECRET`.

## Replay hasil Firecrawl tanpa kredit

Saat berjalan dengan `npm run dev`, scrape sukses dengan satu URL disimpan lokal per akun di `.cache/last-extract-<username>.json`. Route development `POST /api/scrape/replay` dapat memproses file akun yang sedang masuk tanpa request atau kredit Firecrawl baru.

Hanya domain JobStreet yang diterima. Pastikan konfigurasi Supabase menunjuk ke database yang memang ingin digunakan untuk pengujian. Lowongan tanpa tanggal posting yang terbaca tetap memiliki tanggal posting kosong; tanggal pertama kali ditemukan tidak digunakan sebagai pengganti tanggal posting.

## Peremajaan dan retensi lowongan

Jalankan `supabase.sql` di Supabase SQL Editor untuk migrasi `scraped_at`, index, RLS baca-publik/tulis-server, tabel progres/rate-limit, RPC upsert dan pembersihan, serta jadwal `pg_cron`. Jalankan ulang SQL tersebut setelah pembaruan untuk migrasi otomatis dari `posted_text`/`posted_at` ke satu kolom `posted_time`; nilai `posted_text` lama dipertahankan bila tersedia. Lowongan tanpa waktu posting yang dapat dibaca tidak ditampilkan. Jadwal harian menghapus data yang tidak diperbarui dalam tujuh hari. Skema saat ini tidak memiliki `expires_at`.

Jika scrape gagal atau hasilnya kosong, data lama tetap dipertahankan. Lowongan yang terhubung ke sumber lain tidak ikut dihapus ketika salah satu sumber dihapus. Batch progres disimpan selama tujuh hari. Untuk menjalankan cron, ekstensi `pg_cron` harus tersedia/diizinkan pada proyek Supabase.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
