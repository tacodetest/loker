import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import type { AppUserId } from "./auth";
import { db } from "./supabase";
import type { ScrapedJob } from "./scrape";

function invalidateJobs() {
  revalidateTag("jobs", { expire: 0 });
  revalidatePath("/");
  revalidatePath("/jobs");
  revalidatePath("/job");
}

export async function saveJobs(rows: ScrapedJob[], sourceUrl: string, ownerId: AppUserId) {
  if (!rows.length) {
    throw new Error("Hasil kosong; data lowongan lama tidak diubah.");
  }

  const scrapedAt = new Date().toISOString();
  const jobs = rows.map((row) => ({
    ...row,
    source_url: sourceUrl,
    description: row.description?.slice(0, 2000) ?? null,
    scraped_at: scrapedAt,
  }));
  const { data, error } = await db().rpc("refresh_source_jobs", {
    p_owner_id: ownerId,
    p_source_url: sourceUrl,
    p_jobs: jobs,
  });
  if (error) {
    console.error("[scrape] Supabase batch upsert gagal:", error.message);
    throw new Error(`Gagal menyimpan lowongan: ${error.message}`);
  }

  console.info(`[scrape] ${data} lowongan disimpan untuk ${sourceUrl}`);
  invalidateJobs();
  return Number(data ?? 0);
}

export async function removeSource(sourceUrl: string, ownerId: AppUserId) {
  const { data, error } = await db().rpc("delete_jobs_by_source", {
    p_owner_id: ownerId,
    p_source_url: sourceUrl,
  });
  if (error) {
    console.error("[scrape] Penghapusan sumber gagal:", error.message);
    throw new Error(`Gagal menghapus data sumber: ${error.message}`);
  }

  invalidateJobs();
  return Number(data ?? 0);
}

export async function replaceSource(
  oldSourceUrl: string,
  newSourceUrl: string,
  rows: ScrapedJob[],
  ownerId: AppUserId,
) {
  if (!rows.length) {
    throw new Error("Hasil URL baru kosong; sumber lama tetap dipertahankan.");
  }

  await saveJobs(rows, newSourceUrl, ownerId);
  const deletedJobs = await removeSource(oldSourceUrl, ownerId);
  console.info(`[scrape] Sumber diganti; ${oldSourceUrl} -> ${newSourceUrl}`);
  return { deletedJobs };
}

export const saveScrapedJobs = saveJobs;
