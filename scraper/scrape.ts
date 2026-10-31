import { CONCURRENCY } from "./config";
import { cleanupExpiredJobs, getSavedLinks, setLinkStatus } from "./lib/supabase";
import type { LinkStatus, SavedLink } from "./lib/types";
import {
  createRateLimitMessage,
  formatCooldownMessage,
  getSourceCooldownUntil,
  RateLimitedError,
} from "./lib/rate-limit";
import { scrapePendingDetails } from "./stage2-details";
import { collectJobLinks } from "./stage1-links";

type LinkSummary = {
  berhasil: number;
  gagal: number;
  errorPertama: string | null;
  dibatasi: boolean;
  retryAt: string | null;
};

function isBlocked(message: string) {
  return /(?:http 403|captcha|pemblokiran|diblokir|menolak akses)/i.test(message);
}

function statusFor(error: string | null, summary: LinkSummary): LinkStatus {
  if (summary.dibatasi) return "dibatasi";
  if (error && isBlocked(error)) return "diblokir";
  if (!error && summary.gagal === 0) return "berhasil";
  if (summary.berhasil > 0) return "sebagian";
  return "gagal";
}

function errorFor(summary: LinkSummary, stageError: string | null) {
  const firstError = stageError ?? summary.errorPertama;
  if (!firstError) return null;
  const processed = summary.berhasil + summary.gagal;
  if (processed > 0) return `${summary.berhasil}/${processed} detail berhasil. ${firstError}`;
  return firstError;
}

async function run() {
  const ownerId = process.env.SCRAPE_OWNER_ID || undefined;
  const sourceUrl = process.env.SCRAPE_SOURCE_URL || undefined;
  const cleanedCount = await cleanupExpiredJobs();
  console.info(`[scraper] Pembersihan Glints selesai: ${cleanedCount} lowongan lama dibersihkan.`);
  const links = await getSavedLinks(ownerId, sourceUrl);
  if (!links.length) {
    console.info("[scraper] Tidak ada tautan aktif untuk diperbarui.");
    return;
  }

  const now = new Date();
  const eligibleLinks: SavedLink[] = [];
  for (const link of links) {
    const cooldownUntil = getSourceCooldownUntil(link.last_status, link.last_scraped_at, link.last_error, now);
    if (cooldownUntil) {
      console.info(`[scraper] Tautan dilewati selama cooldown: ${link.url}. ${formatCooldownMessage(cooldownUntil)}`);
      continue;
    }
    eligibleLinks.push(link);
  }
  if (!eligibleLinks.length) {
    console.info("[scraper] Semua tautan yang dipilih masih dalam masa cooldown.");
    return;
  }

  const stageErrors = new Map<string, string>();
  const stageSucceeded: SavedLink[] = [];
  const limitedLinks = new Map<string, string>();
  let sourceRateLimit: RateLimitedError | null = null;
  for (let index = 0; index < eligibleLinks.length; index += CONCURRENCY) {
    const link = eligibleLinks[index];
    if (sourceRateLimit) {
      limitedLinks.set(
        link.id,
        createRateLimitMessage(sourceRateLimit.status, sourceRateLimit.retryAt),
      );
      console.info(`[scraper] Sumber ${link.source} dilewati setelah pembatasan pada run ini: ${link.url}.`);
      continue;
    }
    try {
      const count = await collectJobLinks(link);
      stageSucceeded.push(link);
      console.info(`[scraper] Tahap 1 selesai untuk ${link.url}: ${count} tautan lowongan.`);
    } catch (error) {
      if (error instanceof RateLimitedError) {
        sourceRateLimit = error;
        const message = createRateLimitMessage(error.status, error.retryAt);
        limitedLinks.set(link.id, message);
        console.warn(
          `[scraper] Tahap 1 Glints dihentikan di ${link.url} setelah ${error.collectedCount} tautan terkumpul. ${message}`,
        );
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      stageErrors.set(link.id, message);
      console.error(`[scraper] Tautan gagal ${link.url}: ${message}`);
    }
  }

  let detailSummaries: Awaited<ReturnType<typeof scrapePendingDetails>>;
  try {
    const detailLinks = sourceRateLimit ? [] : stageSucceeded;
    detailSummaries = await scrapePendingDetails(detailLinks);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[scraper] Tahap detail gagal dijalankan: ${message}`);
    detailSummaries = new Map(stageSucceeded.map(({ id }) => [id, {
      berhasil: 0,
      gagal: 1,
      errorPertama: message,
      dibatasi: false,
      retryAt: null,
    }]));
  }
  const detailRateLimit = [...detailSummaries.values()].find((summary) => summary.dibatasi);
  if (!sourceRateLimit && detailRateLimit) {
    for (const link of eligibleLinks) {
      const summary = detailSummaries.get(link.id);
      if (summary) {
        summary.dibatasi = true;
        summary.errorPertama ??= detailRateLimit.errorPertama;
        summary.retryAt ??= detailRateLimit.retryAt;
      }
    }
  }
  for (const link of eligibleLinks) {
    if (sourceRateLimit) {
      limitedLinks.set(
        link.id,
        createRateLimitMessage(sourceRateLimit.status, sourceRateLimit.retryAt),
      );
    }
  }
  const statusResults = await Promise.allSettled(eligibleLinks.map(async (link) => {
    const summary = detailSummaries.get(link.id) ?? {
      berhasil: 0, gagal: 0, errorPertama: null, dibatasi: false, retryAt: null,
    };
    const limitedError = limitedLinks.get(link.id);
    if (limitedError) {
      summary.dibatasi = true;
      summary.errorPertama = limitedError;
    }
    const stageError = stageErrors.get(link.id) ?? null;
    const error = errorFor(summary, stageError);
    const status = statusFor(error, summary);
    await setLinkStatus(link, status, error, summary.berhasil > 0);
    console.info(
      `[scraper] Status ${link.url}: ${status}; detail berhasil ${summary.berhasil}, gagal ${summary.gagal}.`,
    );
    return { status, error };
  }));
  const failedStatusUpdates = statusResults.filter((result) => result.status === "rejected");
  if (failedStatusUpdates.length) {
    for (const result of failedStatusUpdates) {
      if (result.status === "rejected") console.error(`[scraper] Status tautan gagal disimpan: ${String(result.reason)}`);
    }
    throw new Error("Gagal memperbarui status satu atau beberapa tautan.");
  }

  const resultRows = statusResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failedCount = resultRows.filter(({ status }) => status === "gagal" || status === "diblokir" || status === "sebagian").length;
  console.info(`[scraper] Selesai: ${eligibleLinks.length - failedCount}/${eligibleLinks.length} tautan tanpa kegagalan.`);
  if (failedCount > 0) {
    throw new Error(`${failedCount} dari ${eligibleLinks.length} tautan gagal atau hanya berhasil sebagian. Periksa status di menu Kelola Tautan.`);
  }
}

run().catch((error: unknown) => {
  console.error(`[scraper] Proses gagal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
