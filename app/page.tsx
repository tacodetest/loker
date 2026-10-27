"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Job = {
  job_url: string;
  title: string;
  company: string | null;
  location: string | null;
  salary: string | null;
  description: string | null;
  posted_at: string | null;
  first_seen_at: string;
  site: string | null;
};
type Source = { url: string; last_scraped_at: string | null; job_count: number };
type Notice = { ok: boolean; text: string };
type View = "overview" | "jobs" | "sources";

const DAY = 86400000;
const NAV_ITEMS: { id: View; label: string; icon: string }[] = [
  { id: "overview", label: "Ringkasan", icon: "⌂" },
  { id: "jobs", label: "Semua lowongan", icon: "▤" },
  { id: "sources", label: "Kelola tautan", icon: "↗" },
];

function matches(job: Job, query: string) {
  const groups = query.split(",").map((group) => group.trim().toLowerCase()).filter(Boolean);
  if (!groups.length) return true;
  const haystack = job.title.toLowerCase();
  return groups.some((group) => group.split(/\s+/).every((word) => haystack.includes(word)));
}

function isDated(job: Job) {
  return job.posted_at !== null && Number.isFinite(Date.parse(job.posted_at));
}

function shortUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname}`;
  } catch {
    return value;
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [totalLinkedJobs, setTotalLinkedJobs] = useState(0);
  const [totalSourceJobs, setTotalSourceJobs] = useState(0);
  const [query, setQuery] = useState("");
  const [days, setDays] = useState(30);
  const [linksInput, setLinksInput] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(localStorage.getItem("loker:q") ?? "");
      setAdminKey(localStorage.getItem("loker:key") ?? "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const load = useCallback(async () => {
    const [jobsResponse, sourcesResponse] = await Promise.all([
      fetch(`/api/jobs?days=${days}`, { cache: "no-store" }),
      fetch("/api/sources", { cache: "no-store" }),
    ]);
    const [jobsData, sourcesData] = await Promise.all([
      jobsResponse.json(),
      sourcesResponse.json(),
    ]);
    if (!jobsResponse.ok) throw new Error(jobsData.error ?? "Gagal memuat lowongan.");
    if (!sourcesResponse.ok) throw new Error(sourcesData.error ?? "Gagal memuat tautan.");
    setJobs(jobsData.jobs ?? []);
    setSources(sourcesData.sources ?? []);
    setTotalLinkedJobs(sourcesData.total_job_count ?? 0);
    setTotalSourceJobs(sourcesData.total_source_job_count ?? 0);
    setLoadedAt(Date.now());
  }, [days]);

  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((error: unknown) => {
        setNotice({
          ok: false,
          text: error instanceof Error ? error.message : "Gagal memuat data. Periksa koneksi dan pengaturan Supabase.",
        });
      })
      .finally(() => setLoading(false));
  }, [load]);

  async function scrape(target: string, replay = false): Promise<{ ok: boolean; error?: string }> {
    setBusy(target);
    setNotice({
      ok: true,
      text: replay ? "Memproses data simpanan tanpa memakai kredit…" : `Sedang mengambil data dari ${shortUrl(target)}. Proses dapat memerlukan waktu hingga 5 menit.`,
    });
    try {
      const response = await fetch(replay ? "/api/scrape/replay" : "/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ url: target }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? `Permintaan gagal (HTTP ${response.status}).`);
      if (!data || typeof data.count !== "number") throw new Error("Respons server tidak berisi jumlah lowongan yang valid.");

      const successText = `${data.count} lowongan berhasil ${replay ? "diproses dari data simpanan" : "diambil"} dari ${shortUrl(target)}.`;
      setNotice({ ok: true, text: successText });
      try {
        await load();
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Gagal memuat ulang daftar.";
        setNotice({ ok: false, text: `${successText} Namun daftar belum bisa dimuat ulang: ${detail}` });
      }
      return { ok: true };
    } catch (error) {
      const text = error instanceof TypeError
        ? "Koneksi ke server terputus. Data lama tetap tersimpan; periksa terminal server untuk detail."
        : error instanceof Error ? error.message : "Gagal mengambil lowongan.";
      setNotice({ ok: false, text: `Gagal memperbarui ${shortUrl(target)}: ${text}` });
      return { ok: false, error: text };
    } finally {
      setBusy(null);
    }
  }

  async function addLinks(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const urls = [...new Set(linksInput.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))];
    if (!urls.length) return;
    setBusy("__add__");
    setNotice({ ok: true, text: `Memeriksa dan menyimpan ${urls.length} URL…` });
    try {
      const response = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ urls }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? `Gagal menyimpan URL (HTTP ${response.status}).`);
      await load();
      setLinksInput("");
      const detail = data.invalid?.length ? ` ${data.invalid.length} URL ditolak karena bukan JobStreet/Glints.` : "";
      setNotice({
        ok: true,
        text: `${data.added} tautan baru ditambahkan${data.existing ? `, ${data.existing} sudah ada` : ""}.${detail} Tautan belum di-scrape; pilih Perbarui untuk mengambil datanya.`,
      });
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : "Gagal menyimpan daftar tautan." });
    } finally {
      setBusy(null);
    }
  }

  async function refreshAll() {
    if (!sources.length) return;
    if (!window.confirm(`Perbarui ${sources.length} tautan? Setiap tautan akan memakai kredit ScrapeGraphAI.`)) return;
    setRefreshingAll(true);
    let succeeded = 0;
    const failures: string[] = [];
    try {
      for (const source of sources) {
        const result = await scrape(source.url);
        if (result.ok) succeeded += 1;
        else failures.push(`${shortUrl(source.url)}: ${result.error ?? "Gagal tanpa keterangan."}`);
      }
    } finally {
      setRefreshingAll(false);
    }
    if (succeeded === sources.length) {
      setNotice({ ok: true, text: `Semua ${succeeded} tautan berhasil diperbarui.` });
    } else {
      const details = failures.slice(0, 3).join(" | ");
      const remaining = failures.length > 3 ? ` | dan ${failures.length - 3} kegagalan lainnya` : "";
      setNotice({ ok: false, text: `${succeeded} dari ${sources.length} tautan berhasil. ${details}${remaining}` });
    }
  }

  async function removeSource(target: string) {
    if (!window.confirm(`Hapus tautan ${shortUrl(target)} dari daftar?`)) return;
    setBusy(target);
    setNotice(null);
    try {
      const response = await fetch(`/api/sources?url=${encodeURIComponent(target)}`, {
        method: "DELETE",
        headers: { "x-admin-key": adminKey },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? `Gagal menghapus tautan (HTTP ${response.status}).`);
      await load();
      setNotice({ ok: true, text: `Tautan ${shortUrl(target)} berhasil dihapus.` });
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : "Gagal menghapus tautan." });
    } finally {
      setBusy(null);
    }
  }

  const matchingJobs = useMemo(() => jobs.filter((job) => matches(job, query)), [jobs, query]);
  const datedJobs = matchingJobs.filter(isDated);
  const unknownDateJobs = matchingJobs.filter((job) => !isDated(job));
  const recentJobs = datedJobs
    .slice()
    .sort((a, b) => Date.parse(b.posted_at!) - Date.parse(a.posted_at!))
    .slice(0, 5);
  const nav = (
    <nav className="side-nav" aria-label="Menu utama">
      <p className="nav-caption">RUANG KERJA</p>
      {NAV_ITEMS.map((item) => (
        <button
          className={`nav-item${view === item.id ? " nav-item-active" : ""}`}
          key={item.id}
          type="button"
          onClick={() => { setView(item.id); setMobileMenuOpen(false); }}
        >
          <span className="nav-icon" aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
          {item.id === "sources" && <span className="nav-count">{sources.length}</span>}
        </button>
      ))}
      <div className="sidebar-tip">
        <span aria-hidden="true">✦</span>
        <strong>Tips pencarian</strong>
        <p>Pencarian hanya mencocokkan judul pekerjaan. Pisahkan alternatif dengan koma, misalnya “admin, kasir”.</p>
      </div>
      <div className="sidebar-profile">
        <span className="profile-avatar">K</span>
        <span><strong>Ruang pribadimu</strong><small>Lowongan tersimpan</small></span>
      </div>
    </nav>
  );

  function renderJob(job: Job, unknownDate = false) {
    const postedAt = job.posted_at ? Date.parse(job.posted_at) : null;
    const ageDays = unknownDate || !loadedAt || postedAt === null
      ? null
      : Math.max(0, Math.floor((loadedAt - postedAt) / DAY));
    return (
      <article className="job-card" key={job.job_url}>
        <div className={`job-age${unknownDate ? " job-age-unknown" : ageDays !== null && ageDays <= 1 ? " job-age-fresh" : ""}`}>
          <strong>{unknownDate ? "?" : ageDays === 0 ? "Baru" : ageDays}</strong>
          <span>{unknownDate ? "Tanggal tidak diketahui" : ageDays === 0 ? "hari ini" : "hari lalu"}</span>
        </div>
        <div className="job-content">
          <h3><a href={job.job_url} target="_blank" rel="noopener noreferrer">{job.title}</a></h3>
          <div className="job-meta">
            {job.company && <span>{job.company}</span>}
            {job.location && <span>{job.location}</span>}
            {job.site && <span className="site-tag">{job.site}</span>}
          </div>
          {job.salary && <p className="job-salary">{job.salary}</p>}
          {job.description && job.description !== "-" && <p className="job-description">{job.description}</p>}
          {unknownDate && <p className="job-found">Terpantau {formatDate(job.first_seen_at)} · tanggal posting tidak tersedia</p>}
        </div>
        <a className="job-open" href={job.job_url} target="_blank" rel="noopener noreferrer">Lihat lowongan <span aria-hidden="true">↗</span></a>
      </article>
    );
  }

  function renderJobResults(limit?: number) {
    const known = limit ? datedJobs.slice(0, limit) : datedJobs;
    const unknown = limit ? unknownDateJobs.slice(0, Math.max(0, limit - known.length)) : unknownDateJobs;
    if (!matchingJobs.length) {
      return (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">⌕</span>
          <h3>{jobs.length ? "Belum ada yang cocok" : "Belum ada lowongan"}</h3>
          <p>{jobs.length ? "Coba kata kunci lain atau ubah rentang posting." : "Tambahkan tautan pencarian lalu perbarui untuk mengambil lowongan."}</p>
          {query && <button className="button button-secondary" type="button" onClick={() => {
            setQuery("");
            localStorage.setItem("loker:q", "");
          }}>Hapus kata kunci</button>}
        </div>
      );
    }
    return (
      <div className="job-groups">
        {known.length > 0 && (
          <section className="job-group">
            <div className="job-group-heading"><h3>Tanggal posting diketahui</h3><span>{known.length}</span></div>
            <div className="job-list">{known.map((job) => renderJob(job))}</div>
          </section>
        )}
        {unknown.length > 0 && (
          <section className="job-group">
            <div className="job-group-heading">
              <div><h3>Tanggal posting tidak tersedia</h3><p>Waktu terpantau bukan tanggal posting.</p></div>
              <span>{unknown.length}</span>
            </div>
            <div className="job-list">{unknown.map((job) => renderJob(job, true))}</div>
          </section>
        )}
      </div>
    );
  }

  const pageTitle = view === "overview" ? "Ringkasan" : view === "jobs" ? "Semua lowongan" : "Kelola tautan";
  const pageDescription = view === "overview"
    ? "Pantau lowongan terbaru dari semua sumber pencarianmu."
    : view === "jobs"
      ? "Cari dan saring semua lowongan dari seluruh tautan tersimpan."
      : "Tambahkan daftar URL, lalu perbarui atau hapus tautan kapan saja.";

  return (
    <div className="admin-layout">
      {mobileMenuOpen && <button className="mobile-backdrop" aria-label="Tutup menu" onClick={() => setMobileMenuOpen(false)} />}
      <aside className={`app-sidebar${mobileMenuOpen ? " app-sidebar-open" : ""}`}>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setView("overview"); setMobileMenuOpen(false); }}>
          <span className="brand-mark">L</span>
          <span><strong>Loker</strong><small>PERSONAL JOB HUB</small></span>
        </a>
        {nav}
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button className="menu-toggle" type="button" aria-label="Buka menu" onClick={() => setMobileMenuOpen(true)}>☰</button>
          <div className="breadcrumb"><span>Workspace</span><b>/</b><strong>{pageTitle}</strong></div>
          <label className="global-search">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="Cari lowongan dari semua sumber"
              placeholder="Cari berdasarkan judul pekerjaan…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                localStorage.setItem("loker:q", event.target.value);
              }}
              onFocus={() => setView("jobs")}
            />
            {query && <button type="button" aria-label="Hapus pencarian" onClick={() => { setQuery(""); localStorage.setItem("loker:q", ""); }}>×</button>}
          </label>
          <div className="topbar-status"><span /> Data tersimpan</div>
        </header>

        <main className="main-content">
          <div className="page-title-row">
            <div><p className="eyebrow">PENCARIAN KERJA</p><h1>{pageTitle}</h1><p>{pageDescription}</p></div>
            {view === "sources" && sources.length > 1 && (
              <button className="button button-primary" type="button" disabled={!!busy || refreshingAll} onClick={() => void refreshAll()}>
                {refreshingAll ? "Memperbarui…" : "Perbarui semua"}
              </button>
            )}
          </div>

          {notice && (
            <div className={`notice ${notice.ok ? "notice-success" : "notice-error"}`} role="status">
              <span className="notice-icon" aria-hidden="true">{notice.ok ? "✓" : "!"}</span>
              <p>{notice.text}</p>
              <button className="notice-close" type="button" aria-label="Tutup pesan" onClick={() => setNotice(null)}>×</button>
            </div>
          )}

          {busy && (
            <div className="progress-banner" role="status">
              <span className="spinner" aria-hidden="true" />
              <div><strong>{busy === "__add__" ? "Menyimpan daftar tautan…" : refreshingAll ? "Memperbarui tautan…" : "Mengambil lowongan…"}</strong>
                <span>{busy === "__add__" ? "Penyimpanan tautan tidak memakai kredit." : "Proses scrape dapat memerlukan waktu hingga 5 menit. Jangan tutup halaman."}</span>
              </div>
            </div>
          )}

          {view === "overview" && (
            <>
              <section className="stats-grid">
                <article className="stat-card"><span className="stat-icon stat-blue">▤</span><div><span>Total lowongan</span><strong>{loading ? "—" : jobs.length}</strong><small>Dalam 30 hari terakhir</small></div></article>
                <article className="stat-card"><span className="stat-icon stat-green">◷</span><div><span>Tanggal diketahui</span><strong>{loading ? "—" : datedJobs.length}</strong><small>Tanggal posting terbaca</small></div></article>
                <article className="stat-card"><span className="stat-icon stat-orange">↗</span><div><span>Sumber pencarian</span><strong>{loading ? "—" : sources.length}</strong><small>JobStreet dan Glints</small></div></article>
                <article className="stat-card"><span className="stat-icon stat-purple">⌕</span><div><span>Cocok dengan pencarian</span><strong>{loading ? "—" : matchingJobs.length}</strong><small>{query ? `Kata kunci: ${query}` : "Semua lowongan tersimpan"}</small></div></article>
              </section>
              <section className="content-card overview-card">
                <div className="section-heading">
                  <div><h2>Lowongan terbaru</h2><p>Hasil gabungan dari seluruh tautan yang tersimpan.</p></div>
                  <button className="button button-secondary" type="button" onClick={() => setView("jobs")}>Lihat semua</button>
                </div>
                {loading ? <p className="empty-inline">Memuat lowongan…</p> : (
                  <div className="job-list">{recentJobs.length ? recentJobs.map((job) => renderJob(job)) : <p className="empty-inline">Belum ada lowongan bertanggal terbaru yang cocok.</p>}</div>
                )}
              </section>
              <section className="content-card quick-source">
                <div><span className="quick-icon">↗</span><div><h2>Tambah sumber pencarian</h2><p>Tempel beberapa URL sekaligus, masing-masing satu baris.</p></div></div>
                <button className="button button-primary" type="button" onClick={() => setView("sources")}>Kelola tautan</button>
              </section>
            </>
          )}

          {view === "jobs" && (
            <>
              <section className="content-card filters-card">
                <div className="filter-search">
                  <span aria-hidden="true">⌕</span>
                  <input aria-label="Cari berdasarkan judul pekerjaan" placeholder="Cari berdasarkan judul pekerjaan…" value={query} onChange={(event) => {
                    setQuery(event.target.value);
                    localStorage.setItem("loker:q", event.target.value);
                  }} />
                </div>
                <label className="range-select">Rentang
                  <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
                    {[3, 7, 14, 30].map((value) => <option key={value} value={value}>{value} hari</option>)}
                  </select>
                </label>
                <span className="results-count">{matchingJobs.length} hasil cocok</span>
              </section>
              <section className="jobs-results">
                {loading ? <div className="empty-state"><span className="spinner spinner-large" /><h3>Memuat lowongan</h3></div> : renderJobResults()}
              </section>
            </>
          )}

          {view === "sources" && (
            <>
            <section className="source-summary" aria-label="Ringkasan tautan">
              <article className="source-summary-card">
                <span className="source-summary-icon">▤</span>
                <div className="source-summary-copy">
                  <span>Total lowongan unik</span>
                  <strong>{loading ? "—" : totalLinkedJobs}</strong>
                  <small>{loading ? "Menghitung hasil per tautan…" : `${totalSourceJobs} hasil terhubung dari semua tautan, termasuk duplikat`}</small>
                </div>
              </article>
              <article className="source-summary-card">
                <span className="source-summary-icon source-summary-icon-green">↗</span>
                <div className="source-summary-copy">
                  <span>Tautan tersimpan</span>
                  <strong>{loading ? "—" : sources.length}</strong>
                  <small>JobStreet dan Glints</small>
                </div>
              </article>
            </section>
            <div className="sources-page-grid">
              <section className="content-card upload-card">
                <div className="section-heading">
                  <div><h2>Tambah daftar tautan</h2><p>Tempel URL halaman hasil pencarian, satu URL per baris.</p></div>
                  <span className="step-number">01</span>
                </div>
                <form onSubmit={addLinks}>
                  <label className="field-label" htmlFor="admin-key">Kunci admin</label>
                  <input id="admin-key" className="text-input" type="password" autoComplete="current-password" required value={adminKey} placeholder="Masukkan kunci admin" onChange={(event) => {
                    setAdminKey(event.target.value);
                    localStorage.setItem("loker:key", event.target.value);
                  }} />
                  <label className="field-label" htmlFor="links-list">Daftar URL</label>
                  <textarea id="links-list" className="text-input links-textarea" rows={8} value={linksInput} placeholder={"https://id.jobstreet.com/…\nhttps://glints.com/id/opportunities/jobs/…"} onChange={(event) => setLinksInput(event.target.value)} />
                  <div className="upload-footer">
                    <span>{linksInput.split(/\r?\n/).filter((line) => line.trim()).length} URL · Maksimal 100 sekali tambah</span>
                    <button className="button button-primary" type="submit" disabled={!!busy || !adminKey || !linksInput.trim()}>
                      {busy === "__add__" ? "Menyimpan…" : "Simpan tautan"}
                    </button>
                  </div>
                </form>
                <p className="credit-hint">Menyimpan URL tidak memakai kredit dan belum mengambil lowongan. Klik Perbarui pada URL setelah tersimpan untuk menjalankan scrape.</p>
              </section>

              {process.env.NODE_ENV === "development" && (
                <details className="dev-tools"><summary>Alat uji lokal (tanpa kredit)</summary>
                  <p>Memproses .cache/last-extract.json untuk URL pertama di daftar tanpa menghubungi ScrapeGraphAI.</p>
                  <button className="button button-secondary" type="button" disabled={!!busy || !adminKey || !linksInput.trim()} onClick={() => {
                    const target = linksInput.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
                    if (target) void scrape(target, true);
                  }}>Uji dengan data simpanan</button>
                </details>
              )}

              <section className="content-card source-table-card">
                <div className="section-heading">
                  <div><h2>Tautan tersimpan <span className="count-pill">{sources.length}</span></h2><p>Semua lowongan dari sumber ini digabung dan bisa dicari bersama.</p></div>
                  {sources.length > 1 && <button className="button button-secondary" type="button" disabled={!!busy || refreshingAll} onClick={() => void refreshAll()}>{refreshingAll ? "Memperbarui…" : "Perbarui semua"}</button>}
                </div>
                {loading ? <p className="empty-inline">Memuat tautan…</p> : sources.length === 0 ? (
                  <div className="empty-state compact-empty"><span className="empty-icon">↗</span><h3>Belum ada tautan</h3><p>Tempel daftar URL di panel atas untuk menambahkan sumber pencarian.</p></div>
                ) : (
                  <div className="source-list">
                    {sources.map((source) => (
                      <article className="source-row" key={source.url}>
                        <div className="source-mark">{new URL(source.url).hostname.includes("glints") ? "G" : "J"}</div>
                        <div className="source-details">
                          <a href={source.url} target="_blank" rel="noopener noreferrer" title={source.url}>{shortUrl(source.url)}</a>
                          <div><span>{source.url.includes("glints") ? "Glints" : "JobStreet"}</span><span>{source.job_count} lowongan terhubung</span><span>{source.last_scraped_at ? `Diperbarui ${formatDate(source.last_scraped_at)}` : "Belum pernah diambil"}</span></div>
                        </div>
                        <div className="source-row-actions">
                          <button className="button button-secondary" type="button" disabled={!!busy} onClick={() => void scrape(source.url)}>{busy === source.url ? "Mengambil…" : "Perbarui"}</button>
                          <button className="button button-danger" type="button" disabled={!!busy} onClick={() => void removeSource(source.url)}>Hapus</button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
            </>
          )}

          <footer className="page-footer">Lowongan dari JobStreet dan Glints · Penyimpanan terkelola pribadi{loadedAt > 0 ? ` · Terakhir dimuat ${new Date(loadedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}` : ""}</footer>
        </main>
      </div>
    </div>
  );
}
