"use client";

import { useState } from "react";

export default function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSuccess(false);
    if (newPassword !== confirmPassword) {
      setMessage("Konfirmasi password baru tidak sama.");
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
      setMessage("Password berhasil diganti.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Password tidak dapat diganti.");
    } finally {
      setLoading(false);
    }
  }

  return (
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
  );
}
