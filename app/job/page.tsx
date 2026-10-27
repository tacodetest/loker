import Link from "next/link";
import { notFound } from "next/navigation";
import { getJobDetail } from "@/lib/jobs";

type SearchParams = Promise<{ url?: string | string[] }>;

export default async function JobDetail({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const jobUrl = Array.isArray(params.url) ? params.url[0] : params.url;
  if (!jobUrl || jobUrl.length > 2048) notFound();

  const job = await getJobDetail(jobUrl);
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
          {job.posted_time || "Waktu posting tidak tersedia"}
        </p>
        <h2 className="job-detail-title">{job.title}</h2>
        <p className="job-detail-meta">
          {job.company || "Perusahaan tidak dicantumkan"}
          {job.location ? ` · ${job.location}` : ""}
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
