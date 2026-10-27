"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const navigation = [
  { href: "/", label: "Ringkasan", icon: "⌂" },
  { href: "/jobs", label: "Semua lowongan", icon: "▤" },
  { href: "/sources", label: "Kelola tautan", icon: "↗" },
];

function activePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/jobs") return pathname === "/jobs" || pathname === "/job";
  return pathname.startsWith(href);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const currentPage = navigation.find(({ href }) => activePath(pathname, href)) ?? navigation[0];

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
        {children}
        <footer className="page-footer">
          Lowongan dari JobStreet · Penyimpanan terkelola pribadi
        </footer>
      </div>
    </div>
  );
}
