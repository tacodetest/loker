"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type ScrapeSource = {
  url: string;
  status: "pending" | "scraping" | "done" | "failed";
  count?: number;
  error?: string;
};

type SavedSource = {
  url: string;
  last_scraped_at: string | null;
  auto_scrape_updated_at: string | null;
  auto_scrape_status: "running" | "success" | "failed" | null;
  auto_scrape_error: string | null;
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

type DialogState = {
  variant: "success" | "error" | "confirm";
  title: string;
  message: string;
  sourceUrl?: string;
};

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

function formatUpdatedAt(source: SavedSource) {
  const updatedAt = source.auto_scrape_updated_at ?? source.last_scraped_at;
  if (!updatedAt) return "Belum pernah diperbarui";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(updatedAt));
}

function formatAutomaticStatus(source: SavedSource) {
  if (source.auto_scrape_status === "success") return "Status: berhasil diperbarui";
  if (source.auto_scrape_status === "failed") return "Status: gagal diperbarui";
  if (source.auto_scrape_status === "running") return "Status: sedang diperbarui";
  return "Status: menunggu pembaruan otomatis";
}

export default function AdminScrapePanel({ initialSources }: { initialSources: SavedSource[] }) {
  const router = useRouter();
  const [sourceUrl, setSourceUrl] = useState("");
  const [sources, setSources] = useState<SavedSource[]>(initialSources);
  const [activeBatches, setActiveBatches] = useState<ActiveBatch[]>([]);
  const [replacementUrls, setReplacementUrls] = useState<Record<string, string>>({});
  const [task, setTask] = useState<BatchTask | null>(null);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const batchSectionRef = useRef<HTMLElement>(null);
  const batchResultsRef = useRef<HTMLDivElement>(null);
  const taskBatchId = task?.batchId;

  useEffect(() => {
    if (!taskBatchId) return;
    const frame = window.requestAnimationFrame(() => {
      batchSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [taskBatchId]);

  useEffect(() => {
    if (!dialog) return;
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDialog(null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [dialog]);

  function showError(title: string, reason: unknown, fallback: string) {
    setDialog({
      variant: "error",
      title,
      message: reason instanceof Error ? reason.message : fallback,
    });
  }

  async function loadSources() {
    try {
      const body = await responseJson(await fetch("/api/sources", { cache: "no-store" }));
      setSources(Array.isArray(body.sources) ? body.sources as SavedSource[] : []);
    } catch (reason) {
      showError("Gagal memuat tautan", reason, "Gagal memuat sumber.");
    }
  }

  async function loadActiveBatches() {
    batchResultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const body = await responseJson(await fetch("/api/scrape", {
        cache: "no-store",
      }));
      setActiveBatches(Array.isArray(body.batches) ? body.batches as ActiveBatch[] : []);
      window.requestAnimationFrame(() => {
        batchResultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (reason) {
      showError("Gagal memuat progres", reason, "Gagal memuat progres batch.");
    }
  }

  async function pollBatch(batchId: string) {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      await wait(2000);
      const response = await fetch(`/api/scrape?batchId=${encodeURIComponent(batchId)}`, {
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
        const successfulSources = results.filter((source) => source.status === "done");
        const failedSources = results.filter((source) => source.status === "failed");
        if (status === "done" && failedSources.length === 0) {
          const savedCount = successfulSources.reduce((total, source) => total + (source.count ?? 0), 0);
          setDialog({
            variant: "success",
            title: "Proses berhasil",
            message: `${savedCount} lowongan berhasil disimpan dari ${successfulSources.length} tautan.`,
          });
        } else {
          const details = failedSources.map((source) => `${source.url}: ${source.error || "Gagal diproses."}`);
          setDialog({
            variant: "error",
            title: successfulSources.length > 0 ? "Proses selesai sebagian" : "Proses gagal",
            message: details.join("\n") || "Batch gagal diproses.",
          });
        }
        await loadSources();
        router.refresh();
        setLoading(false);
        return;
      }
    }
    setDialog({
      variant: "error",
      title: "Proses masih berjalan",
      message: "Pemrosesan belum selesai. Gunakan tombol Periksa status untuk melanjutkan.",
    });
    setLoading(false);
  }

  async function startBatch(
    requestedUrls: string[],
    replacements: { from: string; to: string }[] = [],
  ) {
    setDialog(null);
    setLoading(true);
    setTask(null);
    try {
      const response = await fetch("/api/scrape", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
      showError("Scrape gagal", reason, "Gagal memulai scrape.");
      setLoading(false);
    }
  }

  async function submitBatch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestedUrl = sourceUrl.trim();
    if (!requestedUrl) {
      setDialog({ variant: "error", title: "URL diperlukan", message: "Masukkan URL sumber JobStreet." });
      return;
    }
    await startBatch([requestedUrl]);
    setSourceUrl("");
  }

  async function replaceSourceUrl(sourceUrl: string) {
    const newUrl = replacementUrls[sourceUrl]?.trim();
    if (!newUrl || newUrl === sourceUrl) {
      setDialog({ variant: "error", title: "URL pengganti tidak valid", message: "Masukkan URL pengganti yang berbeda dari URL saat ini." });
      return;
    }
    await startBatch([newUrl], [{ from: sourceUrl, to: newUrl }]);
  }

  async function deleteSource(sourceUrl: string) {
    setDialog({
      variant: "confirm",
      title: "Hapus tautan ini?",
      message: `Tautan ${sourceUrl} akan dihapus. Lowongan yang tidak digunakan sumber lain juga akan dihapus.`,
      sourceUrl,
    });
  }

  async function confirmDeleteSource(sourceUrl: string) {
    setDialog(null);
    setLoading(true);
    try {
      const response = await fetch(`/api/sources?url=${encodeURIComponent(sourceUrl)}`, {
        method: "DELETE",
      });
      await responseJson(response);
      setDialog({ variant: "success", title: "Tautan berhasil dihapus", message: "Sumber dan lowongan yatim terkait sudah dihapus." });
      await loadSources();
      router.refresh();
    } catch (reason) {
      showError("Gagal menghapus tautan", reason, "Gagal menghapus sumber.");
    } finally {
      setLoading(false);
    }
  }

  async function resumeBatch() {
    if (!task) return;
    setDialog(null);
    setLoading(true);
    batchSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      await pollBatch(task.batchId);
    } catch (reason) {
      showError("Gagal memeriksa progres", reason, "Gagal memeriksa progres batch.");
      setLoading(false);
    }
  }

  async function resumeSavedBatch(batch: ActiveBatch) {
    setDialog(null);
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
    try {
      await pollBatch(batch.id);
    } catch (reason) {
      showError("Gagal melanjutkan batch", reason, "Gagal memeriksa progres batch.");
      setLoading(false);
    }
  }

  const batchActive = task?.status === "pending" || task?.status === "scraping";

  const linkedJobCount = sources.reduce((total, source) => total + source.job_count, 0);

  return (
    <>
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

      <section aria-labelledby="source-examples-title" className="content-card source-instructions-card">
        <div className="section-heading">
          <div>
            <h2 id="source-examples-title">Panduan link pencarian</h2>
            <p>Silakan masukkan link pencarian JobStreet. Kata kunci pekerjaan dan nomor halaman dapat disesuaikan.</p>
          </div>
        </div>
        <ul className="source-example-list">
          <li>
            <a href="https://id.jobstreet.com/id/Warehouse-jobs/in-Surabaya-Jawa-Timur?daterange=7" rel="noreferrer" target="_blank">
              <code>https://id.jobstreet.com/id/<strong>Warehouse</strong>-jobs/in-Surabaya-Jawa-Timur?daterange=7</code>
            </a>
          </li>
          <li>
            <a href="https://id.jobstreet.com/id/Warehouse-jobs/in-Surabaya-Jawa-Timur?daterange=7&amp;page=2" rel="noreferrer" target="_blank">
              <code>https://id.jobstreet.com/id/<strong>Warehouse</strong>-jobs/in-Surabaya-Jawa-Timur?daterange=7&amp;page=<strong>2</strong></code>
            </a>
          </li>
        </ul>
        <p className="source-instructions-note">Sesuaikan teks <strong>Warehouse</strong> dengan kata kunci pekerjaan dan angka setelah <code>page=</code> untuk halaman yang ingin diambil.</p>
      </section>

      <div className="sources-page-grid">
        <section className="content-card upload-card">
          <div className="section-heading">
            <div><h2>Tambah tautan</h2><p>Masukkan satu URL JobStreet, lalu simpan sebelum menambahkan URL berikutnya.</p></div>
          </div>
          <form onSubmit={submitBatch}>
            <label className="field-label" htmlFor="source-url">URL JobStreet</label>
            <input
              className="text-input source-url-input"
              id="source-url"
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://id.jobstreet.com/..."
              required
              type="url"
              value={sourceUrl}
            />
            <div className="upload-footer">
              <span>Satu URL setiap kali simpan</span>
              <button className="button button-primary" disabled={loading} type="submit">
                {loading ? "Memproses..." : "Simpan tautan"}
              </button>
            </div>
          </form>
          <p className="credit-hint">Tautan diproses sebagai batch asynchronous oleh Firecrawl.</p>

          <div className="source-tools">
            <button className="button button-secondary" disabled={loading} onClick={loadActiveBatches} type="button">
              Muat progres batch
            </button>
            {task && !loading && batchActive && (
              <button className="button button-secondary" onClick={resumeBatch} type="button">Periksa status</button>
            )}
          </div>
          <p className="source-tool-hint">
            Gunakan jika proses scrape sebelumnya terputus atau masih berjalan. Tombol ini hanya memuat progres, bukan memulai scrape baru.
          </p>
        </section>

        <section className="content-card source-table-card">
          <div className="section-heading">
            <div><h2>Tautan tersimpan <span className="count-pill">{sources.length}</span></h2><p>Tautan diperbarui otomatis dua kali sehari. Gunakan Ganti URL hanya jika tautannya berubah.</p></div>
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
                      </div>
                      <p className="source-last-updated">Terakhir diperbarui {formatUpdatedAt(source)}</p>
                      <p
                        className={`source-auto-status${source.auto_scrape_status ? ` source-auto-status-${source.auto_scrape_status}` : ""}`}
                        title={source.auto_scrape_error ?? undefined}
                      >
                        <span aria-hidden="true" />
                        {formatAutomaticStatus(source)}
                      </p>
                      {source.auto_scrape_status === "failed" && source.auto_scrape_error && (
                        <small className="source-status-error">{source.auto_scrape_error}</small>
                      )}
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
                      <button className="button button-secondary" disabled={loading} onClick={() => replaceSourceUrl(source.url)} type="button">Ganti URL</button>
                      <button className="button button-danger" disabled={loading} onClick={() => deleteSource(source.url)} type="button">Hapus</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="batch-results" ref={batchResultsRef}>
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
            <section aria-live="polite" className="content-card batch-card batch-status-card" ref={batchSectionRef}>
              <div className="section-heading">
                <div>
                  <h2>Status batch: {statusLabel(task.status)}</h2>
                  <p>{task.completed} dari {task.total} sumber selesai diproses.</p>
                  {batchActive && (
                    <p className="batch-stay-message">
                      <strong>Mohon tetap di halaman ini, tunggu proses sampai selesai!</strong>
                    </p>
                  )}
                </div>
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
    </div>
    {dialog && (
      <div
        className="result-modal-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setDialog(null);
        }}
      >
        <section
          aria-describedby="result-modal-description"
          aria-labelledby="result-modal-title"
          aria-modal="true"
          className={`result-modal result-modal-${dialog.variant}`}
          ref={dialogRef}
          role={dialog.variant === "confirm" ? "alertdialog" : "dialog"}
          tabIndex={-1}
        >
          <button
            aria-label="Tutup dialog"
            className="result-modal-close"
            onClick={() => setDialog(null)}
            type="button"
          >
            ×
          </button>
          <span aria-hidden="true" className="result-modal-icon">
            {dialog.variant === "success" ? "✓" : dialog.variant === "confirm" ? "?" : "!"}
          </span>
          <h2 id="result-modal-title">{dialog.title}</h2>
          <p id="result-modal-description">{dialog.message}</p>
          <div className="result-modal-actions">
            {dialog.variant === "confirm" && dialog.sourceUrl ? (
              <>
                <button className="button button-secondary" onClick={() => setDialog(null)} type="button">
                  Batal
                </button>
                <button
                  className="button button-danger"
                  disabled={loading}
                  onClick={() => {
                    if (dialog.sourceUrl) void confirmDeleteSource(dialog.sourceUrl);
                  }}
                  type="button"
                >
                  Hapus tautan
                </button>
              </>
            ) : (
              <button
                autoFocus
                className={`button ${dialog.variant === "error" ? "button-danger" : "button-primary"}`}
                onClick={() => setDialog(null)}
                type="button"
              >
                Mengerti
              </button>
            )}
          </div>
        </section>
      </div>
    )}
    </>
  );
}
