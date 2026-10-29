"use client";

import { useEffect, useRef, useState } from "react";

export default function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<{ variant: "success" | "error"; title: string; message: string } | null>(null);
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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSuccess(false);
    if (newPassword !== confirmPassword) {
      const mismatchMessage = "Konfirmasi password baru tidak sama.";
      setMessage(mismatchMessage);
      setDialog({ variant: "error", title: "Password belum sesuai", message: mismatchMessage });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
        cache: "no-store",
      });
      const body: unknown = await response.json().catch(() => null);
      if (!body || typeof body !== "object" || !("error" in body || response.ok)) {
        throw new Error("Respons server tidak valid.");
      }
      if (!response.ok) {
        throw new Error(
          "error" in body && typeof body.error === "string"
            ? body.error
            : "Password tidak dapat diganti.",
        );
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
      const successMessage = "Password berhasil diganti.";
      setMessage(successMessage);
      setDialog({ variant: "success", title: "Password berhasil diganti", message: successMessage });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Password tidak dapat diganti.";
      setMessage(errorMessage);
      setDialog({ variant: "error", title: "Gagal mengganti password", message: errorMessage });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
    <form className="content-card account-password-form" onSubmit={submit}>
      <div className="section-heading">
        <div>
          <h2>Ganti password</h2>
          <p>Gunakan minimal 12 karakter dan pilih password unik yang belum pernah dipakai di layanan lain. Jika Chrome menawarkan menyimpan password baru, perbarui password yang tersimpan.</p>
        </div>
      </div>

      {message && (
        <p aria-live="polite" className={`notice ${success ? "notice-success" : "notice-error"}`} role="status">
          {message}
        </p>
      )}

      <label className="field-label" htmlFor="current-password">Password saat ini</label>
      <input
        autoComplete="current-password"
        className="text-input"
        id="current-password"
        onChange={(event) => setCurrentPassword(event.target.value)}
        required
        type="password"
        value={currentPassword}
      />

      <label className="field-label" htmlFor="new-password">Password baru</label>
      <input
        autoComplete="new-password"
        className="text-input"
        id="new-password"
        minLength={12}
        onChange={(event) => setNewPassword(event.target.value)}
        required
        type="password"
        value={newPassword}
      />

      <label className="field-label" htmlFor="confirm-password">Ulangi password baru</label>
      <input
        autoComplete="new-password"
        className="text-input"
        id="confirm-password"
        minLength={12}
        onChange={(event) => setConfirmPassword(event.target.value)}
        required
        type="password"
        value={confirmPassword}
      />

      <div className="account-password-actions">
        <button className="button button-primary" disabled={loading} type="submit">
          {loading ? "Menyimpan..." : "Simpan password baru"}
        </button>
      </div>
    </form>
    {dialog && (
      <div
        className="result-modal-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setDialog(null);
        }}
      >
        <div
          aria-describedby="password-modal-description"
          aria-labelledby="password-modal-title"
          aria-modal="true"
          className={`result-modal result-modal-${dialog.variant}`}
          ref={dialogRef}
          role={dialog.variant === "error" ? "alertdialog" : "dialog"}
          tabIndex={-1}
        >
          <button aria-label="Tutup" className="result-modal-close" onClick={() => setDialog(null)} type="button">×</button>
          <span aria-hidden="true" className="result-modal-icon">{dialog.variant === "success" ? "✓" : "!"}</span>
          <h2 id="password-modal-title">{dialog.title}</h2>
          <p id="password-modal-description">{dialog.message}</p>
          <div className="result-modal-actions">
            <button autoFocus className={`button ${dialog.variant === "error" ? "button-danger" : "button-primary"}`} onClick={() => setDialog(null)} type="button">Mengerti</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
