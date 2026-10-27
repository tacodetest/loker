"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ScrapeSource = {
  url: string;
  status: "pending" | "scraping" | "done" | "failed";
  count?: number;
  error?: string;
};

type SavedSource = {
  url: string;
  last_scraped_at: string | null;
  job_count: number;
};

type BatchTask = {
  batchId: string;
  status: "pending" | "scraping" | "done" | "failed";
  total: number;
  completed: number;
  sources: ScrapeSource[];
};

type ActiveBatch = {
  id: string;
  requested_urls: string[];
  status: "pending" | "scraping";
  total: number;
  completed: number;
  created_at: string;
};

type ApiRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ApiRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function responseJson(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body)) throw new Error("Respons server tidak valid.");
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Permintaan gagal.");
  }
  return body;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusLabel(status: ScrapeSource["status"]) {
  return {
    pending: "Menunggu",
    scraping: "Sedang diproses",
    done: "Selesai",
    failed: "Gagal",
  }[status];
}

export default function AdminScrapePanel({ initialSources }: { initialSources: SavedSource[] }) {
  const router = useRouter();
  const [adminKey, setAdminKey] = useState("");
  const [urls, setUrls] = useState("");
  const [sources, setSources] = useState<SavedSource[]>(initialSources);
  const [activeBatches, setActiveBatches] = useState<ActiveBatch[]>([]);
  const [replacementUrls, setReplacementUrls] = useState<Record<string, string>>({});
  const [task, setTask] = useState<BatchTask | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadSources() {
    setError("");
    try {
      const body = await responseJson(await fetch("/api/sources", { cache: "no-store" }));
      setSources(Array.isArray(body.sources) ? body.sources as SavedSource[] : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Gagal memuat sumber.");
    }
  }

  async function loadActiveBatches() {
    setError("");
    try {
      const body = await responseJson(await fetch("/api/scrape", {
        headers: { "x-admin-key": adminKey },
        cache: "no-store",
      }));
      setActiveBatches(Array.isArray(body.batches) ? body.batches as ActiveBatch[] : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Gagal memuat progres batch.");
    }
  }

  async function pollBatch(batchId: string) {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      await wait(2000);
      const response = await fetch(`/api/scrape?batchId=${encodeURIComponent(batchId)}`, {
        headers: { "x-admin-key": adminKey },
        cache: "no-store",
      });
      const body = await responseJson(response);
      const status = body.status;
      const results = Array.isArray(body.sources) ? body.sources as ScrapeSource[] : [];
      setTask((current) => current && current.batchId === batchId
        ? {
            ...current,
            status: status === "done" || status === "failed" ? status : "scraping",
            total: typeof body.total === "number" ? body.total : current.total,
            completed: typeof body.completed === "number" ? body.completed : current.completed,
            sources: results.length ? results : current.sources.map((source) => ({
              ...source,
              status: "scraping",
            })),
          }
        : current);

      if (status === "done" || status === "failed") {
        setMessage(status === "done" ? "Batch selesai diproses." : "Batch gagal diproses.");
        await loadSources();
        router.refresh();
        setLoading(false);
        return;
      }
    }
    setError("Pemrosesan masih berjalan. Gunakan tombol Periksa status untuk melanjutkan.");
    setLoading(false);
  }

  async function startBatch(
    requestedUrls: string[],
    replacements: { from: string; to: string }[] = [],
  ) {
    setError("");
    setMessage("");
    setLoading(true);
    setTask(null);
    try {
      const response = await fetch("/api/scrape", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({ urls: requestedUrls, replacements }),
      });
      const body = await responseJson(response);
      if (typeof body.batchId !== "string") throw new Error("Server tidak mengembalikan ID batch.");

      const batchId = body.batchId;
      setTask({
        batchId,
        status: "pending",
        total: typeof body.total === "number" ? body.total : requestedUrls.length,
        completed: 0,
        sources: requestedUrls.map((url) => ({ url, status: "pending" })),
      });
      await pollBatch(batchId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Gagal memulai scrape.");
      setLoading(false);
    }
  }

  async function submitBatch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestedUrls = urls.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
    if (!adminKey.trim()) {
      setError("Masukkan kunci admin.");
      return;
    }
    if (!requestedUrls.length) {
      setError("Masukkan setidaknya satu URL sumber.");
      return;
    }
    setUrls("");
    await startBatch(requestedUrls);
  }

  async function updateSource(sourceUrl: string) {
    const newUrl = replacementUrls[sourceUrl]?.trim();
    if (!adminKey.trim()) return setError("Masukkan kunci admin.");
    if (!newUrl || newUrl === sourceUrl) return setError("Masukkan URL pengganti yang berbeda.");
    await startBatch([newUrl], [{ from: sourceUrl, to: newUrl }]);
  }

  async function refreshAllSources() {
    if (!adminKey.trim()) {
      setError("Masukkan kunci admin.");
      return;
    }
    if (sources.length === 0) {
      setError("Belum ada tautan yang dapat diperbarui.");
      return;
    }
    await startBatch(sources.map((source) => source.url));
  }

  async function deleteSource(sourceUrl: string) {
    if (!adminKey.trim()) return setError("Masukkan kunci admin.");
    if (!window.confirm(`Hapus sumber ${sourceUrl} dan lowongan yang tidak digunakan sumber lain?`)) return;

    setError("");
    setMessage("");
    setLoading(true);
    try {
      const response = await fetch(`/api/sources?url=${encodeURIComponent(sourceUrl)}`, {
        method: "DELETE",
        headers: { "x-admin-key": adminKey },
      });
      await responseJson(response);
      setMessage("Sumber berhasil dihapus.");
      await loadSources();
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Gagal menghapus sumber.");
    } finally {
      setLoading(false);
    }
  }

  async function resumeBatch() {
    if (!task || !adminKey.trim()) return;
    setError("");
    setLoading(true);
    await pollBatch(task.batchId);
  }

  async function resumeSavedBatch(batch: ActiveBatch) {
    setError("");
    setMessage("");
    setLoading(true);
    setTask({
      batchId: batch.id,
      status: batch.status,
      total: batch.total,
      completed: batch.completed,
      sources: batch.requested_urls.map((url) => ({
        url,
        status: batch.status === "pending" ? "pending" : "scraping",
      })),
    });
    await pollBatch(batch.id);
  }

  const batchActive = task?.status === "pending" || task?.status === "scraping";

  const linkedJobCount = sources.reduce((total, source) => total + source.job_count, 0);

  return (
    <div className="source-manager">
      <section aria-label="Ringkasan sumber" className="source-summary">
        <article className="source-summary-card">
          <span aria-hidden="true" className="source-summary-icon">▤</span>
          <div className="source-summary-copy">
            <span>Lowongan terhubung</span><strong>{linkedJobCount}</strong>
            <small>Jumlah hubungan dari semua tautan</small>
          </div>
        </article>
        <article className="source-summary-card">
          <span aria-hidden="true" className="source-summary-icon source-summary-icon-green">↗</span>
          <div className="source-summary-copy">
            <span>Tautan tersimpan</span><strong>{sources.length}</strong>
            <small>Sumber JobStreet</small>
          </div>
        </article>
      </section>

      <div className="sources-page-grid">
        <section className="content-card upload-card">
          <div className="section-heading">
            <div><h2>Tambah daftar tautan</h2><p>Tempel URL halaman hasil pencarian, satu URL per baris.</p></div>
            <span aria-label="Langkah 1" className="step-number">01</span>
          </div>
          <label className="field-label" htmlFor="admin-key">Kunci admin</label>
          <input
            autoComplete="current-password"
            className="text-input"
            id="admin-key"
            onChange={(event) => setAdminKey(event.target.value)}
            placeholder="Masukkan kunci admin"
            type="password"
            value={adminKey}
          />
          <form onSubmit={submitBatch}>
            <label className="field-label" htmlFor="source-urls">Daftar URL</label>
            <textarea
              className="text-input links-textarea"
              id="source-urls"
              onChange={(event) => setUrls(event.target.value)}
              placeholder="https://id.jobstreet.com/..."
              rows={6}
              value={urls}
            />
            <div className="upload-footer">
              <span>{urls.split(/\r?\n/).filter((url) => url.trim()).length} URL · Maksimal 50 sekali tambah</span>
              <button className="button button-primary" disabled={loading} type="submit">
                {loading ? "Memproses..." : "Simpan tautan"}
              </button>
            </div>
          </form>
          <p className="credit-hint">Scrape berjalan di server menggunakan Firecrawl batch. Satu sumber gagal tidak menghentikan sumber lainnya.</p>

          <div className="source-tools">
            <button className="button button-secondary" disabled={!adminKey.trim() || loading} onClick={loadActiveBatches} type="button">
              Muat progres batch
            </button>
            {task && !loading && batchActive && (
              <button className="button button-secondary" onClick={resumeBatch} type="button">Periksa status</button>
            )}
          </div>
        </section>

        <section className="content-card source-table-card">
          <div className="section-heading">
            <div><h2>Tautan tersimpan <span className="count-pill">{sources.length}</span></h2><p>Semua lowongan dari sumber ini digabung dan bisa dicari bersama.</p></div>
            <button className="button button-secondary" disabled={loading} onClick={refreshAllSources} type="button">
              Perbarui semua
            </button>
          </div>

          {sources.length === 0 ? (
            <div className="empty-inline">Belum ada tautan tersimpan. Tambahkan URL di formulir.</div>
          ) : (
            <ul className="source-list">
              {sources.map((source) => {
                const host = source.url.replace(/^https?:\/\//, "").split(/[/?#]/)[0];
                return (
                  <li className="source-row" key={source.url}>
                    <span aria-hidden="true" className="source-mark">{host.charAt(0).toUpperCase()}</span>
                    <div className="source-details">
                      <a href={source.url} rel="noreferrer" target="_blank" title={source.url}>{host}{source.url.slice(source.url.indexOf(host) + host.length)}</a>
                      <div>
                        <span>JobStreet</span>
                        <span>{source.job_count} lowongan terhubung</span>
                        <span>{source.last_scraped_at ? `Terakhir diambil ${new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(new Date(source.last_scraped_at))}` : "Belum pernah diambil"}</span>
                      </div>
                      <label className="sr-only" htmlFor={`replace-${encodeURIComponent(source.url)}`}>URL pengganti untuk {host}</label>
                      <input
                        className="text-input replacement-input"
                        id={`replace-${encodeURIComponent(source.url)}`}
                        onChange={(event) => setReplacementUrls((current) => ({
                          ...current,
                          [source.url]: event.target.value,
                        }))}
                        value={replacementUrls[source.url] ?? source.url}
                      />
                    </div>
                    <div className="source-row-actions">
                      <button className="button button-secondary" disabled={loading} onClick={() => updateSource(source.url)} type="button">Perbarui</button>
                      <button className="button button-danger" disabled={loading} onClick={() => deleteSource(source.url)} type="button">Hapus</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {(error || message) && (
          <div className={error ? "notice notice-error source-notice" : "notice notice-success source-notice"} role={error ? "alert" : "status"}>
            <span aria-hidden="true" className="notice-icon">{error ? "!" : "✓"}</span>
            <p>{error || message}</p>
            <button aria-label="Tutup pemberitahuan" className="notice-close" onClick={() => { setError(""); setMessage(""); }} type="button">×</button>
          </div>
        )}

        {activeBatches.length > 0 && (
          <section aria-label="Batch yang sedang berjalan" className="content-card batch-card">
            <div className="section-heading"><div><h2>Progres yang berjalan</h2><p>Lanjutkan pemantauan batch yang aktif.</p></div></div>
            <ul className="batch-list">
              {activeBatches.map((batch) => (
                <li key={batch.id}>
                  <span>{batch.completed}/{batch.total} · {batch.requested_urls.length} sumber</span>
                  <button className="button button-secondary" disabled={loading} onClick={() => resumeSavedBatch(batch)} type="button">
                    Lanjutkan {statusLabel(batch.status)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {task && (
          <section aria-live="polite" className="content-card batch-card">
            <div className="section-heading">
              <div><h2>Status batch: {statusLabel(task.status)}</h2><p>{task.completed} dari {task.total} sumber selesai diproses.</p></div>
            </div>
            <ul className="batch-list">
              {task.sources.map((source) => (
                <li key={source.url}>
                  <span className="batch-source-url">{source.url}</span>
                  <strong className={source.status === "failed" ? "batch-failed" : ""}>
                    {statusLabel(source.status)}{source.status === "done" ? ` · ${source.count ?? 0} lowongan` : ""}
                  </strong>
                  {source.error && <p className="batch-error">{source.error}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
