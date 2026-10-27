import Link from "next/link";
import { Suspense } from "react";
import { io } from "next/cache";
import { getPostedAge } from "@/lib/job-age";
import { getJobsPage, JOBS_PAGE_SIZE, type JobsPeriod } from "@/lib/jobs";
import { JobsSkeleton } from "@/components/PageSkeletons";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined, maxLength = 100) {
  return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, maxLength) ?? "";
}

function safePeriod(value: string | undefined, legacyDays: string): JobsPeriod {
  if (value === "today" || (!value && legacyDays === "1")) return "today";
  return "all";
}

function safePage(value: string) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function visiblePages(currentPage: number, totalPages: number) {
  const pages = Array.from(new Set([1, currentPage - 1, currentPage, currentPage + 1, totalPages]))
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
  const items: Array<number | "ellipsis"> = [];

  for (const [index, page] of pages.entries()) {
    if (index > 0 && page - pages[index - 1] > 1) items.push("ellipsis");
    items.push(page);
  }
  return items;
}

function formatDate(value: string | null) {
  if (!value) return "Tanggal posting tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(new Date(value));
}

export default function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<JobsSkeleton />}>
      <JobsPageContent searchParams={searchParams} />
    </Suspense>
  );
}

async function JobsPageContent({ searchParams }: { searchParams: SearchParams }) {
  await io();
  const params = await searchParams;
  const search = firstValue(params.q);
  const period = safePeriod(firstValue(params.period), firstValue(params.days, 4));
  const page = safePage(firstValue(params.page, 10));
  const { jobs, currentPage, totalJobs, totalPages } = await getJobsPage({ search, period, page });
  const firstResult = totalJobs === 0 ? 0 : (currentPage - 1) * JOBS_PAGE_SIZE + 1;
  const lastResult = Math.min(currentPage * JOBS_PAGE_SIZE, totalJobs);

  function pageHref(targetPage: number) {
    const pageParams = new URLSearchParams();
    if (search) pageParams.set("q", search);
    pageParams.set("period", period);
    pageParams.set("page", String(targetPage));
    return `/jobs?${pageParams.toString()}`;
  }

  return (
    <main className="main-content">
      <header className="page-title-row">
        <div>
          <p className="eyebrow">PENCARIAN KERJA</p>
          <h1>Semua lowongan</h1>
          <p>Lowongan JobStreet yang tersimpan hingga 7 hari terakhir.</p>
        </div>
      </header>

      <form action="/jobs" className="content-card filters-card" method="get" role="search">
        <label className="filter-search">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Cari judul lowongan</span>
          <input defaultValue={search} name="q" placeholder="Cari berdasarkan judul pekerjaan..." />
        </label>
        <label className="range-select">
          Tampilkan
          <select defaultValue={period} name="period">
            <option value="today">Hari ini</option>
            <option value="all">Semua (7 hari)</option>
          </select>
        </label>
        <button className="button button-primary filters-submit" type="submit">Cari</button>
        <span className="results-count">
          Menampilkan {firstResult}–{lastResult} dari {totalJobs} lowongan
        </span>
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
            const age = getPostedAge(job.posted_time, job.scraped_at);
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

      {totalPages > 1 && (
        <nav aria-label="Navigasi halaman lowongan" className="pagination">
          {currentPage > 1 ? (
            <Link aria-label="Halaman sebelumnya" className="button button-secondary pagination-direction" href={pageHref(currentPage - 1)}>
              ← Sebelumnya
            </Link>
          ) : <span aria-hidden="true" className="button button-secondary pagination-direction pagination-disabled">← Sebelumnya</span>}
          <div className="pagination-pages">
            {visiblePages(currentPage, totalPages).map((pageNumber, index) => pageNumber === "ellipsis" ? (
              <span aria-hidden="true" className="pagination-ellipsis" key={`ellipsis-${index}`}>…</span>
            ) : (
              <Link
                aria-current={pageNumber === currentPage ? "page" : undefined}
                aria-label={`Halaman ${pageNumber}`}
                className={`pagination-page${pageNumber === currentPage ? " pagination-page-active" : ""}`}
                href={pageHref(pageNumber)}
                key={pageNumber}
              >
                {pageNumber}
              </Link>
            ))}
          </div>
          {currentPage < totalPages ? (
            <Link aria-label="Halaman berikutnya" className="button button-secondary pagination-direction" href={pageHref(currentPage + 1)}>
              Berikutnya →
            </Link>
          ) : <span aria-hidden="true" className="button button-secondary pagination-direction pagination-disabled">Berikutnya →</span>}
        </nav>
      )}
    </main>
  );
}
