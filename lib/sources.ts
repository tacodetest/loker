import "server-only";
import { connection } from "next/server";
import type { AppUserId } from "./auth";
import { getAllowedSourceUrl } from "./scrape";
import { db } from "./supabase";

export type SavedSource = {
  url: string;
  last_scraped_at: string | null;
  auto_scrape_updated_at: string | null;
  auto_scrape_status: "running" | "success" | "failed" | null;
  auto_scrape_error: string | null;
  job_count: number;
};

export async function getSavedSources(ownerId: AppUserId): Promise<SavedSource[]> {
  await connection();
  const supabase = db();
  const { data, error } = await supabase
    .from("sources")
    .select("url, last_scraped_at, auto_scrape_updated_at, auto_scrape_status, auto_scrape_error")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[sources] Gagal memuat tautan:", error.message);
    throw new Error(`Gagal memuat tautan: ${error.message}`);
  }

  const jobstreetSources = (data ?? []).filter((source) => getAllowedSourceUrl(source.url));
  const sourceUrls = jobstreetSources.map((source) => source.url);
  const counts: Record<string, number> = {};
  const pageSize = 1000;
  for (let offset = 0; sourceUrls.length > 0; offset += pageSize) {
    const { data: links, error: linksError } = await supabase
      .from("job_sources")
      .select("source_url")
      .eq("owner_id", ownerId)
      .in("source_url", sourceUrls)
      .range(offset, offset + pageSize - 1);
    if (linksError) {
      console.error("[sources] Gagal memuat hubungan lowongan:", linksError.message);
      throw new Error(`Gagal memuat hubungan lowongan: ${linksError.message}`);
    }
    for (const link of links ?? []) counts[link.source_url] = (counts[link.source_url] ?? 0) + 1;
    if (!links || links.length < pageSize) break;
  }

  return jobstreetSources.map((source) => ({
    ...source,
    job_count: counts[source.url] ?? 0,
  }));
}
