import AdminScrapePanel from "@/components/AdminScrapePanel";
import { getSavedSources } from "@/lib/sources";

export default async function SourcesPage() {
  const sources = await getSavedSources();
  return (
    <main className="main-content">
      <header className="page-title-row">
        <div>
          <p className="eyebrow">PENGELOLAAN SUMBER</p>
          <h1>Kelola tautan</h1>
          <p>Tambahkan URL pencarian, perbarui lowongan, atau hapus sumber tersimpan.</p>
        </div>
      </header>
      <AdminScrapePanel initialSources={sources} />
    </main>
  );
}
