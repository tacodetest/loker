import "server-only";
import { connection } from "next/server";
import type { AppUserId } from "./auth";
import { db } from "./supabase";

export type SavedSource = {
  id: string;
  url: string;
  source: "glints";
  is_active: boolean;
  last_scraped_at: string | null;
  last_success_at: string | null;
  last_status: string | null;
  last_error: string | null;
  job_count: number;
};

export async function getSavedSources(ownerId: AppUserId): Promise<SavedSource[]> {
  await connection();
  const supabase = db();
  const { data, error } = await supabase.from("saved_links")
    .select("id, url, source, is_active, last_scraped_at, last_success_at, last_status, last_error")
    .eq("owner_id", ownerId)
    .eq("source", "glints")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[sources] Gagal memuat tautan:", error.message);
    throw new Error(`Gagal memuat tautan: ${error.message}`);
  }

  const urls = (data ?? []).map((source) => source.url);
  const counts: Record<string, number> = {};
  for (let offset = 0; urls.length; offset += 1000) {
    const { data: links, error: linksError } = await supabase.from("job_sources")
      .select("source_url")
      .eq("owner_id", ownerId)
      .in("source_url", urls)
      .range(offset, offset + 999);
    if (linksError) {
      console.error("[sources] Gagal memuat hubungan lowongan:", linksError.message);
      throw new Error(`Gagal memuat hubungan lowongan: ${linksError.message}`);
    }
    for (const link of links ?? []) counts[link.source_url] = (counts[link.source_url] ?? 0) + 1;
    if (!links || links.length < 1000) break;
  }

  return (data ?? []).map((source) => ({
    ...source,
    job_count: counts[source.url] ?? 0,
  })) as SavedSource[];
}
