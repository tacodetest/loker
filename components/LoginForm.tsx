"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const stageRef = useRef<HTMLElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [shake, setShake] = useState(false);

  // Spotlight mengikuti kursor / sentuhan
  function handlePointerMove(event: React.PointerEvent<HTMLElement>) {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    stage.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    stage.style.setProperty("--my", `${event.clientY - rect.top}px`);
  }

  function triggerShake() {
    setShake(true);
    window.setTimeout(() => setShake(false), 520);
  }

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
      if (
        !body ||
        typeof body !== "object" ||
        !("error" in body || response.ok)
      ) {
        throw new Error("Respons server tidak valid.");
      }
      if (!response.ok) {
        throw new Error(
          "error" in body && typeof body.error === "string"
            ? body.error
            : "Login gagal.",
        );
      }
      setSuccess(true);
      window.setTimeout(() => router.replace("/"), 700);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Login gagal. Coba lagi.",
      );
      setLoading(false);
      triggerShake();
    }
  }

  return (
    <main
      className="lg-stage"
      data-success={success}
      onPointerMove={handlePointerMove}
      ref={stageRef}
    >
      {/* Latar animasi */}
      <div aria-hidden className="lg-bg">
        <span className="lg-blob lg-blob-a" />
        <span className="lg-blob lg-blob-b" />
        <span className="lg-blob lg-blob-c" />
        <span className="lg-grid" />
        <span className="lg-spotlight" />
      </div>

      <section
        aria-labelledby="login-title"
        className={`lg-card${shake ? " lg-shake" : ""}`}
      >
        <header className="lg-head" style={{ ["--i" as string]: 0 }}>
          <span aria-hidden className="lg-orbit">
            <i />
            <i />
            <i />
          </span>
          <p className="lg-eyebrow">PERSONAL JOB HUB</p>
          <h1 id="login-title">Masuk</h1>
          <p className="lg-desc">Masuk ke Altaf Resume Job.</p>
        </header>

        <form className="lg-form" onSubmit={submit}>
          <div className="lg-field" style={{ ["--i" as string]: 1 }}>
            <input
              autoComplete="username"
              autoFocus
              id="login-username"
              onChange={(event) => setUsername(event.target.value)}
              placeholder=" "
              required
              value={username}
            />
            <label htmlFor="login-username">Username</label>
            <span aria-hidden className="lg-line" />
          </div>

          <div className="lg-field" style={{ ["--i" as string]: 2 }}>
            <input
              autoComplete="current-password"
              id="login-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder=" "
              required
              type={showPassword ? "text" : "password"}
              value={password}
            />
            <label htmlFor="login-password">Password</label>
            <button
              aria-label={
                showPassword ? "Sembunyikan password" : "Tampilkan password"
              }
              aria-pressed={showPassword}
              className="lg-eye"
              onClick={() => setShowPassword((value) => !value)}
              type="button"
            >
              <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
                <path
                  d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.6"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="3"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  className="lg-eye-slash"
                  d="M4 4l16 16"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.6"
                />
              </svg>
            </button>
            <span aria-hidden className="lg-line" />
          </div>

          {error && (
            <p aria-live="polite" className="lg-error" role="alert">
              {error}
            </p>
          )}

          <button
            className="lg-submit"
            data-state={success ? "success" : loading ? "loading" : "idle"}
            disabled={loading}
            style={{ ["--i" as string]: 3 }}
            type="submit"
          >
            <span className="lg-submit-text">
              {success ? "Berhasil masuk" : loading ? "Memeriksa..." : "Masuk"}
            </span>
            <span aria-hidden className="lg-spinner" />
            <svg
              aria-hidden
              className="lg-check"
              fill="none"
              height="18"
              viewBox="0 0 24 24"
              width="18"
            >
              <path
                d="M5 12.5l4.5 4.5L19 7.5"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.2"
              />
            </svg>
          </button>
        </form>
      </section>
    </main>
  );
}
