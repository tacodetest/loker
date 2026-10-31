"use client";

import { useEffect, useRef, useState } from "react";
import { isSourceEnabled } from "@/scraper/lib/enabled-sources";

type SavedSource = {
  id: string;
  url: string;
  source: "jobstreet" | "glints";
  is_active: boolean;
  last_scraped_at: string | null;
  last_success_at: string | null;
  last_status: string | null;
  last_error: string | null;
  job_count: number;
};

async function readResponse(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Respons server tidak valid.");
  }
  const result = body as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Permintaan gagal.");
  return result;
}

function formatUpdatedAt(value: string | null) {
  if (!value) return "Belum pernah diperbarui";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

function statusLabel(status: string | null) {
  if (status === "berhasil") return "Berhasil";
  if (status === "sebagian") return "Sebagian berhasil";
  if (status === "gagal") return "Gagal";
  if (status === "diblokir") return "Diblokir";
  if (status === "dibatasi") return "Dibatasi sementara";
  return status;
}

export default function AdminScrapePanel({ initialSources }: { initialSources: SavedSource[] }) {
  const [sources, setSources] = useState(initialSources);
  const [sourceUrl, setSourceUrl] = useState("");
  const [replacementUrls, setReplacementUrls] = useState<Record<string, string>>({});
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingRefreshes, setPendingRefreshes] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeIsNeutral, setNoticeIsNeutral] = useState(false);
  const [dialog, setDialog] = useState<{ variant: "success" | "error" | "confirm"; title: string; message: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SavedSource | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dialog) return;
    dialogRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDialog(null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dialog]);

  function showDialog(variant: "success" | "error", title: string, message: string) {
    setDialog({ variant, title, message });
  }

  async function refreshFromDatabase() {
    setError(null);
    try {
      const body = await readResponse(await fetch("/api/sources", { cache: "no-store" }));
      const refreshedSources = Array.isArray(body.sources) ? body.sources as SavedSource[] : [];
      setSources(refreshedSources);
      return refreshedSources;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Gagal memuat ulang data.");
      return null;
    }
  }

  useEffect(() => {
    const pendingIds = Object.keys(pendingRefreshes).filter(
      (id) => {
        const source = sources.find((item) => item.id === id);
        return source ? isSourceEnabled(source.source) : false;
      },
    );
    if (!pendingIds.length) return;

    let checking = false;
    const interval = window.setInterval(() => {
      if (checking) return;
      checking = true;
      void (async () => {
        const refreshedSources = await refreshFromDatabase();
        if (!refreshedSources) return;
        const completed = pendingIds.filter((id) => {
          const source = refreshedSources.find((item) => item.id === id);
          return source?.source === "glints" && source.last_scraped_at !== pendingRefreshes[id];
        });
        if (!completed.length) return;

        for (const id of completed) {
          const source = refreshedSources.find((item) => item.id === id);
          if (!source) continue;
          if (source.last_status === "dibatasi") {
            setNotice(`${source.source === "jobstreet" ? "JobStreet" : "Glints"} sedang dibatasi. ${source.last_error ?? ""}`);
            setNoticeIsNeutral(true);
          } else if (source.last_error) {
            setError(`${source.source === "jobstreet" ? "JobStreet" : "Glints"} gagal diperbarui: ${source.last_error}`);
          } else {
            setNotice(`${source.source === "jobstreet" ? "JobStreet" : "Glints"} berhasil diperbarui.`);
            setNoticeIsNeutral(false);
          }
        }
        setPendingRefreshes((current) => {
          const next = { ...current };
          for (const id of completed) delete next[id];
          return next;
        });
      })().finally(() => {
        checking = false;
      });
    }, 12_000);

    return () => window.clearInterval(interval);
  }, [pendingRefreshes, sources]);

  async function refreshSource(source: SavedSource) {
    setError(null);
    setNotice(null);
    setNoticeIsNeutral(false);
    if (!isSourceEnabled(source.source)) {
      setNotice("Saat ini hanya Glints yang didukung. Tautan JobStreet tetap tersimpan dan tidak diproses.");
      setNoticeIsNeutral(true);
      return;
    }
    try {
      const result = await readResponse(await fetch("/api/sources", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: source.url }),
      }));
      if (result.skipped === true) {
        setNotice(typeof result.message === "string" ? result.message : "Tautan masih dalam masa jeda.");
        setNoticeIsNeutral(true);
        await refreshFromDatabase();
        return;
      }
      setPendingRefreshes((current) => ({
        ...current,
        [source.id]: source.last_scraped_at,
      }));
      setNotice("Permintaan pembaruan Glints diterima. Proses berjalan di latar belakang dan halaman ini boleh ditinggalkan.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Gagal memulai scrape manual.");
    }
  }

  async function addSource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    setNoticeIsNeutral(false);
    try {
      const result = await readResponse(await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sourceUrl }),
      }));
      setSourceUrl("");
      const message = typeof result.warning === "string"
        ? result.warning
        : "Tautan tersimpan dan scrape langsung sedang dijalankan.";
      setNotice(message);
      showDialog("success", "Tautan berhasil ditambahkan", message);
      await refreshFromDatabase();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Gagal menyimpan tautan.";
      setError(message);
      showDialog("error", "Gagal menambahkan tautan", message);
    } finally {
      setLoading(false);
    }
  }

  async function replaceSource(oldUrl: string) {
    const newUrl = replacementUrls[oldUrl]?.trim();
    if (!newUrl) {
      const message = "Masukkan URL pencarian pengganti.";
      setError(message);
      showDialog("error", "URL pengganti diperlukan", message);
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    setNoticeIsNeutral(false);
    try {
      await readResponse(await fetch("/api/sources", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldUrl, newUrl }),
      }));
      setEditingUrl(null);
      setReplacementUrls((current) => {
        const next = { ...current };
        delete next[oldUrl];
        return next;
      });
      const message = "URL sumber berhasil diganti. Lowongan tersimpan akan diperbarui pada scrape berikutnya.";
      setNotice(message);
      showDialog("success", "Tautan berhasil diganti", message);
      await refreshFromDatabase();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Gagal mengganti URL.";
      setError(message);
      showDialog("error", "Gagal mengganti tautan", message);
    } finally {
      setLoading(false);
    }
  }

  function requestDeleteSource(source: SavedSource) {
    setPendingDelete(source);
    setDialog({
      variant: "confirm",
      title: "Hapus tautan?",
      message: `Hapus ${source.url}? Lowongan yang tidak digunakan sumber lain juga akan dihapus.`,
    });
  }

  async function confirmDeleteSource() {
    if (!pendingDelete) return;
    setDialog(null);
    setLoading(true);
    setError(null);
    setNotice(null);
    setNoticeIsNeutral(false);
    try {
      await readResponse(await fetch(`/api/sources?url=${encodeURIComponent(pendingDelete.url)}`, { method: "DELETE" }));
      const message = "Tautan dan data yang tidak digunakan sumber lain berhasil dihapus.";
      setNotice(message);
      setPendingDelete(null);
      showDialog("success", "Tautan berhasil dihapus", message);
      await refreshFromDatabase();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Gagal menghapus tautan.";
      setError(message);
      setPendingDelete(null);
      showDialog("error", "Gagal menghapus tautan", message);
    } finally {
      setLoading(false);
    }
  }

  const linkedJobCount = sources.reduce((total, source) => total + source.job_count, 0);

  return (
    <div className="source-manager">
      <section aria-label="Ringkasan sumber" className="source-summary">
        <article className="source-summary-card">
          <div className="source-summary-copy"><span>Lowongan terhubung</span><strong>{linkedJobCount}</strong><small>Data yang tersimpan di Supabase</small></div>
        </article>
        <article className="source-summary-card">
          <div className="source-summary-copy"><span>Tautan tersimpan</span><strong>{sources.length}</strong><small>Scraper aktif untuk Glints</small></div>
        </article>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div><h2>Tambah tautan pencarian</h2><p>Masukkan URL pencarian Glints. Scraping berjalan otomatis melalui GitHub Actions dan dapat dimulai manual dari tautan tersimpan.</p></div>
        </div>
        <form className="source-add-form" onSubmit={addSource}>
          <label className="filter-search">
            <span className="sr-only">URL pencarian Glints</span>
            <input
              autoComplete="url"
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://glints.com/id/opportunities/jobs/explore?keyword=Warehouse"
              required
              type="url"
              value={sourceUrl}
            />
          </label>
          <button className="button button-primary" disabled={loading} type="submit">{loading ? "Menyimpan..." : "Simpan tautan"}</button>
        </form>
        {error && <p aria-live="polite" className="form-error">{error}</p>}
        {notice && <p aria-live="polite" className={noticeIsNeutral ? "form-neutral" : "form-success"}>{notice}</p>}
      </section>

      <section aria-labelledby="saved-links-heading" className="content-card">
        <div className="section-heading"><div><h2 id="saved-links-heading">Tautan tersimpan</h2><p>Status di bawah berasal dari proses scrape terakhir. Pembaruan manual berjalan di latar belakang.</p></div></div>
        {sources.length === 0 ? (
          <div className="empty-inline">Belum ada tautan pencarian tersimpan.</div>
        ) : (
          <ul className="saved-link-list">
            {sources.map((source) => (
              <li className="saved-link-item" key={source.id}>
                <div className="saved-link-main">
                  <strong className="site-tag">{source.source === "jobstreet" ? "JobStreet" : "Glints"}</strong>
                  {!isSourceEnabled(source.source) && <span className="source-disabled-label">Dinonaktifkan</span>}
                  <a href={source.url} rel="noreferrer" target="_blank">{source.url}</a>
                  <span>{source.last_status ? `Status: ${statusLabel(source.last_status)}` : "Status: menunggu scrape otomatis"}</span>
                  {source.last_status === "diblokir" && (
                    <span>Scrape dihentikan karena akses diblokir atau captcha; data lama tetap dipertahankan.</span>
                  )}
                  {!isSourceEnabled(source.source) && (
                    <span>Tautan tersimpan, tetapi pembaruan JobStreet sedang dinonaktifkan.</span>
                  )}
                  {pendingRefreshes[source.id] !== undefined && (
                    <strong aria-live="polite">Pembaruan sedang berjalan di latar belakang. Anda boleh meninggalkan halaman ini.</strong>
                  )}
                  {source.last_error && (
                    <span className={["sebagian", "dibatasi"].includes(source.last_status ?? "") ? undefined : "form-error"}>
                      {source.last_error}
                    </span>
                  )}
                  <span>{source.job_count} lowongan terhubung</span>
                  <small>Percobaan terakhir: {formatUpdatedAt(source.last_scraped_at)}</small>
                  <small>Berhasil terakhir: {formatUpdatedAt(source.last_success_at)}</small>
                </div>
                <div className="saved-link-actions">
                  <button
                    className="button button-primary"
                    disabled={loading || !isSourceEnabled(source.source) || pendingRefreshes[source.id] !== undefined}
                    onClick={() => void refreshSource(source)}
                    type="button"
                  >
                    {pendingRefreshes[source.id] !== undefined ? "Sedang diperbarui..." : "Perbarui sekarang"}
                  </button>
                  <button className="button button-secondary" disabled={loading} onClick={() => setEditingUrl(editingUrl === source.url ? null : source.url)} type="button">Ganti URL</button>
                  <button className="button button-secondary" disabled={loading} onClick={() => requestDeleteSource(source)} type="button">Hapus</button>
                </div>
                {editingUrl === source.url && (
                  <div className="saved-link-replace">
                    <label className="filter-search">
                      <span className="sr-only">URL pencarian baru</span>
                      <input
                        onChange={(event) => setReplacementUrls((current) => ({ ...current, [source.url]: event.target.value }))}
                        placeholder="Masukkan URL pencarian Glints yang baru"
                        type="url"
                        value={replacementUrls[source.url] ?? ""}
                      />
                    </label>
                    <button className="button button-primary" disabled={loading} onClick={() => replaceSource(source.url)} type="button">Simpan URL baru</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog && (
        <div
          className="result-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialog(null);
          }}
        >
          <div
            aria-describedby="source-modal-description"
            aria-labelledby="source-modal-title"
            aria-modal="true"
            className={`result-modal result-modal-${dialog.variant}`}
            ref={dialogRef}
            role={dialog.variant === "error" || dialog.variant === "confirm" ? "alertdialog" : "dialog"}
            tabIndex={-1}
          >
            <button aria-label="Tutup" className="result-modal-close" onClick={() => setDialog(null)} type="button">×</button>
            <span aria-hidden="true" className="result-modal-icon">
              {dialog.variant === "success" ? "✓" : dialog.variant === "confirm" ? "?" : "!"}
            </span>
            <h2 id="source-modal-title">{dialog.title}</h2>
            <p id="source-modal-description">{dialog.message}</p>
            <div className="result-modal-actions">
              {dialog.variant === "confirm" && (
                <button className="button button-secondary" onClick={() => { setDialog(null); setPendingDelete(null); }} type="button">Batal</button>
              )}
              <button
                autoFocus
                className={`button ${dialog.variant === "error" || dialog.variant === "confirm" ? "button-danger" : "button-primary"}`}
                onClick={dialog.variant === "confirm" ? () => void confirmDeleteSource() : () => setDialog(null)}
                type="button"
              >
                {dialog.variant === "confirm" ? "Hapus tautan" : "Mengerti"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
