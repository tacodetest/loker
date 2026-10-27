import Link from "next/link";
import { Suspense } from "react";
import { io } from "next/cache";
import { getDashboardStats } from "@/lib/dashboard";
import { getPostedAge } from "@/lib/job-age";
import { getJobsPage } from "@/lib/jobs";

function formatDate(value: string | null) {
  if (!value) return "Tanggal tidak diketahui";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(new Date(value));
}

export default function Home() {
  return (
    <Suspense fallback={
      <main aria-busy="true" className="main-content">
        <header className="page-title-row">
          <div><p className="eyebrow">PENCARIAN KERJA</p><h1>Ringkasan</h1></div>
        </header>
        <section className="content-card empty-inline">Memuat ringkasan...</section>
      </main>
    }>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  await io();
  const [{ jobs }, stats] = await Promise.all([getJobsPage({}), getDashboardStats()]);
  const recentJobs = jobs.slice(0, 5);

  return (
    <main className="main-content">
      <header className="page-title-row">
        <div>
          <p className="eyebrow">PENCARIAN KERJA</p>
          <h1>Ringkasan</h1>
          <p>Pantau lowongan terbaru dari semua sumber pencarianmu.</p>
        </div>
      </header>

      <section aria-label="Statistik lowongan" className="stats-grid">
        <article className="stat-card">
          <span aria-hidden="true" className="stat-icon stat-blue">▤</span>
          <div><span>Lowongan 7 hari terakhir</span><strong>{stats.totalJobs}</strong><small>Postingan yang masih baru</small></div>
        </article>
        <article className="stat-card">
          <span aria-hidden="true" className="stat-icon stat-green">◷</span>
          <div><span>Postingan hari ini</span><strong>{stats.datedJobs}</strong><small>Tanggal posting di hari ini</small></div>
        </article>
        <article className="stat-card">
          <span aria-hidden="true" className="stat-icon stat-orange">↗</span>
          <div><span>Sumber pencarian</span><strong>{stats.sources}</strong><small>JobStreet</small></div>
        </article>
        <article className="stat-card">
          <span aria-hidden="true" className="stat-icon stat-purple">⌕</span>
          <div><span>Lowongan segar diambil 7 hari</span><strong>{stats.recentJobs}</strong><small>Diperbarui dan diposting 7 hari terakhir</small></div>
        </article>
      </section>

      <section aria-labelledby="latest-heading" className="content-card overview-card">
        <div className="section-heading">
          <div><h2 id="latest-heading">Lowongan terbaru</h2><p>Hasil gabungan dari seluruh tautan yang tersimpan.</p></div>
          <Link className="button button-secondary" href="/jobs">Lihat semua</Link>
        </div>
        {recentJobs.length === 0 ? (
          <div className="empty-inline">Belum ada lowongan terbaru yang cocok.</div>
        ) : (
          <ul className="job-list">
            {recentJobs.map((job) => {
              const age = getPostedAge(job.posted_time, job.scraped_at);
              return (
                <li className="job-card" key={job.job_url}>
                  <div aria-label={`Diposting ${age.label}`} className={age.className}><strong>{age.label}</strong></div>
                  <div className="job-content">
                    <h3><Link href={`/job?url=${encodeURIComponent(job.job_url)}`}>{job.title}</Link></h3>
                    <div className="job-meta">
                      <span>{job.company || "Perusahaan tidak dicantumkan"}</span>
                      {job.location && <span>{job.location}</span>}
                      <span className="site-tag">JobStreet</span>
                    </div>
                    {job.salary && <p className="job-salary">{job.salary}</p>}
                    <p className="job-found">Diperbarui {formatDate(job.scraped_at)}</p>
                  </div>
                  <Link aria-label={`Lihat ${job.title}`} className="job-open" href={`/job?url=${encodeURIComponent(job.job_url)}`}>
                    Detail <span aria-hidden="true">→</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="content-card quick-source">
        <div>
          <span aria-hidden="true" className="quick-icon">↗</span>
          <div><h2>Tambah sumber pencarian</h2><p>Tambahkan URL JobStreet satu per satu.</p></div>
        </div>
        <Link className="button button-primary" href="/sources">Kelola tautan</Link>
      </section>
    </main>
  );
}
