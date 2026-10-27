import { db } from "./supabase";
import type { ScrapedJob } from "./scrape";

export async function saveScrapedJobs(rows: ScrapedJob[], sourceUrl: string) {
  if (!rows.length) {
    throw new Error("Hasil kosong; data lowongan lama tidak diubah.");
  }

  const supabase = db();
  console.info(`[scrape] Supabase refresh dimulai: ${rows.length} lowongan untuk ${sourceUrl}`);

  const { data, error } = await supabase.rpc("refresh_source_jobs", {
    p_source_url: sourceUrl,
    p_jobs: rows,
  });
  if (error) {
    console.error("[scrape] Supabase refresh gagal:", error.message);
    throw new Error(`Gagal memperbarui database (jalankan supabase.sql di Supabase SQL Editor): ${error.message}`);
  }
  console.info(`[scrape] Supabase refresh berhasil: ${data} lowongan diproses untuk ${sourceUrl}`);
}
