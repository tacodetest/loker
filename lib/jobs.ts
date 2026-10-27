import "server-only";
import { z } from "zod";
import { db } from "./supabase";

const cursorSchema = z.object({
  posted_at: z.string().datetime({ offset: true }).nullable(),
  job_url: z.string().url(),
});

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

const PAGE_SIZE = 25;
const MAX_POST_AGE_DAYS = 7;

function decodeCursor(cursor?: string) {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return cursorSchema.parse(parsed);
  } catch {
    return null;
  }
}

function encodeCursor(row: JobCard) {
  return Buffer.from(
    JSON.stringify({ posted_at: row.posted_at, job_url: row.job_url }),
  ).toString("base64url");
}

type JobsPageFilters = {
  search?: string;
  days?: number;
  cursor?: string;
};

type JobRow = JobCard & { has_more: boolean };

function normalizeDays(days?: number) {
  if (days === undefined || !Number.isFinite(days) || days < 1) return MAX_POST_AGE_DAYS;
  return Math.min(Math.max(Math.trunc(days), 1), MAX_POST_AGE_DAYS);
}

async function getCachedJobsPage(filters: JobsPageFilters & { days: number }): Promise<JobRow[]> {
  const cursor = decodeCursor(filters.cursor);
  if (filters.cursor && !cursor) throw new Error("Cursor halaman tidak valid.");

  const rpcFilters = {
    p_cursor_posted_at: cursor?.posted_at ?? null,
    p_cursor_job_url: cursor?.job_url ?? null,
    p_limit: PAGE_SIZE + 1,
    p_search: filters.search?.trim() || null,
    p_days: filters.days,
  };
  const { data, error } = await db().rpc("get_jobs_page", rpcFilters);
  if (error) {
    console.error("[jobs] Gagal memuat halaman lowongan:", error.message);
    throw new Error(`Gagal memuat lowongan: ${error.message}`);
  }

  return (data ?? []) as JobRow[];
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
  const rows = await getCachedJobsPage({ ...filters, days });
  const freshRows = rows.filter((row) => isWithinDays(row.posted_at, days));
  const hasMore = freshRows.length > PAGE_SIZE;
  const jobs = freshRows.slice(0, PAGE_SIZE);
  const last = jobs.at(-1);
  return {
    jobs,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
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
