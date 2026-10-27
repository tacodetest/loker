import "server-only";
import { db } from "./supabase";

export type JobCard = {
  job_url: string;
  title: string;
  company: string | null;
  location: string | null;
  salary: string | null;
  posted_text: string | null;
  posted_at: string | null;
  source_url: string | null;
  scraped_at: string;
};

export const JOBS_PAGE_SIZE = 25;
const MAX_POST_AGE_DAYS = 7;

type JobsPageFilters = {
  search?: string;
  days?: number;
  page?: number;
};

function normalizeDays(days?: number) {
  if (days === undefined || !Number.isFinite(days) || days < 1) return MAX_POST_AGE_DAYS;
  return Math.min(Math.max(Math.trunc(days), 1), MAX_POST_AGE_DAYS);
}

function normalizePage(page?: number) {
  if (page === undefined || !Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.trunc(page), 100_000);
}

async function queryJobsPage(filters: JobsPageFilters & { days: number; page: number }) {
  const start = (filters.page - 1) * JOBS_PAGE_SIZE;
  const end = start + JOBS_PAGE_SIZE - 1;
  const now = new Date();
  const cutoff = new Date(now.getTime() - filters.days * 24 * 60 * 60 * 1000).toISOString();
  let query = db()
    .from("jobs")
    .select("job_url, title, company, location, salary, posted_text, posted_at, source_url, scraped_at", { count: "exact" })
    .or("site.ilike.%jobstreet.%,and(site.is.null,source_url.ilike.%jobstreet.%)")
    .gte("posted_at", cutoff)
    .lte("posted_at", now.toISOString())
    .order("posted_at", { ascending: false, nullsFirst: false })
    .order("job_url", { ascending: true })
    .range(start, end);

  const search = filters.search?.trim();
  if (search) query = query.ilike("title", `%${search}%`);

  const { data, error, count } = await query;
  if (error) {
    console.error("[jobs] Gagal memuat halaman lowongan:", error.message);
    throw new Error(`Gagal memuat lowongan: ${error.message}`);
  }

  return {
    jobs: (data ?? []) as JobCard[],
    totalJobs: count ?? 0,
  };
}

function isWithinDays(postedAt: string | null, days: number) {
  if (!postedAt) return false;
  const timestamp = Date.parse(postedAt);
  const now = Date.now();
  return Number.isFinite(timestamp) &&
    timestamp >= now - days * 24 * 60 * 60 * 1000 &&
    timestamp <= now;
}

export async function getJobsPage(filters: JobsPageFilters) {
  const days = normalizeDays(filters.days);
  const requestedPage = normalizePage(filters.page);
  const result = await queryJobsPage({ ...filters, days, page: requestedPage });
  const totalPages = Math.ceil(result.totalJobs / JOBS_PAGE_SIZE);
  const currentPage = totalPages > 0 ? Math.min(requestedPage, totalPages) : 1;
  const pageResult = currentPage === requestedPage
    ? result
    : await queryJobsPage({ ...filters, days, page: currentPage });

  return {
    ...pageResult,
    currentPage,
    totalPages,
  };
}

async function getCachedJobDetail(jobUrl: string) {
  const { data, error } = await db()
    .from("jobs")
    .select("job_url, title, company, location, salary, description, posted_text, posted_at, source_url, scraped_at")
    .eq("job_url", jobUrl)
    .ilike("source_url", "%jobstreet.%")
    .gte("posted_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .maybeSingle();
  if (error) {
    console.error("[jobs] Gagal memuat detail lowongan:", error.message);
    throw new Error(`Gagal memuat detail lowongan: ${error.message}`);
  }
  return data;
}

export async function getJobDetail(jobUrl: string) {
  const job = await getCachedJobDetail(jobUrl);
  if (!job || !isWithinDays(job.posted_at, MAX_POST_AGE_DAYS)) return null;
  return job;
}
