import "server-only";
import type { AppUserId } from "./auth";
import type { FirecrawlBatchStatus } from "./firecrawl";
import { getAllowedSourceUrl, parseJobs } from "./scrape";
import { replaceSource, saveJobs } from "./scrape-store";
import { db } from "./supabase";

type ScrapeBatch = {
  id: string;
  requested_urls: string[];
  replacements: { from: string; to: string }[];
};

export type SourceOutcome = {
  url: string;
  status: "done" | "failed";
  count: number;
  error?: string;
};

export function normalizedScrapeUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Terjadi kesalahan yang tidak diketahui.";
}

export async function finishScrapeBatch(
  batch: ScrapeBatch,
  ownerId: AppUserId,
  progress: FirecrawlBatchStatus,
) {
  if (progress.status === "scraping") {
    throw new Error("Batch Firecrawl belum selesai.");
  }

  const jobsBySource = new Map(
    Object.entries(progress.jobsBySource).map(([url, jobs]) => [normalizedScrapeUrl(url), jobs]),
  );
  const errorsBySource = new Map(
    Object.entries(progress.errorsBySource).map(([url, message]) => [normalizedScrapeUrl(url), message]),
  );
  const replacements = new Map(batch.replacements.map((replacement) => [replacement.to, replacement.from]));
  const sourceResults = await Promise.all(batch.requested_urls.map(async (sourceUrl): Promise<SourceOutcome> => {
    const extracted = jobsBySource.get(normalizedScrapeUrl(sourceUrl)) ?? [];
    if (!extracted.length) {
      return {
        url: sourceUrl,
        status: "failed",
        count: 0,
        error: errorsBySource.get(normalizedScrapeUrl(sourceUrl)) ?? "Tidak ada lowongan valid dari Firecrawl.",
      };
    }

    try {
      const validatedSourceUrl = getAllowedSourceUrl(sourceUrl);
      if (!validatedSourceUrl) throw new Error("URL sumber bukan domain JobStreet yang diizinkan.");
      const rows = parseJobs({ jobs: extracted }, validatedSourceUrl.toString());
      const oldSourceUrl = replacements.get(sourceUrl);
      if (oldSourceUrl) await replaceSource(oldSourceUrl, sourceUrl, rows, ownerId);
      else await saveJobs(rows, sourceUrl, ownerId);
      return { url: sourceUrl, status: "done", count: rows.length };
    } catch (error) {
      console.error(`[scrape] Gagal menyimpan hasil untuk ${sourceUrl}:`, errorMessage(error));
      return { url: sourceUrl, status: "failed", count: 0, error: errorMessage(error) };
    }
  }));

  const status = sourceResults.some((result) => result.status === "done") ? "done" : "failed";
  const { error } = await db().from("scrape_batches")
    .update({
      status,
      total: batch.requested_urls.length,
      completed: sourceResults.length,
      outcome: { sources: sourceResults },
      updated_at: new Date().toISOString(),
    })
    .eq("id", batch.id)
    .eq("owner_id", ownerId);
  if (error) throw new Error(`Gagal memperbarui status batch: ${error.message}`);

  return { status, sources: sourceResults };
}
