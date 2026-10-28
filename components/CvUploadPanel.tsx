"use client";

import { useEffect, useRef, useState } from "react";
import { useSessionState } from "./SessionState";
import { z } from "zod";

type CvInfo = {
  name: string;
  size: number | null;
  updatedAt: string | null;
  url: string;
};

type CvAnalysis = {
  analyzedAt: string;
  keywords: string[];
  matches: {
    job: {
      job_url: string;
      title: string;
      company: string | null;
      location: string | null;
      salary: string | null;
      posted_time: string | null;
      scraped_at: string;
    };
    score: number;
    matchedKeywords: string[];
    explanation: string;
    matchingPoints: string[];
    missingPoints: string[];
  }[];
};

const cvAnalysisSchema = z.object({
  analyzedAt: z.string(),
  keywords: z.array(z.string()),
  matches: z.array(z.object({
    job: z.object({
      job_url: z.string(),
      title: z.string(),
      company: z.string().nullable(),
      location: z.string().nullable(),
      salary: z.string().nullable(),
      posted_time: z.string().nullable(),
      scraped_at: z.string(),
    }),
    score: z.number().min(0).max(100),
    matchedKeywords: z.array(z.string()),
    explanation: z.string(),
    matchingPoints: z.array(z.string()),
    missingPoints: z.array(z.string()),
  })),
});

type DialogState = {
  variant: "success" | "error" | "confirm";
  title: string;
  message: string;
  action?: "delete-cv";
};

type ApiRecord = Record<string, unknown>;

const maxFileSize = 10 * 1024 * 1024;

function isRecord(value: unknown): value is ApiRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseCv(value: unknown): CvInfo | null {
  if (value === null) return null;
  if (
    !isRecord(value)
    || typeof value.name !== "string"
    || typeof value.url !== "string"
    || !(typeof value.size === "number" || value.size === null)
    || !(typeof value.updatedAt === "string" || value.updatedAt === null)
  ) {
    throw new Error("Respons data CV dari server tidak valid.");
  }
  return {
    name: value.name,
    size: value.size,
    updatedAt: value.updatedAt,
    url: value.url,
  };
}

async function responseJson(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body)) throw new Error("Respons server tidak valid.");
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Permintaan gagal.");
  }
  return body;
}

function formatFileSize(size: number | null) {
  if (size === null) return "Ukuran file tidak tersedia";
  return `${(size / (1024 * 1024)).toFixed(2)} MiB`;
}

export default function CvUploadPanel({ savedAnalysis }: { savedAnalysis: unknown }) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [cv, setCv] = useState<CvInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysis, setAnalysis] = useSessionState<CvAnalysis | null>(
    "cv-analysis",
    isRecord(savedAnalysis) ? parseAnalysis(savedAnalysis) : null,
  );
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function parseAnalysis(body: ApiRecord): CvAnalysis | null {
    if (body.analysis === null && body.analyzedAt === null) return null;
    return cvAnalysisSchema.parse({
      ...(isRecord(body.analysis) ? body.analysis : {}),
      analyzedAt: body.analyzedAt,
    });
  }

  async function loadCv() {
    try {
      const [cvResponse, analysisResponse] = await Promise.all([
        fetch("/api/cv", { cache: "no-store" }),
        fetch("/api/cv/analyze", { cache: "no-store" }),
      ]);
      const [cvBody, analysisBody] = await Promise.all([
        responseJson(cvResponse),
        responseJson(analysisResponse),
      ]);
      const loadedCv = parseCv(cvBody.cv);
      setCv(loadedCv);
      setAnalysis(parseAnalysis(analysisBody));
      setDialog(loadedCv
        ? { variant: "success", title: "CV berhasil dimuat", message: "CV dan hasil analisis tersimpan sudah ditampilkan." }
        : { variant: "error", title: "CV belum tersedia", message: "Unggah CV PDF terlebih dahulu." });
    } catch (error) {
      showError("Gagal memuat CV", error, "CV tidak dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }

  function refreshCv() {
    setLoading(true);
    void loadCv();
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0] ?? null;
    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (
      !file.name.toLowerCase().endsWith(".pdf")
      || (file.type && file.type !== "application/pdf")
    ) {
      input.value = "";
      setSelectedFile(null);
      setDialog({ variant: "error", title: "File bukan PDF", message: "Pilih CV dengan format PDF." });
      return;
    }
    if (file.size === 0 || file.size > maxFileSize) {
      input.value = "";
      setSelectedFile(null);
      setDialog({ variant: "error", title: "Ukuran file tidak valid", message: "Ukuran CV harus lebih dari 0 dan maksimal 10 MiB." });
      return;
    }

    try {
      const signature = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
      if (signature !== "%PDF-") {
        input.value = "";
        setSelectedFile(null);
        setDialog({ variant: "error", title: "File bukan PDF", message: "Isi file tidak terdeteksi sebagai dokumen PDF yang valid." });
        return;
      }
      setSelectedFile(file);
    } catch (error) {
      input.value = "";
      setSelectedFile(null);
      showError("Gagal membaca file", error, "File CV tidak dapat dibaca.");
    }
  }

  async function uploadCv(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) {
      setDialog({ variant: "error", title: "CV diperlukan", message: "Pilih file CV berformat PDF sebelum mengunggah." });
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const body = await responseJson(await fetch("/api/cv", {
        method: "POST",
        body: formData,
      }));
      const uploadedCv = parseCv(body.cv);
      if (!uploadedCv) throw new Error("Server tidak mengembalikan data CV yang tersimpan.");

      setCv(uploadedCv);
      setAnalysis(null);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setDialog({ variant: "success", title: "CV berhasil diunggah", message: "CV PDF Anda tersimpan dengan aman di Supabase." });
    } catch (error) {
      showError("Upload CV gagal", error, "CV tidak dapat diunggah.");
    } finally {
      setLoading(false);
    }
  }

  async function analyzeCv() {
    setAnalysisLoading(true);
    try {
      const body = await responseJson(await fetch("/api/cv/analyze", {
        method: "POST",
        cache: "no-store",
      }));
      setAnalysis(parseAnalysis(body));
    } catch (error) {
      showError("Analisis CV gagal", error, "CV tidak dapat dianalisis.");
    } finally {
      setAnalysisLoading(false);
    }
  }

  function requestDeleteCv() {
    setDialog({
      variant: "confirm",
      title: "Hapus CV tersimpan?",
      message: "File CV dan hasil analisis tersimpan akan dihapus permanen dari akun ini.",
      action: "delete-cv",
    });
  }

  async function deleteCv() {
    setDialog(null);
    setLoading(true);
    try {
      await responseJson(await fetch("/api/cv", {
        method: "DELETE",
        cache: "no-store",
      }));
      setCv(null);
      setAnalysis(null);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setDialog({ variant: "success", title: "CV berhasil dihapus", message: "File CV dan hasil analisis tersimpan sudah dihapus dari akun ini." });
    } catch (error) {
      showError("Gagal menghapus CV", error, "CV tidak dapat dihapus.");
    } finally {
      setLoading(false);
    }
  }

  function confirmDialogAction() {
    if (dialog?.action === "delete-cv") void deleteCv();
  }

  return (
    <>
      <section className="content-card cv-card">
        <div className="section-heading">
          <div>
            <h2>CV pribadi</h2>
            <p>Unggah satu file PDF. Upload baru akan menggantikan CV yang tersimpan.</p>
          </div>
        </div>

        <div className="cv-load-action">
          <button
            className="button button-secondary"
            disabled={loading}
            onClick={refreshCv}
            type="button"
          >
            {loading ? "Memuat..." : "Tampilkan CV tersimpan"}
          </button>
        </div>

        <form className="cv-upload-form" onSubmit={uploadCv}>
          <label className="field-label" htmlFor="cv-file">File CV (PDF)</label>
          <input
            accept=".pdf,application/pdf"
            className="text-input cv-file-input"
            id="cv-file"
            onChange={handleFileChange}
            ref={fileInputRef}
            type="file"
          />
          <div className="upload-footer">
            <span>{selectedFile ? selectedFile.name : "PDF, maksimal 10 MiB"}</span>
            <button className="button button-primary" disabled={loading} type="submit">
              {loading ? "Menyimpan..." : "Upload CV"}
            </button>
          </div>
        </form>

        {cv ? (
          <section aria-label="CV tersimpan" className="cv-preview-section">
            <div className="cv-file-details">
              <div>
                <h3>{cv.name}</h3>
                <p>
                  {formatFileSize(cv.size)}
                  {cv.updatedAt && ` · Diperbarui ${new Intl.DateTimeFormat("id-ID", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(cv.updatedAt))}`}
                </p>
              </div>
              <a className="button button-secondary" href={cv.url} rel="noreferrer" target="_blank">
                Buka PDF
              </a>
              <button
                className="button button-danger"
                disabled={loading}
                onClick={requestDeleteCv}
                type="button"
              >
                Hapus CV
              </button>
            </div>
            <iframe className="cv-preview" src={cv.url} title="Pratinjau CV PDF" />
          </section>
        ) : (
          <p className="cv-empty-state">Belum ada CV yang ditampilkan. Muat CV tersimpan atau pilih PDF untuk mengunggah.</p>
        )}

        <section aria-labelledby="cv-match-title" className="cv-match-section">
          <div className="cv-match-heading">
            <div>
              <h2 id="cv-match-title">Kecocokan dengan lowongan</h2>
              <p>Pemeringkatan kata kunci dihitung lokal dari CV dan lowongan 7 hari terakhir.</p>
            </div>
            <button
              className="button button-primary"
              disabled={analysisLoading || loading}
              onClick={analyzeCv}
              type="button"
            >
              {analysisLoading
                ? (analysis ? "Menganalisis ulang..." : "Menganalisis...")
                : (analysis ? "Analisis ulang" : "Analisis kecocokan")}
            </button>
          </div>
          <p className="cv-privacy-note">
            Penjelasan AI memakai Gemini API free tier. Teks CV dikirim ke Google setelah bagian identitas,
            kontak, tautan, dan data sensitif umum disamarkan. Google dapat menggunakan data free tier untuk meningkatkan produk.
          </p>
          {analysisLoading && (
            <div aria-live="polite" className="cv-analysis-loading">
              <span className="spinner" />
              <p>Mencocokkan kata kunci dan meminta penjelasan AI untuk lowongan teratas...</p>
            </div>
          )}
          {analysis && (
            <div aria-live="polite" className="cv-analysis-results">
              <p className="cv-score-disclaimer">
                Hasil terakhir disimpan {new Intl.DateTimeFormat("id-ID", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(analysis.analyzedAt))}. Hasil tetap tersedia sampai Anda menjalankan analisis ulang.
              </p>
              <div className="cv-keywords">
                <strong>Kata kunci CV</strong>
                <div>{analysis.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</div>
              </div>
              {analysis.matches.length ? analysis.matches.map((match) => (
                <article className="cv-match-card" key={match.job.job_url}>
                  <div className="cv-match-card-heading">
                    <div>
                      <p className="eyebrow">SKOR KATA KUNCI</p>
                      <h3>{match.job.title}</h3>
                      <p className="cv-match-meta">
                        {match.job.company || "Perusahaan tidak dicantumkan"}
                        {match.job.location ? ` · ${match.job.location}` : ""}
                      </p>
                    </div>
                    <strong aria-label={`Skor kecocokan ${match.score} persen`} className="cv-match-score">
                      {match.score}%
                    </strong>
                  </div>
                  {match.job.salary && <p className="cv-match-salary">{match.job.salary}</p>}
                  <p className="cv-match-explanation">{match.explanation}</p>
                  {match.matchedKeywords.length > 0 && (
                    <div className="cv-match-list">
                      <strong>Kata kunci cocok</strong>
                      <p>{match.matchedKeywords.join(", ")}</p>
                    </div>
                  )}
                  {match.matchingPoints.length > 0 && (
                    <div className="cv-match-list">
                      <strong>Kecocokan yang ditemukan</strong>
                      <ul>{match.matchingPoints.map((point) => <li key={point}>{point}</li>)}</ul>
                    </div>
                  )}
                  {match.missingPoints.length > 0 && (
                    <div className="cv-match-list cv-match-gaps">
                      <strong>Persyaratan yang belum terlihat di CV</strong>
                      <ul>{match.missingPoints.map((point) => <li key={point}>{point}</li>)}</ul>
                    </div>
                  )}
                  <a
                    className="button button-secondary cv-match-link"
                    href={`/job?url=${encodeURIComponent(match.job.job_url)}`}
                  >
                    Lihat detail lowongan
                  </a>
                </article>
              )) : (
                <p className="cv-empty-state">Belum ada lowongan aktif dalam tujuh hari terakhir untuk dicocokkan.</p>
              )}
              <p className="cv-score-disclaimer">
                Persentase adalah perkiraan kecocokan kata kunci lokal, bukan jaminan diterima. Verifikasi setiap persyaratan pada lowongan asli.
              </p>
            </div>
          )}
        </section>
      </section>

      {dialog && (
        <div
          className="result-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialog(null);
          }}
        >
          <div
            aria-describedby="cv-modal-description"
            aria-labelledby="cv-modal-title"
            aria-modal="true"
            className={`result-modal result-modal-${dialog.variant}`}
            ref={dialogRef}
            role={dialog.variant === "error" || dialog.variant === "confirm" ? "alertdialog" : "dialog"}
            tabIndex={-1}
          >
            <button
              aria-label="Tutup"
              className="result-modal-close"
              onClick={() => setDialog(null)}
              type="button"
            >
              ×
            </button>
            <span aria-hidden="true" className="result-modal-icon">
              {dialog.variant === "success" ? "✓" : dialog.variant === "confirm" ? "?" : "!"}
            </span>
            <h2 id="cv-modal-title">{dialog.title}</h2>
            <p id="cv-modal-description">{dialog.message}</p>
            <div className="result-modal-actions">
              {dialog.variant === "confirm" && (
                <button
                  className="button button-secondary"
                  onClick={() => setDialog(null)}
                  type="button"
                >
                  Batal
                </button>
              )}
              <button
                autoFocus
                className={`button ${dialog.variant === "error" || dialog.variant === "confirm" ? "button-danger" : "button-primary"}`}
                onClick={dialog.variant === "confirm" ? confirmDialogAction : () => setDialog(null)}
                type="button"
              >
                {dialog.variant === "confirm" ? "Hapus CV" : "Mengerti"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
