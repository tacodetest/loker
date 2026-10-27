This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Konfigurasi layanan

Tambahkan variabel berikut ke `.env.local`:

```env
FIRECRAWL_API_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_KEY=...
```

`FIRECRAWL_API_KEY` hanya digunakan di server; jangan pernah menaruhnya di kode browser atau membagikan isi `.env.local`. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, dan `ADMIN_KEY` dipakai oleh endpoint penyimpanan dan pengelolaan sumber.

## Pengambilan dan pengelolaan lowongan

Admin membuka halaman **Kelola tautan**, memasukkan `ADMIN_KEY`, lalu mengirim hingga 50 URL JobStreet. `POST /api/scrape` memulai satu batch asynchronous Firecrawl; UI melakukan polling status pending/scraping/done/failed dan menyimpan tiap sumber yang berhasil secara terpisah. Firecrawl memakai structured JSON, schema yang dihasilkan dari Zod, `onlyMainContent`, cache 10 menit, dan concurrency maksimum 5. Kegagalan satu URL tidak membatalkan sumber lain.

Penggantian URL akan mengambil dan menyimpan hasil URL baru terlebih dahulu. Data lama baru dihapus setelah hasil baru valid dan berhasil disimpan. Penghapusan sumber hanya membuang lowongan yatim yang tidak lagi terhubung ke sumber lain. Deskripsi disimpan sebagai teks biasa maksimal 2.000 karakter.

Daftar publik dirender sebagai Server Component dengan cursor pagination, urutan tanggal posting terbaru, pencarian judul pekerjaan, dan filter 1, 3, atau maksimal 7 hari; query Supabase dan halaman detail juga menerapkan batas 7 hari. Perusahaan dan lokasi ditentukan melalui filter di URL sumber JobStreet. Hanya lowongan JobStreet yang ditampilkan. Lowongan tanpa tanggal posting yang bisa dipastikan tidak ditampilkan. Halaman daftar hanya mengambil kolom ringan, dan deskripsi diambil saat detail lowongan dibuka. Data daftar, detail, dan ringkasan dibaca langsung dari Supabase agar perubahan SQL langsung terlihat tanpa menunggu cache.

Endpoint scrape hanya menerima URL HTTP/HTTPS pada domain JobStreet, memerlukan header `x-admin-key`, dan dibatasi lima batch per menit per admin. `FIRECRAWL_API_KEY` dan Supabase service-role key hanya digunakan server-side.

## Replay hasil Firecrawl tanpa kredit

Saat berjalan dengan `npm run dev`, scrape sukses dengan satu URL disimpan lokal di `.cache/last-extract.json`. Route development `POST /api/scrape/replay` dapat memproses file tersebut tanpa request atau kredit Firecrawl baru. Route ini tetap memerlukan `x-admin-key` dan menyimpan hasil ke Supabase yang dikonfigurasi.

Hanya domain JobStreet yang diterima. Pastikan konfigurasi Supabase menunjuk ke database yang memang ingin digunakan untuk pengujian. Lowongan tanpa tanggal posting yang terbaca tetap memiliki tanggal posting kosong; tanggal pertama kali ditemukan tidak digunakan sebagai pengganti tanggal posting.

## Peremajaan dan retensi lowongan

Jalankan `supabase.sql` di Supabase SQL Editor untuk migrasi `scraped_at`, index, RLS baca-publik/tulis-server, tabel progres/rate-limit, RPC upsert dan pembersihan, serta jadwal `pg_cron`. Jalankan ulang SQL tersebut setelah pembaruan agar RPC `get_jobs_page` hanya menampilkan JobStreet, menerapkan rentang paling lama 7 hari, serta mendukung pencarian judul. Migrasi juga memperbaiki tanggal lama dari label relatif, termasuk format JobStreet seperti “Listed more than six days ago”. Jadwal harian menghapus lowongan dengan `posted_at` lebih dari 7 hari; data tanpa tanggal posting dibersihkan jika tidak di-scrape ulang selama 7 hari. Skema saat ini tidak memiliki `expires_at`.

Jika scrape gagal atau hasilnya kosong, data lama tetap dipertahankan. Lowongan yang terhubung ke sumber lain tidak ikut dihapus ketika salah satu sumber dihapus. Batch progres disimpan selama tujuh hari. Untuk menjalankan cron, ekstensi `pg_cron` harus tersedia/diizinkan pada proyek Supabase.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
