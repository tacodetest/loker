import "server-only";
import { db } from "./supabase";

export async function getDashboardStats() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const jakartaDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const todayStart = new Date(`${jakartaDate}T00:00:00+07:00`).toISOString();
  const tomorrowStart = new Date(Date.parse(todayStart) + 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const supabase = db();
  const [allJobs, datedJobs, recentJobs, sources] = await Promise.all([
    supabase.from("jobs").select("job_url", { count: "exact", head: true })
      .ilike("source_url", "%jobstreet.%").gte("posted_at", sevenDaysAgo).lte("posted_at", now),
    supabase.from("jobs").select("job_url", { count: "exact", head: true })
      .ilike("source_url", "%jobstreet.%").gte("posted_at", todayStart).lt("posted_at", tomorrowStart).lte("posted_at", now),
    supabase.from("jobs").select("job_url", { count: "exact", head: true })
      .ilike("source_url", "%jobstreet.%").gte("scraped_at", sevenDaysAgo).gte("posted_at", sevenDaysAgo).lte("posted_at", now),
    supabase.from("sources").select("url", { count: "exact", head: true }).ilike("url", "%jobstreet.%"),
  ]);
  for (const result of [allJobs, datedJobs, recentJobs, sources]) {
    if (result.error) {
      console.error("[dashboard] Gagal memuat ringkasan:", result.error.message);
      throw new Error(`Gagal memuat ringkasan: ${result.error.message}`);
    }
  }

  return {
    totalJobs: allJobs.count ?? 0,
    datedJobs: datedJobs.count ?? 0,
    recentJobs: recentJobs.count ?? 0,
    sources: sources.count ?? 0,
  };
}
