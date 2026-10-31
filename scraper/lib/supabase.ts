import { createClient } from "@supabase/supabase-js";
import { DETAIL_PER_RUN, MAX_DETAIL_ATTEMPTS } from "../config";
import type { JobLinkCandidate, JobSource, LinkStatus, PendingJob, SavedLink } from "./types";
import { normalizeJobUrl } from "./utils";

const resilientFetch: typeof fetch = async (input, init) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 750 * 2 ** attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

export function scraperDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diatur.");
  return createClient(url, key, { auth: { persistSession: false }, global: { fetch: resilientFetch } });
}

export async function getSavedLinks(
  ownerId?: string,
  sourceUrl?: string,
): Promise<SavedLink[]> {
  let query = scraperDb().from("saved_links")
    .select("id, owner_id, url, source, is_active, last_status, last_scraped_at, last_error")
    .eq("is_active", true)
    .eq("source", "glints");
  if (ownerId) query = query.eq("owner_id", ownerId);
  if (sourceUrl) query = query.eq("url", sourceUrl);
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw new Error(`Gagal memuat tautan tersimpan: ${error.message}`);
  return (data ?? []) as SavedLink[];
}

export async function upsertJobLinks(link: SavedLink, candidates: JobLinkCandidate[]) {
  const jobs = candidates.map(({ job_link, posted_at_hint }) => {
    const canonicalUrl = normalizeJobUrl(job_link, link.url);
    if (!canonicalUrl) throw new Error(`URL lowongan tidak valid: ${job_link}`);
    return {
      owner_id: link.owner_id,
      link_id: link.id,
      source: link.source,
      job_url: canonicalUrl,
      job_link: canonicalUrl,
      source_url: link.url,
      site: link.source,
      title: "Pending details",
      job_title: null,
      posted_at_hint,
      detail_status: "pending",
      last_seen_at: new Date().toISOString(),
    };
  });
  if (!jobs.length) return 0;
  const supabase = scraperDb();
  const { error: sourceError } = await supabase.from("sources").upsert(
    { owner_id: link.owner_id, url: link.url },
    { onConflict: "owner_id,url", ignoreDuplicates: true },
  );
  if (sourceError) throw new Error(`Gagal menyiapkan sumber lama: ${sourceError.message}`);

  const { data, error } = await supabase.from("jobs")
    .upsert(jobs, { onConflict: "owner_id,job_url", ignoreDuplicates: true })
    .select("job_url");
  if (error) throw new Error(`Gagal menyimpan tautan lowongan dari ${link.url}: ${error.message}`);

  const { error: seenError } = await supabase.from("jobs")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("owner_id", link.owner_id)
    .in("job_url", jobs.map((job) => job.job_url));
  if (seenError) throw new Error(`Gagal memperbarui waktu terakhir terlihat: ${seenError.message}`);
  const { error: relationError } = await supabase.from("job_sources").upsert(
    jobs.map((job) => ({ owner_id: link.owner_id, source_url: link.url, job_url: job.job_url })),
    { onConflict: "owner_id,source_url,job_url", ignoreDuplicates: true },
  );
  if (relationError) throw new Error(`Gagal menghubungkan lowongan ke pencarian: ${relationError.message}`);
  return data?.length ?? jobs.length;
}

export async function getPendingJobs(links: SavedLink[]): Promise<PendingJob[]> {
  if (!links.length) return [];
  const jobs: PendingJob[] = [];
  for (const link of links) {
    const { data, error } = await scraperDb().from("jobs")
      .select("job_link, link_id, owner_id, source, detail_attempts, posted_at_hint")
      .eq("detail_status", "pending")
      .eq("link_id", link.id)
      .eq("source", "glints")
      .order("last_seen_at", { ascending: false })
      .limit(DETAIL_PER_RUN);
    if (error) throw new Error(`Gagal memuat detail untuk tautan ${link.id}: ${error.message}`);
    jobs.push(...(data ?? []) as PendingJob[]);
  }
  return jobs;
}

export async function setLinkStatus(
  link: SavedLink,
  status: LinkStatus,
  errorText: string | null,
  hasSuccessfulDetail: boolean,
) {
  const relationCount = await scraperDb().from("job_sources")
    .select("job_url", { count: "exact", head: true })
    .eq("owner_id", link.owner_id).eq("source_url", link.url);
  if (relationCount.error) throw new Error(`Gagal menghitung lowongan terhubung: ${relationCount.error.message}`);

  const now = new Date().toISOString();
  const updates: {
    last_scraped_at: string;
    last_status: LinkStatus;
    last_error: string | null;
    jobs_count: number;
    last_success_at?: string;
  } = {
    last_scraped_at: now,
    last_status: status,
    last_error: errorText,
    jobs_count: relationCount.count ?? 0,
  };
  if (status === "berhasil" || hasSuccessfulDetail) {
    updates.last_success_at = now;
  }
  const { error } = await scraperDb().from("saved_links").update(updates).eq("id", link.id);
  if (error) throw new Error(`Gagal memperbarui status tautan: ${error.message}`);
}

export async function updateJobDetails(
  job: PendingJob,
  fields: Record<string, unknown>,
) {
  const { error } = await scraperDb().from("jobs").update(fields)
    .eq("owner_id", job.owner_id)
    .eq("job_url", job.job_link);
  if (error) throw new Error(`Gagal menyimpan detail lowongan ${job.job_link}: ${error.message}`);
}

export async function markJobAttempt(
  job: PendingJob,
  attempts: number,
  errorText: string,
) {
  const { error } = await scraperDb().from("jobs").update({
    detail_attempts: attempts,
    detail_status: attempts >= MAX_DETAIL_ATTEMPTS ? "failed" : "pending",
    last_error: errorText.slice(0, 500),
  }).eq("owner_id", job.owner_id).eq("job_url", job.job_link);
  if (error) throw new Error(`Gagal mencatat percobaan detail: ${error.message}`);
}

export async function expireJob(job: PendingJob, errorText: string) {
  const { error } = await scraperDb().from("jobs").update({
    detail_status: "expired",
    last_error: errorText,
  }).eq("owner_id", job.owner_id).eq("job_url", job.job_link);
  if (error) throw new Error(`Gagal menandai lowongan kedaluwarsa: ${error.message}`);
}

export async function replaceSourceJobs(link: SavedLink, jobUrls: string[]) {
  const { error } = await scraperDb().rpc("replace_source_jobs", {
    p_owner_id: link.owner_id,
    p_source_url: link.url,
    p_job_urls: jobUrls,
  });
  if (error) throw new Error(`Gagal memperbarui lowongan usang dari ${link.url}: ${error.message}`);
}

export async function cleanupExpiredJobs(): Promise<number> {
  const { data, error } = await scraperDb().rpc("cleanup_expired_glints_jobs");
  if (error) throw new Error(`Gagal membersihkan lowongan kedaluwarsa/gagal: ${error.message}`);
  if (typeof data !== "number") {
    throw new Error("Hasil pembersihan lowongan tidak valid.");
  }
  return data;
}

export type { JobSource };
