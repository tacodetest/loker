import "server-only";
import type { AppUserId } from "./auth";
import { db } from "./supabase";
import { getRecentJobStats } from "./jobs";

export async function getDashboardStats(ownerId: AppUserId) {
  const supabase = db();
  const [jobStats, sources] = await Promise.all([
    getRecentJobStats(ownerId),
    supabase.from("saved_links").select("url", { count: "exact", head: true })
      .eq("owner_id", ownerId).eq("source", "glints").eq("is_active", true),
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
