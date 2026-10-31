import { filterLinksBySource, parseScrapeSource } from "./lib/source-filter";
import { getJobStreetCooldownUntil } from "./lib/rate-limit";
import { scraperDb } from "./lib/supabase";
import type { SavedLink } from "./lib/types";

const DETAIL_STATUSES = ["pending", "ok", "failed", "expired"] as const;
const GLINTS_SUCCESS_MAX_AGE_MS = 14 * 60 * 60 * 1000;

async function main() {
  const ownerId = process.env.SCRAPE_OWNER_ID;
  const sourceUrl = process.env.SCRAPE_SOURCE_URL;
  const selection = parseScrapeSource(process.env.SCRAPE_SOURCE);
  const db = scraperDb();
  let query = db.from("saved_links")
    .select("id, owner_id, url, source, is_active, last_status, last_scraped_at, last_success_at, last_error")
    .eq("is_active", true);
  if (ownerId) query = query.eq("owner_id", ownerId);
  if (sourceUrl) query = query.eq("url", sourceUrl);
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw new Error(`Gagal membaca tautan aktif: ${error.message}`);

  const links = filterLinksBySource((data ?? []) as SavedLink[], selection);
  const failures: string[] = [];
  let successfulDetails = 0;
  if (!links.length) {
    console.info("[verifikasi] Tidak ada tautan aktif yang sesuai dengan filter sumber.");
    process.exitCode = 1;
    return;
  }

  for (const link of links) {
    const now = new Date();
    const lastSuccess = link.last_success_at ? new Date(link.last_success_at) : null;
    const successAgeHours = lastSuccess && !Number.isNaN(lastSuccess.getTime())
      ? Math.max(0, (now.getTime() - lastSuccess.getTime()) / 3_600_000)
      : null;
    console.info(`[verifikasi] Sumber: ${link.source}`);
    console.info(`[verifikasi] Status tautan: ${link.last_status ?? "belum pernah diproses"}`);
    console.info(`[verifikasi] Berhasil terakhir: ${link.last_success_at ?? "belum ada"}; umur jam: ${successAgeHours?.toFixed(2) ?? "tidak tersedia"}`);

    if (link.source === "glints" && (
      !lastSuccess
      || Number.isNaN(lastSuccess.getTime())
      || now.getTime() - lastSuccess.getTime() > GLINTS_SUCCESS_MAX_AGE_MS
    )) {
      failures.push("Tautan aktif Glints belum berhasil diperbarui dalam 14 jam terakhir.");
    }

    const counts = await Promise.all(DETAIL_STATUSES.map(async (status) => {
      const result = await db.from("jobs")
        .select("job_url", { count: "exact", head: true })
        .eq("owner_id", link.owner_id)
        .eq("source_url", link.url)
        .eq("detail_status", status);
      if (result.error) {
        throw new Error(`Gagal menghitung detail berstatus ${status}: ${result.error.message}`);
      }
      if (status === "ok") successfulDetails += result.count ?? 0;
      return [status, result.count ?? 0] as const;
    }));
    console.info(`[verifikasi] Jumlah detail: ${counts.map(([status, count]) => `${status}=${count}`).join(", ")}`);

    const { count: relationCount, error: relationError } = await db.from("job_sources")
      .select("job_url", { count: "exact", head: true })
      .eq("owner_id", link.owner_id)
      .eq("source_url", link.url);
    if (relationError) throw new Error(`Gagal menghitung job_sources: ${relationError.message}`);
    console.info(`[verifikasi] Jumlah job_sources: ${relationCount ?? 0}`);

    let emptyDescriptionCount = 0;
    let emptyOkDescriptionCount = 0;
    for (let offset = 0; ; offset += 1000) {
      const { data: descriptionRows, error: descriptionError } = await db.from("jobs")
        .select("detail_status, description, job_description")
        .eq("owner_id", link.owner_id)
        .eq("source_url", link.url)
        .order("job_url", { ascending: true })
        .range(offset, offset + 999);
      if (descriptionError) {
        throw new Error(`Gagal menghitung deskripsi kosong: ${descriptionError.message}`);
      }
      const rows = descriptionRows ?? [];
      for (const row of rows) {
        const description = row.job_description ?? row.description;
        if (typeof description !== "string" || !description.trim()) {
          emptyDescriptionCount += 1;
          if (row.detail_status === "ok") emptyOkDescriptionCount += 1;
        }
      }
      if (rows.length < 1000) break;
    }
    console.info(`[verifikasi] Jumlah job dengan description kosong: ${emptyDescriptionCount}`);
    if (emptyOkDescriptionCount > 0) {
      failures.push(`Ada ${emptyOkDescriptionCount} lowongan ok tanpa description.`);
    }

    const { data: examples, error: examplesError } = await db.from("jobs")
      .select("title, job_title, company, company_name, location, posted_time, description, job_description, detail_status")
      .eq("owner_id", link.owner_id)
      .eq("source_url", link.url)
      .order("scraped_at", { ascending: false })
      .limit(3);
    if (examplesError) throw new Error(`Gagal membaca contoh lowongan: ${examplesError.message}`);
    console.info("[verifikasi] Contoh lowongan:");
    for (const [index, job] of (examples ?? []).entries()) {
      const description = job.job_description ?? job.description;
      const title = job.job_title ?? job.title;
      console.info(JSON.stringify({
        nomor: index + 1,
        status: job.detail_status,
        judul: title,
        perusahaan: job.company_name ?? job.company,
        lokasi: job.location,
        posted_at: job.posted_time,
        panjangDeskripsi: description?.length ?? 0,
      }));
      if (job.detail_status === "ok" && (!title?.trim() || !description?.trim())) {
        failures.push("Ada lowongan ok tanpa judul atau deskripsi.");
      }
    }

    const cooldown = link.source === "jobstreet"
      ? getJobStreetCooldownUntil(link.last_status, link.last_scraped_at, link.last_error, now)
      : null;
    if (link.source === "jobstreet" && (link.last_status === "dibatasi" || link.last_status === "diblokir")) {
      console.info(`[verifikasi] JobStreet berstatus ${link.last_status}; ${link.last_error ?? "data lama dipertahankan."}`);
    } else if (cooldown) {
      console.info(`[verifikasi] JobStreet masih dalam cooldown sampai ${cooldown.toISOString()}.`);
    }
  }

  const hasExpectedSuccess = links.some((link) => (
    link.source === "jobstreet"
    && (link.last_status === "dibatasi" || link.last_status === "diblokir")
  ));
  if (successfulDetails === 0 && !hasExpectedSuccess) {
    failures.push("Tidak ada detail lowongan berstatus ok untuk sumber yang diverifikasi.");
  }
  if (failures.length) {
    for (const failure of new Set(failures)) console.error(`[verifikasi] GAGAL: ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.info(`[verifikasi] LULUS: ${successfulDetails} detail berstatus ok; tidak ditemukan masalah verifikasi.`);
}

main().catch((error: unknown) => {
  console.error(`[verifikasi] Gagal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
