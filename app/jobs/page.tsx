import Link from "next/link";
import { Suspense } from "react";
import { io } from "next/cache";
import { getPostedAge } from "@/lib/job-age";
import { getJobsPage } from "@/lib/jobs";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined, maxLength = 100) {
  return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, maxLength) ?? "";
}

function safeDays(value: string) {
  const days = Number(value);
  return Number.isInteger(days) && days > 0 ? Math.min(days, 7) : 7;
}

function formatDate(value: string | null) {
  if (!value) return "Tanggal posting tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(new Date(value));
}

export default function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={
      <main aria-busy="true" className="main-content">
        <header className="page-title-row">
          <div><p className="eyebrow">PENCARIAN KERJA</p><h1>Semua lowongan</h1></div>
        </header>
        <section className="content-card empty-inline">Memuat daftar lowongan...</section>
      </main>
    }>
      <JobsPageContent searchParams={searchParams} />
    </Suspense>
  );
}

async function JobsPageContent({ searchParams }: { searchParams: SearchParams }) {
  await io();
  const params = await searchParams;
  const search = firstValue(params.q);
  const days = params.days === undefined ? 7 : safeDays(firstValue(params.days, 4));
  const cursor = firstValue(params.cursor, 4096);
  const { jobs, nextCursor } = await getJobsPage({ search, days, cursor });

  const nextParams = new URLSearchParams();
  if (search) nextParams.set("q", search);
  if (days) nextParams.set("days", String(days));
  if (nextCursor) nextParams.set("cursor", nextCursor);

  return (
    <main className="main-content">
      <header className="page-title-row">
        <div>
          <p className="eyebrow">PENCARIAN KERJA</p>
          <h1>Semua lowongan</h1>
          <p>Cari lowongan dari seluruh tautan tersimpan, maksimal 7 hari terakhir.</p>
        </div>
      </header>

      <form action="/jobs" className="content-card filters-card" method="get" role="search">
        <label className="filter-search">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Cari judul lowongan</span>
          <input defaultValue={search} name="q" placeholder="Cari berdasarkan judul pekerjaan..." />
        </label>
        <label className="range-select">
          Rentang
          <select defaultValue={String(days || 0)} name="days">
            <option value="1">1 hari</option>
            <option value="3">3 hari</option>
            <option value="7">7 hari</option>
          </select>
        </label>
        <button className="button button-primary filters-submit" type="submit">Cari</button>
        <span className="results-count">{jobs.length} lowongan di halaman ini</span>
      </form>

      {jobs.length === 0 ? (
        <section className="empty-state">
          <span aria-hidden="true" className="empty-icon">⌕</span>
          <h2>Belum ada lowongan</h2>
          <p>Tambahkan tautan pencarian lalu perbarui untuk mengambil lowongan.</p>
          <Link className="button button-primary" href="/sources">Kelola tautan</Link>
        </section>
      ) : (
        <ul className="job-list">
          {jobs.map((job) => {
            const age = getPostedAge(job.posted_at, job.posted_text);
            return (
              <li className="job-card" key={job.job_url}>
                <div aria-label={`Diposting ${age.label}`} className={age.className}><strong>{age.label}</strong></div>
                <div className="job-content">
                  <h2><Link href={`/job?url=${encodeURIComponent(job.job_url)}`}>{job.title}</Link></h2>
                  <div className="job-meta">
                    <span>{job.company || "Perusahaan tidak dicantumkan"}</span>
                    {job.location && <span>{job.location}</span>}
                    <span className="site-tag">JobStreet</span>
                  </div>
                  {job.salary && <p className="job-salary">{job.salary}</p>}
                  <p className="job-found">Terakhir diperbarui {formatDate(job.scraped_at)}</p>
                </div>
                <Link aria-label={`Lihat ${job.title}`} className="job-open" href={`/job?url=${encodeURIComponent(job.job_url)}`}>
                  Detail <span aria-hidden="true">→</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {nextCursor && (
        <nav aria-label="Navigasi halaman lowongan" className="pagination">
          <Link className="button button-secondary" href={`/jobs?${nextParams.toString()}`}>Lowongan berikutnya →</Link>
        </nav>
      )}
    </main>
  );
}
