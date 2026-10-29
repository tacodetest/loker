import { chromium, type Page } from "playwright";
import { DATE_RANGE_DAYS, DELAY_MAX_MS, DELAY_MIN_MS, DETAIL_PER_RUN, DESCRIPTION_MAX_CHARS, MAX_DETAIL_ATTEMPTS, PAGE_TIMEOUT_MS } from "./config";
import type { JobDetails, JobSource, PendingJob } from "./lib/types";
import { isBlockedPage, parseRelativeDate, sleepRandom } from "./lib/utils";
import {
  expireJob,
  getPendingJobs,
  markJobAttempt,
  updateJobDetails,
} from "./lib/supabase";
import * as glints from "./sources/glints";
import * as jobstreet from "./sources/jobstreet";

type SiteAdapter = typeof jobstreet | typeof glints;
const adapters: Record<JobSource, SiteAdapter> = { jobstreet, glints };

class BlockedPageError extends Error {}
class ConfigurationRequiredError extends Error {}

export async function scrapePendingDetails(linkIds: string[]) {
  const jobs = (await getPendingJobs(linkIds)).slice(0, DETAIL_PER_RUN);
  const errorsByLink = new Map<string, string>();
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "id-ID",
      timezoneId: "Asia/Jakarta",
      viewport: { width: 1440, height: 900 },
    });
    for (const [jobIndex, job] of jobs.entries()) {
      let blocked = false;
      let saved = false;
      let attemptsMade = 0;
      const remainingAttempts = MAX_DETAIL_ATTEMPTS - job.detail_attempts;
      for (let attempt = 0; attempt < remainingAttempts; attempt += 1) {
        try {
          const details = await loadDetails(page, job);
          if (!details) {
            saved = true;
            break;
          }
          await persistDetails(job, details);
          saved = true;
          console.info(`[scraper] Detail berhasil: ${job.job_link}`);
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (error instanceof ConfigurationRequiredError) {
            errorsByLink.set(job.link_id, message);
            console.error(`[scraper] Konfigurasi selector diperlukan untuk ${job.job_link}: ${message}`);
            break;
          }
          attemptsMade += 1;
          await markJobAttempt(job, job.detail_attempts + attemptsMade, message);
          errorsByLink.set(job.link_id, message);
          console.error(`[scraper] Detail gagal (${attempt + 1}/${remainingAttempts}): ${job.job_link}: ${message}`);
          if (error instanceof BlockedPageError) {
            blocked = true;
            break;
          }
          if (attempt + 1 < remainingAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
          }
        }
      }
      if (!saved && remainingAttempts === 0) {
        errorsByLink.set(job.link_id, "Batas percobaan detail sudah tercapai.");
      }
      if (blocked) {
        console.error("[scraper] Tahap detail dihentikan karena terdeteksi captcha/pemblokiran.");
        for (const pendingJob of jobs.slice(jobIndex + 1)) {
          errorsByLink.set(pendingJob.link_id, "Pemrosesan detail dihentikan setelah captcha atau pemblokiran.");
        }
        break;
      }
      await sleepRandom(DELAY_MIN_MS, DELAY_MAX_MS);
    }
  } finally {
    await browser.close();
  }
  return errorsByLink;
}

async function loadDetails(page: Page, job: PendingJob): Promise<JobDetails | null> {
  const response = await page.goto(job.job_link, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  if (!response || !response.ok()) throw new Error(`Gagal membuka detail (${response?.status() ?? "tanpa respons"}).`);
  await page.locator("body").waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
  const html = await page.content();
  if (isBlockedPage(html)) throw new BlockedPageError("Halaman mendeteksi captcha atau pemblokiran.");

  const adapter = adapters[job.source];
  const details: Partial<JobDetails> = adapter.extractDetailsFromJsonLd(html) ?? {};
  const config = job.source === "jobstreet" ? jobstreet.jobstreetConfig : glints.glintsConfig;
  const { details: selectorDetails, postedAtText } = await readConfirmedSelectors(
    page,
    config.detailSelectors,
    details,
  );
  const merged: JobDetails = {
    job_title: details.job_title ?? selectorDetails.job_title ?? "",
    company_name: details.company_name ?? selectorDetails.company_name ?? null,
    location: details.location ?? selectorDetails.location ?? null,
    salary: details.salary ?? selectorDetails.salary ?? null,
    employment_type: details.employment_type ?? selectorDetails.employment_type ?? null,
    posted_at: details.posted_at ?? null,
    posted_at_source: details.posted_at_source ?? "unknown",
    job_description: details.job_description ?? selectorDetails.job_description ?? null,
  };
  if (!merged.posted_at) {
    const stateDate = findStateDate(html, config.dateFields, config.updatedAtFields);
    if (stateDate) {
      merged.posted_at = stateDate.date;
      merged.posted_at_source = stateDate.source;
    }
  }
  if (!merged.posted_at) {
    const match = postedAtText?.match(config.relativeDatePattern);
    const relative = match ? parseRelativeDate(match[0]) : null;
    if (relative) {
      merged.posted_at = relative.toISOString();
      merged.posted_at_source = "estimated";
    }
  }
  if (!merged.job_title || !merged.job_description) {
    const missing = [
      !merged.job_title && "job title",
      !merged.job_description && "job description",
    ].filter(Boolean).join(" and ");
    throw new ConfigurationRequiredError(`Detail JSON-LD belum memuat ${missing}; lengkapi selector yang terkonfirmasi di scraper/sources/${job.source}.ts setelah memeriksa HTML debug.`);
  }
  merged.job_description = merged.job_description.slice(0, DESCRIPTION_MAX_CHARS);
  if (merged.posted_at && Date.parse(merged.posted_at) < Date.now() - DATE_RANGE_DAYS * 86_400_000) {
    await expireJob(job, "Tanggal posting sudah lebih dari 7 hari.");
    return null;
  }
  return merged;
}

async function persistDetails(job: PendingJob, details: JobDetails) {
  await updateJobDetails(job, {
    title: details.job_title,
    job_title: details.job_title,
    company: details.company_name,
    company_name: details.company_name,
    location: details.location,
    salary: details.salary,
    employment_type: details.employment_type,
    description: details.job_description,
    job_description: details.job_description,
    posted_time: details.posted_at,
    detail_status: "ok",
    detail_attempts: job.detail_attempts,
    last_error: null,
    scraped_at: new Date().toISOString(),
  });
}

async function readConfirmedSelectors(
  page: Page,
  selectors: Record<string, string>,
  jsonLdDetails: Partial<JobDetails>,
): Promise<{ details: Partial<JobDetails>; postedAtText: string | null }> {
  const requiredByJsonLd: Record<string, boolean> = {
    title: Boolean(jsonLdDetails.job_title),
    company: Boolean(jsonLdDetails.company_name),
    location: Boolean(jsonLdDetails.location),
    salary: Boolean(jsonLdDetails.salary),
    employmentType: Boolean(jsonLdDetails.employment_type),
    description: Boolean(jsonLdDetails.job_description),
  };
  const fields: Record<string, string | null> = {};
  const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  for (const [field, selector] of Object.entries(selectors)) {
    if (!selector || requiredByJsonLd[field]) continue;
    const locator = page.locator(selector).first();
    fields[field] = await locator.count() ? (await locator.innerText({ timeout: 5_000 }))?.trim() ?? null : null;
  }
  const salaryMatch = bodyText.match(/Rp\.?\s*[0-9][0-9.,]*(?:\s*[–-]\s*Rp\.?\s*[0-9][0-9.,]*)?(?:\s*(?:per\s*(?:month|bulan)|\/\s*(bulan|month)))?/i);
  const postedMatch = bodyText.match(/(?:Diposting|Terakhir diperbarui)[^\n]+/i);
  if (fields.salary && !/Rp\.?.*\d/i.test(fields.salary)) fields.salary = null;
  if (!fields.salary && salaryMatch) fields.salary = salaryMatch[0].replace(/\s+/g, " ").trim();
  if (!fields.postedAt && postedMatch) fields.postedAt = postedMatch[0].trim();
  return {
    details: {
      job_title: fields.title ?? undefined,
      company_name: fields.company,
      location: fields.location,
      salary: fields.salary,
      employment_type: fields.employmentType,
      job_description: fields.description,
    },
    postedAtText: fields.postedAt,
  };
}

function findStateDate(
  html: string,
  dateFields: readonly string[],
  updatedAtFields: readonly string[],
): { date: string; source: "exact" | "estimated" } | null {
  const roots: unknown[] = [];
  const nextData = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextData) roots.push(parseJson(nextData[1]));

  for (const assignment of extractSeekAssignments(html)) {
    roots.push(parseJson(assignment));
  }

  const find = (value: unknown, fields: readonly string[], depth = 0): string | null => {
    if (depth > 20 || value === null || typeof value !== "object") return null;
    if (Array.isArray(value)) {
      for (const child of value) {
        const result = find(child, fields, depth + 1);
        if (result) return result;
      }
      return null;
    }
    const record = value as Record<string, unknown>;
    for (const field of fields) {
      const candidate = record[field];
      if (typeof candidate === "string" && !Number.isNaN(Date.parse(candidate))) return new Date(candidate).toISOString();
    }
    const listedAt = record.listedAt;
    if (listedAt && typeof listedAt === "object") {
      const exact = (listedAt as Record<string, unknown>).dateTimeUtc;
      if (typeof exact === "string" && !Number.isNaN(Date.parse(exact))) return new Date(exact).toISOString();
    }
    for (const child of Object.values(record)) {
      const result = find(child, fields, depth + 1);
      if (result) return result;
    }
    return null;
  };

  for (const root of roots.filter((item): item is object => item !== null)) {
    const exact = find(root, dateFields);
    if (exact) return { date: exact, source: "exact" };
  }
  for (const root of roots.filter((item): item is object => item !== null)) {
    const estimated = find(root, updatedAtFields);
    if (estimated) return { date: estimated, source: "estimated" };
  }
  return null;
}

function extractSeekAssignments(html: string): string[] {
  const assignments: string[] = [];
  const pattern = /window\.SEEK_(?:REDUX_DATA|APP_DATA)\s*=\s*/gi;
  for (const match of html.matchAll(pattern)) {
    const start = match.index + match[0].length;
    if (html[start] !== "{") continue;
    let depth = 0;
    let quote: "\"" | "'" | null = null;
    let escaped = false;
    for (let index = start; index < html.length; index += 1) {
      const char = html[index];
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = null;
        }
      } else if (char === "\"" || char === "'") {
        quote = char;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          assignments.push(html.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return assignments;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
