"use client";

import Link from "next/link";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="main-content">
      <section aria-labelledby="page-error-title" className="page-error content-card" role="alert">
        <span aria-hidden="true" className="page-error-icon">!</span>
        <p className="eyebrow">TERJADI GANGGUAN</p>
        <h1 id="page-error-title">Data belum dapat dimuat</h1>
        <p className="page-error-description">
          Ada kendala saat menghubungkan ke data lowongan. Coba lagi beberapa saat lagi.
        </p>
        <div className="page-error-actions">
          <button className="button button-primary" onClick={reset} type="button">
            Coba lagi
          </button>
          <Link className="button button-secondary" href="/">
            Kembali ke ringkasan
          </Link>
        </div>
      </section>
    </main>
  );
}
