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

Tambahkan `SGAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, dan `ADMIN_KEY` ke `.env.local`. Nilai kunci hanya digunakan oleh server—jangan menaruh ScrapeGraphAI API key di kode browser atau membagikan isi `.env.local`. Menambahkan URL ke daftar tidak memakai kredit. Tombol **Perbarui** pada sumber memanggil ScrapeGraphAI; memfilter atau melihat data yang tersimpan tidak memakai kredit.

## Alur penggunaan

1. Buka menu **Kelola tautan**, masukkan kunci admin, lalu tempel URL JobStreet/Glints—satu URL per baris—dan pilih **Simpan tautan**. Maksimal 100 URL dapat ditambahkan sekaligus. URL hanya disimpan, belum di-scrape.
2. Pilih **Perbarui** di sumber yang ingin diambil. **Perbarui semua** menjalankan scrape satu per satu dan setiap tautan memakai kredit.
3. Buka **Semua lowongan** untuk mencari gabungan hasil dari semua sumber. Rentang pencarian dapat diubah hingga 30 hari; kata kunci dipisahkan dengan koma.
4. Pilih **Hapus** pada sumber untuk mengeluarkannya dari daftar. Lowongan yang masih terhubung ke sumber lain tetap ada; lowongan tanpa sumber lain ikut dibersihkan.

Di menu **Kelola tautan**, **Total lowongan unik** hanya menghitung satu kali setiap lowongan yang muncul di beberapa sumber. Keterangan di bawah angka menunjukkan jumlah semua hubungan lowongan-tautan, sehingga angka itu bisa lebih besar karena lowongan yang sama ada di lebih dari satu tautan.
Penghapusan juga membersihkan cache replay lokal `.cache/last-extract.json`; daftar lowongan dan sumber dimuat ulang tanpa memakai respons cache.

## Replay hasil extract tanpa kredit

Saat menjalankan aplikasi dengan `npm run dev`, simpan JSON respons ScrapeGraphAI ke `.cache/last-extract.json`. Buka menu **Kelola tautan**, tempel URL pencarian JobStreet atau Glints dan kunci admin, lalu pilih **Uji dengan data simpanan (tanpa kredit)** pada bagian alat uji lokal. Fitur ini memanggil `/api/scrape/replay`; tidak ada request ke ScrapeGraphAI, tetapi hasilnya tetap di-upsert ke Supabase yang dikonfigurasi.

Route replay hanya tersedia di development dan menerima domain JobStreet/Glints. Pastikan konfigurasi Supabase menunjuk ke database yang memang ingin digunakan untuk pengujian.

Lowongan tanpa tanggal posting yang terbaca tetap ditampilkan dalam bagian **Tanggal posting tidak tersedia**. Tanggal pertama kali ditemukan ditampilkan sebagai informasi terpisah dan tidak digunakan untuk menentukan rentang tanggal posting.

## Peremajaan dan retensi lowongan

Jalankan `supabase.sql` di Supabase SQL Editor setelah memperbarui file tersebut agar fungsi scrape dan hapus sumber tersedia. Saat scrape atau replay berhasil dengan hasil valid, database hanya mengganti relasi lowongan untuk tautan yang diperbarui. Tautan lain tidak ikut berubah. Lowongan yang masih terhubung ke tautan lain tetap disimpan; lowongan yang tidak lagi terkait sumber mana pun dibersihkan. Menghapus sumber juga membersihkan lowongan yang tidak lagi terhubung ke sumber lain. Jika scrape gagal atau hasilnya kosong, data sebelumnya tidak diubah. Fungsi database melakukan perubahan ini dalam satu transaksi.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
