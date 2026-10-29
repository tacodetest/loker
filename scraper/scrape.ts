import { CONCURRENCY, DETAIL_PER_RUN } from "./config";
import { getSavedLinks, setLinkStatus } from "./lib/supabase";
import { scrapePendingDetails } from "./stage2-details";
import { collectJobLinks } from "./stage1-links";

async function run() {
  const ownerId = process.env.SCRAPE_OWNER_ID || undefined;
  const sourceUrl = process.env.SCRAPE_SOURCE_URL || undefined;
  const links = await getSavedLinks(ownerId, sourceUrl);
  if (!links.length) {
    console.info("[scraper] Tidak ada tautan aktif untuk diperbarui.");
    return;
  }

  const linkErrors = new Map<string, string>();
  for (let index = 0; index < links.length; index += CONCURRENCY) {
    const batch = links.slice(index, index + CONCURRENCY);
    await Promise.all(batch.map(async (link) => {
      try {
        const count = await collectJobLinks(link);
        console.info(`[scraper] Tahap 1 selesai untuk ${link.url}: ${count} tautan lowongan.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        linkErrors.set(link.id, message);
        console.error(`[scraper] Tautan gagal ${link.url}: ${message}`);
      }
    }));
  }

  const activeLinkIds = links.map((link) => link.id);
  const detailErrors = await scrapePendingDetails(activeLinkIds).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[scraper] Tahap 2 gagal: ${message}`);
    return new Map(activeLinkIds.map((id) => [id, message]));
  });
  for (const [linkId, message] of detailErrors) {
    if (!linkErrors.has(linkId)) linkErrors.set(linkId, message);
  }

  const statusResults = await Promise.allSettled(links.map((link) =>
    setLinkStatus(link, linkErrors.get(link.id) ?? "berhasil diperbarui",
      linkErrors.get(link.id) ?? null)));
  const failedStatusUpdates = statusResults.filter((result) => result.status === "rejected");
  if (failedStatusUpdates.length) {
    for (const result of failedStatusUpdates) {
      if (result.status === "rejected") console.error(`[scraper] Status tautan gagal disimpan: ${String(result.reason)}`);
    }
    throw new Error("Gagal memperbarui status satu atau beberapa tautan.");
  }

  const errorCount = links.filter((link) => linkErrors.has(link.id)).length;
  console.info(`[scraper] Selesai: ${links.length - errorCount}/${links.length} tautan berhasil. Maksimal ${DETAIL_PER_RUN} detail diproses.`);
  if (errorCount === links.length) {
    throw new Error(`Semua ${links.length} tautan gagal diproses.`);
  }
}

run().catch((error: unknown) => {
  console.error(`[scraper] Run gagal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
