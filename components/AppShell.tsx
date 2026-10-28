"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SessionStateProvider } from "./SessionState";

const sessionIdleTimeoutMs = 30 * 60 * 1000;

const navigation = [
  { href: "/", label: "Ringkasan", icon: "⌂" },
  { href: "/jobs", label: "Semua lowongan", icon: "▤" },
  { href: "/sources", label: "Kelola tautan", icon: "↗" },
  { href: "/cv", label: "Upload CV", icon: "⇧" },
];

function activePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/jobs") return pathname === "/jobs" || pathname === "/job";
  return pathname.startsWith(href);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const [userName, setUserName] = useState<string | null>(null);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const lastActivityAt = useRef(0);
  const sessionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPage = navigation.find(({ href }) => activePath(pathname, href)) ?? navigation[0];

  const endSession = useCallback(async () => {
    if (sessionTimeout.current) clearTimeout(sessionTimeout.current);
    setSessionGeneration((generation) => generation + 1);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
      if (!response.ok) console.error("[auth] Server belum dapat mencabut sesi login.");
    } catch (error) {
      console.error("[auth] Tidak dapat menghubungi endpoint logout:", error);
    }
    router.replace("/login");
  }, [router]);

  const markSessionActivity = useCallback(() => {
    if (pathname === "/login") return;
    const now = Date.now();
    const sessionExpired = lastActivityAt.current > 0 &&
      now - lastActivityAt.current >= sessionIdleTimeoutMs;
    if (sessionExpired) {
      void endSession();
      return;
    }
    lastActivityAt.current = now;

    if (sessionTimeout.current) clearTimeout(sessionTimeout.current);

    sessionTimeout.current = setTimeout(() => {
      sessionTimeout.current = null;
      void endSession();
    }, sessionIdleTimeoutMs);
  }, [endSession, pathname]);

  useEffect(() => {
    if (pathname === "/login") return;
    const activityEvents = ["pointerdown", "keydown", "scroll", "touchstart", "wheel"] as const;
    for (const eventName of activityEvents) {
      window.addEventListener(eventName, markSessionActivity, { passive: true });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") markSessionActivity();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    markSessionActivity();

    return () => {
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, markSessionActivity);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (sessionTimeout.current) clearTimeout(sessionTimeout.current);
    };
  }, [markSessionActivity, pathname]);

  useEffect(() => {
    markSessionActivity();
  }, [markSessionActivity, pathname]);

  useEffect(() => {
    if (pathname === "/login") return;
    let active = true;
    async function refreshSession() {
      try {
        const response = await fetch("/api/auth/session", { method: "POST", cache: "no-store" });
        if (response.status === 401) {
          if (active) void endSession();
          return;
        }
        if (!response.ok) return;
        const body: unknown = await response.json();
        if (
          active
          && body !== null
          && typeof body === "object"
          && "user" in body
          && body.user !== null
          && typeof body.user === "object"
          && "name" in body.user
          && typeof body.user.name === "string"
        ) {
          setUserName(body.user.name);
        }
      } catch {
        // A temporary network error does not invalidate the server-side session.
      }
    }

    void refreshSession();
    const heartbeat = window.setInterval(() => {
      if (
        document.visibilityState === "visible"
        && Date.now() - lastActivityAt.current < 5 * 60 * 1000
      ) {
        void refreshSession();
      }
    }, 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(heartbeat);
    };
  }, [endSession, pathname]);

  async function logout() {
    setLogoutLoading(true);
    await endSession();
  }

  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="admin-layout">
      {sidebarOpen && (
        <button
          aria-label="Tutup menu"
          className="mobile-backdrop"
          onClick={() => setSidebarOpen(false)}
          type="button"
        />
      )}
      <aside className={`app-sidebar${sidebarOpen ? " app-sidebar-open" : ""}`}>
        <Link aria-label="Altaf Resume Jobstreet, halaman ringkasan" className="brand" href="/" onClick={() => setSidebarOpen(false)}>
          <span>
            <strong>Altaf Resume Jobstreet</strong>
            <small>PERSONAL JOB HUB</small>
          </span>
        </Link>

        <nav aria-label="Navigasi utama" className="side-nav">
          <p className="nav-caption">DAFTAR MENU</p>
          {navigation.map((item) => (
            <Link
              aria-current={activePath(pathname, item.href) ? "page" : undefined}
              className={`nav-item${activePath(pathname, item.href) ? " nav-item-active" : ""}`}
              href={item.href}
              key={item.href}
              onClick={() => setSidebarOpen(false)}
            >
              <span aria-hidden="true" className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <aside className="sidebar-tip">
          <span aria-hidden="true">✦</span>
          <strong>Tips pencarian</strong>
          <p>Cari lowongan berdasarkan judul pekerjaan dan gunakan tautan JobStreet dengan filter yang sesuai.</p>
        </aside>

        <div className="sidebar-account">
          <span>{userName ? `Masuk sebagai ${userName}` : "Sesi pengguna"}</span>
          <button className="sidebar-logout" disabled={logoutLoading} onClick={logout} type="button">
            {logoutLoading ? "Keluar..." : "Keluar"}
          </button>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? "Tutup menu" : "Buka menu"}
            className="menu-toggle"
            onClick={() => setSidebarOpen((open) => !open)}
            type="button"
          >
            ☰
          </button>
          <div aria-label={`Workspace, ${currentPage.label}`} className="breadcrumb">
            <span>Workspace</span>
            <b>/</b>
            <strong>{currentPage.label}</strong>
          </div>
          <form action="/jobs" className="global-search" role="search">
            <span aria-hidden="true">⌕</span>
            <input aria-label="Cari lowongan" name="q" placeholder="Cari berdasarkan judul pekerjaan..." />
            <button aria-label="Cari" type="submit">↵</button>
          </form>
          <div className="topbar-status"><span />Data tersimpan</div>
        </header>
        <SessionStateProvider key={sessionGeneration}>
          {children}
        </SessionStateProvider>
        <footer className="page-footer">
          Lowongan dari JobStreet · Penyimpanan terkelola pribadi
        </footer>
      </div>
    </div>
  );
}
