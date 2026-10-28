"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        cache: "no-store",
      });
      const body: unknown = await response.json().catch(() => null);
      if (!body || typeof body !== "object" || !("error" in body || response.ok)) {
        throw new Error("Respons server tidak valid.");
      }
      if (!response.ok) {
        throw new Error("error" in body && typeof body.error === "string" ? body.error : "Login gagal.");
      }
      router.replace("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Login gagal. Coba lagi.");
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section aria-labelledby="login-title" className="content-card login-card">
        <p className="eyebrow">PERSONAL JOB HUB</p>
        <h1 id="login-title">Masuk</h1>
        <p className="login-description">Masuk ke ruang kerja pribadi Anda.</p>
        <form className="login-form" onSubmit={submit}>
          <label className="field-label" htmlFor="login-username">Username</label>
          <input
            autoComplete="username"
            autoFocus
            className="text-input"
            id="login-username"
            onChange={(event) => setUsername(event.target.value)}
            required
            value={username}
          />
          <label className="field-label" htmlFor="login-password">Password</label>
          <input
            autoComplete="current-password"
            className="text-input"
            id="login-password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          {error && <p aria-live="polite" className="login-error" role="alert">{error}</p>}
          <button className="button button-primary" disabled={loading} type="submit">
            {loading ? "Memeriksa..." : "Masuk"}
          </button>
        </form>
      </section>
    </main>
  );
}
