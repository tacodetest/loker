import "server-only";
import { db } from "./supabase";
import { parsePostedTime } from "./posted";

export type JobCard = {
  job_url: string;
  title: string;
  company: string | null;
  location: string | null;
  salary: string | null;
  posted_time: string | null;
  source_url: string | null;
  scraped_at: string;
};

type JobDetail = JobCard & { description: string | null };

export const JOBS_PAGE_SIZE = 25;
const MAX_POST_AGE_DAYS = 7;
const QUERY_BATCH_SIZE = 1000;

export type JobsPeriod = "today" | "all";

type JobsPageFilters = {
  search?: string;
  period?: JobsPeriod;
  page?: number;
};

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

function normalizePage(page?: number) {
  if (page === undefined || !Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.trunc(page), 100_000);
}

function getPostedDate(job: Pick<JobCard, "posted_time" | "scraped_at">) {
  return parsePostedTime(job.posted_time, job.scraped_at);
}

function isRecentJob(job: JobCard, cutoff: Date, now: Date) {
  const postedDate = getPostedDate(job);
  const dateToCheck = postedDate ?? new Date(job.scraped_at);
  return !Number.isNaN(dateToCheck.getTime()) &&
    dateToCheck >= cutoff &&
    dateToCheck <= now;
}

function matchesPeriod(job: JobCard, period: JobsPeriod, cutoff: Date, now: Date) {
  const postedDate = getPostedDate(job);
  if (postedDate) return postedDate >= cutoff && postedDate <= now;
  return period === "all" && isRecentJob(job, cutoff, now);
}

async function getRecentlyScrapedJobs(): Promise<JobCard[]> {
  const { data: sources, error: sourcesError } = await db()
    .from("sources")
    .select("url")
    .ilike("url", "%jobstreet.%");
  if (sourcesError) {
    console.error("[jobs] Gagal memuat sumber lowongan:", sourcesError.message);
    throw new Error(`Gagal memuat sumber lowongan: ${sourcesError.message}`);
  }

  const sourceUrls = (sources ?? []).map((source) => source.url);
  if (sourceUrls.length === 0) return [];

  const cutoff = new Date(Date.now() - MAX_POST_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const jobs: JobCard[] = [];

  for (let offset = 0; ; offset += QUERY_BATCH_SIZE) {
    const { data, error } = await db()
      .from("jobs")
      .select("job_url, title, company, location, salary, posted_time, source_url, scraped_at")
      .in("source_url", sourceUrls)
      .gte("scraped_at", cutoff)
      .order("scraped_at", { ascending: false })
      .order("job_url", { ascending: true })
      .range(offset, offset + QUERY_BATCH_SIZE - 1);
    if (error) {
      console.error("[jobs] Gagal memuat lowongan:", error.message);
      throw new Error(`Gagal memuat lowongan: ${error.message}`);
    }

    const batch = (data ?? []) as JobCard[];
    jobs.push(...batch);
    if (batch.length < QUERY_BATCH_SIZE) return jobs;
  }
}

export async function getJobsPage(filters: JobsPageFilters) {
  const now = new Date();
  const cutoff = filters.period === "today"
    ? getJakartaDayStart(now)
    : new Date(now.getTime() - MAX_POST_AGE_DAYS * 24 * 60 * 60 * 1000);
  const search = filters.search?.trim().toLocaleLowerCase("id-ID");
  const allJobs = await getRecentlyScrapedJobs();
  const matchingJobs = allJobs
    .filter((job) =>
      matchesPeriod(job, filters.period === "today" ? "today" : "all", cutoff, now) &&
      (!search || job.title.toLocaleLowerCase("id-ID").includes(search)),
    )
    .sort((a, b) => {
      const aPostedDate = getPostedDate(a);
      const bPostedDate = getPostedDate(b);
      if (aPostedDate && !bPostedDate) return -1;
      if (!aPostedDate && bPostedDate) return 1;
      if (aPostedDate && bPostedDate) {
        const byPostedDate = bPostedDate.getTime() - aPostedDate.getTime();
        if (byPostedDate !== 0) return byPostedDate;
      }

      const byScrapedDate = Date.parse(b.scraped_at) - Date.parse(a.scraped_at);
      return byScrapedDate || a.job_url.localeCompare(b.job_url);
    });

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

export async function getJobDetail(jobUrl: string) {
  const { data, error } = await db()
    .from("jobs")
    .select("job_url, title, company, location, salary, description, posted_time, source_url, scraped_at")
    .eq("job_url", jobUrl)
    .ilike("source_url", "%jobstreet.%")
    .maybeSingle();
  if (error) {
    console.error("[jobs] Gagal memuat detail lowongan:", error.message);
    throw new Error(`Gagal memuat detail lowongan: ${error.message}`);
  }

  const job = data as JobDetail | null;
  if (!job || !isRecentJob(
    job,
    new Date(Date.now() - MAX_POST_AGE_DAYS * 24 * 60 * 60 * 1000),
    new Date(),
  )) return null;
  return job;
}

export async function getRecentJobStats() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - MAX_POST_AGE_DAYS * 24 * 60 * 60 * 1000);
  const todayStart = getJakartaDayStart(now);
  const jobs = await getRecentlyScrapedJobs();
  const recentJobs = jobs.filter((job) => isRecentJob(job, cutoff, now));

  return {
    totalJobs: recentJobs.length,
    datedJobs: recentJobs.filter((job) => {
      const postedDate = getPostedDate(job);
      return postedDate !== null && postedDate >= todayStart && postedDate <= now;
    }).length,
    recentJobs: recentJobs.length,
  };
}
