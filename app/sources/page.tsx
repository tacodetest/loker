import AdminScrapePanel from "@/components/AdminScrapePanel";

export const instant = false;
import { getSavedSources } from "@/lib/sources";
import { requireCurrentUser } from "@/lib/auth";

export default async function SourcesPage() {
  const user = await requireCurrentUser();
  const sources = await getSavedSources(user.id);
  return (
    <main className="main-content">
      <header className="page-title-row">
        <div>
          <p className="eyebrow">PENGELOLAAN SUMBER</p>
          <h1>Kelola tautan</h1>
          <p>Kelola URL Glints dan pantau status scrape otomatis. Tautan JobStreet lama tetap dapat diganti atau dihapus, tetapi tidak diproses.</p>
        </div>
      </header>
      <AdminScrapePanel initialSources={sources} />
    </main>
  );
}
