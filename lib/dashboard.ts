import "server-only";
import { db } from "./supabase";
import { getRecentJobStats } from "./jobs";

export async function getDashboardStats() {
  const supabase = db();
  const [jobStats, sources] = await Promise.all([
    getRecentJobStats(),
    supabase.from("sources").select("url", { count: "exact", head: true }).ilike("url", "%jobstreet.%"),
  ]);
  if (sources.error) {
    console.error("[dashboard] Gagal memuat ringkasan:", sources.error.message);
    throw new Error(`Gagal memuat ringkasan: ${sources.error.message}`);
  }

  return {
    ...jobStats,
    sources: sources.count ?? 0,
  };
}
