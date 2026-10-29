import { createClient } from "@supabase/supabase-js";
import { DETAIL_PER_RUN, MAX_DETAIL_ATTEMPTS } from "../config";
import type { JobLinkCandidate, JobSource, PendingJob, SavedLink } from "./types";
import { normalizeJobUrl, sourceFromUrl } from "./utils";

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
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  return createClient(url, key, { auth: { persistSession: false }, global: { fetch: resilientFetch } });
}

export async function getSavedLinks(ownerId?: string, sourceUrl?: string): Promise<SavedLink[]> {
  let query = scraperDb().from("saved_links")
    .select("id, owner_id, url, source, is_active")
    .eq("is_active", true);
  if (ownerId) query = query.eq("owner_id", ownerId);
  if (sourceUrl) query = query.eq("url", sourceUrl);
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load saved links: ${error.message}`);
  const links = (data ?? []) as SavedLink[];
  const invalid = links.find((link) => sourceFromUrl(link.url) !== link.source);
  if (invalid) throw new Error(`Saved link source does not match its URL: ${invalid.url}`);
  return links;
}

export async function upsertJobLinks(link: SavedLink, candidates: JobLinkCandidate[]) {
  const jobs = candidates.map(({ job_link, posted_at_hint }) => {
    const canonicalUrl = normalizeJobUrl(job_link, link.url);
    if (!canonicalUrl) throw new Error(`Invalid job URL: ${job_link}`);
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
  if (sourceError) throw new Error(`Could not prepare legacy source record: ${sourceError.message}`);

  const { data, error } = await supabase.from("jobs")
    .upsert(jobs, { onConflict: "owner_id,job_url", ignoreDuplicates: true })
    .select("job_url");
  if (error) throw new Error(`Could not save discovered links for ${link.url}: ${error.message}`);

  const { error: seenError } = await supabase.from("jobs")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("owner_id", link.owner_id)
    .in("job_url", jobs.map((job) => job.job_url));
  if (seenError) throw new Error(`Could not update last-seen timestamps: ${seenError.message}`);
  const { error: relationError } = await supabase.from("job_sources").upsert(
    jobs.map((job) => ({ owner_id: link.owner_id, source_url: link.url, job_url: job.job_url })),
    { onConflict: "owner_id,source_url,job_url", ignoreDuplicates: true },
  );
  if (relationError) throw new Error(`Could not link jobs to saved search: ${relationError.message}`);
  return data?.length ?? jobs.length;
}

export async function getPendingJobs(linkIds: string[]): Promise<PendingJob[]> {
  if (!linkIds.length) return [];
  const { data, error } = await scraperDb().from("jobs")
    .select("job_link, link_id, owner_id, source, detail_attempts, posted_at_hint")
    .eq("detail_status", "pending")
    .not("link_id", "is", null)
    .in("link_id", linkIds)
    .in("source", ["jobstreet", "glints"])
    .order("last_seen_at", { ascending: false })
    .limit(DETAIL_PER_RUN);
  if (error) throw new Error(`Could not load pending details: ${error.message}`);
  return (data ?? []) as PendingJob[];
}

export async function setLinkStatus(link: SavedLink, status: string, errorText: string | null) {
  const relationCount = await scraperDb().from("job_sources")
    .select("job_url", { count: "exact", head: true })
    .eq("owner_id", link.owner_id).eq("source_url", link.url);
  if (relationCount.error) throw new Error(`Could not count linked jobs: ${relationCount.error.message}`);

  const now = new Date().toISOString();
  const { error } = await scraperDb().from("saved_links").update({
    last_scraped_at: now,
    last_status: status,
    last_error: errorText,
    jobs_count: relationCount.count ?? 0,
  }).eq("id", link.id);
  if (error) throw new Error(`Could not update saved link status: ${error.message}`);
}

export async function updateJobDetails(
  job: PendingJob,
  fields: Record<string, unknown>,
) {
  const { error } = await scraperDb().from("jobs").update(fields)
    .eq("owner_id", job.owner_id)
    .eq("job_url", job.job_link);
  if (error) throw new Error(`Could not save job details for ${job.job_link}: ${error.message}`);
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
  if (error) throw new Error(`Could not record failed detail attempt: ${error.message}`);
}

export async function expireJob(job: PendingJob, errorText: string) {
  const { error } = await scraperDb().from("jobs").update({
    detail_status: "expired",
    last_error: errorText,
  }).eq("owner_id", job.owner_id).eq("job_url", job.job_link);
  if (error) throw new Error(`Could not expire job: ${error.message}`);
}

export async function replaceSourceJobs(link: SavedLink, jobUrls: string[]) {
  const { error } = await scraperDb().rpc("replace_source_jobs", {
    p_owner_id: link.owner_id,
    p_source_url: link.url,
    p_job_urls: jobUrls,
  });
  if (error) throw new Error(`Could not replace stale jobs for ${link.url}: ${error.message}`);
}

export type { JobSource };
