import "server-only";
import { connection } from "next/server";
import type { AppUserId } from "./auth";
import { db } from "./supabase";

export type JobCard = {
  job_url: string;
  title: string;
  company: string | null;
  location: string | null;
  salary: string | null;
  posted_time: string | null;
  posted_at: string | null;
  posted_at_source: "exact" | "estimated" | "unknown";
  source_url: string | null;
  site: string | null;
  scraped_at: string;
  first_seen_at: string;
};

type JobDetail = JobCard & { description: string | null; employment_type: string | null };
export type JobForMatching = JobDetail;

export const JOBS_PAGE_SIZE = 25;
const MAX_POST_AGE_DAYS = 7;
const QUERY_BATCH_SIZE = 100;

export type JobsPeriod = "today" | "all";
export type JobsSite = "all" | "jobstreet" | "glints";

type JobsPageFilters = {
  search?: string;
  period?: JobsPeriod;
  site?: JobsSite;
  page?: number;
};

async function getLinkedJobUrls(ownerId: AppUserId) {
  const { data: savedLinks, error: savedError } = await db().from("saved_links")
    .select("url").eq("owner_id", ownerId).eq("is_active", true);
  if (savedError) throw new Error(`Gagal memuat tautan lowongan: ${savedError.message}`);
  const sourceUrls = (savedLinks ?? []).map(({ url }) => url);
  if (!sourceUrls.length) return [];

  const jobUrls = new Set<string>();
  for (let sourceOffset = 0; sourceOffset < sourceUrls.length; sourceOffset += QUERY_BATCH_SIZE) {
    const urlBatch = sourceUrls.slice(sourceOffset, sourceOffset + QUERY_BATCH_SIZE);
    for (let offset = 0; ; offset += QUERY_BATCH_SIZE) {
      const { data, error } = await db().from("job_sources")
        .select("job_url")
        .eq("owner_id", ownerId)
        .in("source_url", urlBatch)
        .range(offset, offset + QUERY_BATCH_SIZE - 1);
      if (error) throw new Error(`Gagal memuat hubungan lowongan: ${error.message}`);
      for (const row of data ?? []) jobUrls.add(row.job_url);
      if (!data || data.length < QUERY_BATCH_SIZE) break;
    }
  }
  return [...jobUrls];
}

async function getRecentlyScrapedJobs(ownerId: AppUserId): Promise<JobForMatching[]> {
  await connection();
  const jobUrls = await getLinkedJobUrls(ownerId);
  if (!jobUrls.length) return [];
  const jobs: JobForMatching[] = [];

  for (let jobOffset = 0; ; jobOffset += QUERY_BATCH_SIZE) {
    const { data, error } = await db().from("jobs")
      .select("job_url,title,company,location,salary,posted_time,source_url,site,scraped_at,first_seen_at,description,job_description,employment_type")
      .eq("owner_id", ownerId)
      .eq("detail_status", "ok")
      .range(jobOffset, jobOffset + QUERY_BATCH_SIZE - 1)
      .overrideTypes<Array<Record<string, unknown>>, { merge: false }>();
    if (error) throw new Error(`Gagal memuat lowongan: ${error.message}`);
    if (!data?.length) break;
    for (const row of data) {
      if (!jobUrls.includes(String(row.job_url))) continue;
      const firstSeenAt = typeof row.first_seen_at === "string" ? row.first_seen_at : new Date(0).toISOString();
      const postedTime = typeof row.posted_time === "string" ? row.posted_time : null;
      const postedAt = postedTime && !Number.isNaN(Date.parse(postedTime)) ? postedTime : null;
      const scrapedAt = typeof row.scraped_at === "string" ? row.scraped_at : firstSeenAt;
      jobs.push({
        job_url: String(row.job_url),
        title: String(row.title ?? ""),
        company: typeof row.company === "string" ? row.company : null,
        location: typeof row.location === "string" ? row.location : null,
        salary: typeof row.salary === "string" ? row.salary : null,
        posted_time: postedTime,
        posted_at: postedAt,
        posted_at_source: "unknown",
        source_url: typeof row.source_url === "string" ? row.source_url : null,
        site: typeof row.site === "string" ? row.site : null,
        scraped_at: scrapedAt,
        first_seen_at: firstSeenAt,
        description: typeof row.job_description === "string"
          ? row.job_description
          : typeof row.description === "string" ? row.description : null,
        employment_type: typeof row.employment_type === "string" ? row.employment_type : null,
      });
    }
    if (data.length < QUERY_BATCH_SIZE) break;
  }
  return jobs;
}

function normalizePage(page?: number) {
  if (page === undefined || !Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.trunc(page), 100_000);
}

function getPostedDate(job: Pick<JobCard, "posted_at" | "posted_time">) {
  const value = job.posted_at ?? job.posted_time;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isRecentJob(job: JobCard, cutoff: Date, now: Date) {
  const postedDate = getPostedDate(job);
  if (!postedDate) return true;
  return postedDate >= cutoff && postedDate <= now;
}

function matchesPeriod(job: JobCard, period: JobsPeriod, cutoff: Date, now: Date) {
  const postedDate = getPostedDate(job);
  if (!postedDate) return period === "all";
  return postedDate >= cutoff && postedDate <= now;
}

function sortNewestFirst(a: JobCard, b: JobCard) {
  const aTime = getPostedDate(a)?.getTime() ?? Date.parse(a.first_seen_at);
  const bTime = getPostedDate(b)?.getTime() ?? Date.parse(b.first_seen_at);
  return bTime - aTime || a.job_url.localeCompare(b.job_url);
}

function getJakartaDayStart(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return new Date(Date.UTC(year, month - 1, day) - 7 * 60 * 60 * 1000);
}

export async function getJobsPage(filters: JobsPageFilters, ownerId: AppUserId) {
  const now = new Date();
  const cutoff = filters.period === "today"
    ? getJakartaDayStart(now)
    : new Date(now.getTime() - MAX_POST_AGE_DAYS * 86_400_000);
  const search = filters.search?.trim().toLocaleLowerCase("id-ID");
  const allJobs = await getRecentlyScrapedJobs(ownerId);
  const matchingJobs = allJobs
    .filter((job) =>
      matchesPeriod(job, filters.period === "today" ? "today" : "all", cutoff, now) &&
      (filters.site === undefined || filters.site === "all" || job.site?.toLocaleLowerCase("id-ID") === filters.site) &&
      (!search || job.title.toLocaleLowerCase("id-ID").includes(search)),
    )
    .sort(sortNewestFirst);

  const totalJobs = matchingJobs.length;
  const totalPages = Math.ceil(totalJobs / JOBS_PAGE_SIZE);
  const currentPage = totalPages > 0
    ? Math.min(normalizePage(filters.page), totalPages)
    : 1;
  const start = (currentPage - 1) * JOBS_PAGE_SIZE;

  return {
    jobs: matchingJobs.slice(start, start + JOBS_PAGE_SIZE),
    totalJobs,
    currentPage,
    totalPages,
  };
}

export async function getJobDetail(jobUrl: string, ownerId: AppUserId) {
  const linkedUrls = await getLinkedJobUrls(ownerId);
  if (!linkedUrls.includes(jobUrl)) return null;
  const { data, error } = await db().from("jobs")
    .select("job_url,title,company,location,salary,posted_time,source_url,site,scraped_at,first_seen_at,description,job_description,employment_type")
    .eq("owner_id", ownerId)
    .eq("job_url", jobUrl)
    .eq("detail_status", "ok")
    .maybeSingle();
  if (error) throw new Error(`Gagal memuat detail lowongan: ${error.message}`);
  if (!data) return null;

  const postedTime = data.posted_time;
  const postedAt = postedTime && !Number.isNaN(Date.parse(postedTime)) ? postedTime : null;
  const job = {
    job_url: data.job_url,
    title: data.title,
    company: data.company,
    location: data.location,
    salary: data.salary,
    posted_time: postedTime,
    posted_at: postedAt,
    posted_at_source: "unknown",
    source_url: data.source_url,
    site: data.site,
    scraped_at: data.scraped_at ?? data.first_seen_at,
    first_seen_at: data.first_seen_at,
    description: data.job_description ?? data.description,
    employment_type: data.employment_type,
  } satisfies JobDetail;
  return isRecentJob(job, new Date(Date.now() - MAX_POST_AGE_DAYS * 86_400_000), new Date())
    ? job
    : null;
}

export async function getRecentJobsForMatching(ownerId: AppUserId) {
  const jobs = await getRecentlyScrapedJobs(ownerId);
  const now = new Date();
  const cutoff = new Date(now.getTime() - MAX_POST_AGE_DAYS * 86_400_000);
  return jobs.filter((job) => isRecentJob(job, cutoff, now));
}

export async function getRecentJobStats(ownerId: AppUserId) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - MAX_POST_AGE_DAYS * 86_400_000);
  const todayStart = getJakartaDayStart(now);
  const jobs = await getRecentlyScrapedJobs(ownerId);
  const recentJobs = jobs.filter((job) => isRecentJob(job, cutoff, now));
  const { count: pendingJobs = 0, error: pendingError } = await db().from("jobs")
    .select("job_url", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("detail_status", "pending");
  if (pendingError) throw new Error(`Gagal memuat jumlah lowongan yang menunggu detail: ${pendingError.message}`);

  return {
    totalJobs: recentJobs.length,
    datedJobs: recentJobs.filter((job) => {
      const postedDate = getPostedDate(job);
      return postedDate !== null && postedDate >= todayStart && postedDate <= now;
    }).length,
    recentJobs: recentJobs.length,
    pendingJobs,
  };
}
