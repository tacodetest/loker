# Menjalankan scraper dari jaringan rumah

JobStreet dapat menolak alamat IP GitHub-hosted runner dengan HTTP 403. Untuk menjalankan scraper dari komputer Windows di jaringan rumah, gunakan self-hosted runner GitHub Actions. Scraper tidak mencoba melewati pemblokiran atau captcha; bila akses ditolak, proses berhenti dan data lama dipertahankan.

## Mendaftarkan runner Windows

1. Pastikan Node.js 22 dan Git tersedia untuk akun Windows yang akan menjalankan service.
2. Buka repository GitHub, pilih **Settings → Actions → Runners → New self-hosted runner**, lalu pilih Windows dan arsitektur yang sesuai.
3. Ikuti petunjuk GitHub untuk mengunduh runner. Dari PowerShell **Run as administrator**, ekstrak ke folder permanen, misalnya `C:\actions-runner`.
4. Jalankan perintah `config.cmd` yang diberikan GitHub dan tambahkan label khusus `scraper-home`. Jangan membagikan registration token dan jangan menyimpannya di repository.
5. Pasang dan mulai service dari folder runner:

   ```powershell
   .\svc.cmd install
   .\svc.cmd start
   ```

6. Di **Settings → Secrets and variables → Actions → Variables**, buat variable repository `SCRAPER_RUNNER` dengan nilai `scraper-home`. Label tersebut harus cocok dengan label pada runner. Jika variable tidak diisi, job JobStreet dilewati; JobStreet tidak pernah dialihkan ke runner Ubuntu GitHub-hosted.
7. Tambahkan repository secrets `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY`. Jangan menyimpan service-role key sebagai variable biasa atau di file yang dikomit.

Workflow memasang Chromium dengan `npx playwright install chromium` pada Windows dan `npx playwright install --with-deps chromium` pada Linux. Runner Windows harus tetap aktif dan terhubung ke GitHub Actions pada waktu jadwal berjalan.

## Alternatif: Windows Task Scheduler

Scraper juga dapat dijalankan langsung dari komputer rumah tanpa GitHub Actions:

1. Pastikan `.env.local` di root proyek memiliki `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY`, dan jangan mengomit file tersebut.
2. Dari root proyek, jalankan `npm ci` dan `npx playwright install chromium` satu kali.
3. Buat dua Basic Task di **Task Scheduler** dengan jadwal harian pukul **12:00** dan **00:00**. Atur **Start in** ke folder proyek.
4. Isi **Program/script** dengan path `npm.cmd` yang terpasang di komputer, dan **Add arguments** dengan `run scrape`.
5. Jalankan task secara manual sekali dan periksa **History** Task Scheduler untuk memastikan proses berhasil.

Perintah `npm run scrape` membaca `.env.local` melalui script package yang sudah tersedia.
