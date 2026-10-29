import Link from "next/link";
import { notFound } from "next/navigation";
import { getJobDetail } from "@/lib/jobs";
import { requireCurrentUser } from "@/lib/auth";

export const instant = false;

type SearchParams = Promise<{ url?: string | string[] }>;

function formatPostedAt(value: string | null) {
  if (!value) return "Tanggal tidak diketahui";
  if (/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("id-ID", {
        dateStyle: "long",
        timeZone: "Asia/Jakarta",
      }).format(date);
    }
  }
  return value;
}

export default async function JobDetail({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const user = await requireCurrentUser();
  const jobUrl = Array.isArray(params.url) ? params.url[0] : params.url;
  if (!jobUrl || jobUrl.length > 2048) notFound();

  const job = await getJobDetail(jobUrl, user.id);
  if (!job) notFound();

  return (
    <main className="main-content">
      <header className="page-title-row">
        <div>
          <p className="eyebrow">DETAIL LOWONGAN</p>
          <h1>Informasi pekerjaan</h1>
          <p>Rincian lowongan dari sumber pencarian tersimpan.</p>
        </div>
        <Link className="button button-secondary" href="/jobs">← Kembali ke daftar</Link>
      </header>
      <article className="content-card job-detail-card">
        <p className="job-detail-date">
          {formatPostedAt(job.posted_time)}
        </p>
        <h2 className="job-detail-title">{job.title}</h2>
        <p className="job-detail-meta">
          {job.company || "Perusahaan tidak dicantumkan"}
          {job.location ? ` · ${job.location}` : ""}
          {job.employment_type ? ` · ${job.employment_type}` : ""}
        </p>
        {job.salary && <p className="job-salary">{job.salary}</p>}
        <hr className="job-detail-divider" />
        <h3 className="job-detail-heading">Deskripsi pekerjaan</h3>
        <p className="job-detail-description">
          {job.description || "Deskripsi belum tersedia."}
        </p>
        <a
          className="button button-primary job-original-link"
          href={job.job_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Lihat lowongan asli
        </a>
      </article>
    </main>
  );
}
