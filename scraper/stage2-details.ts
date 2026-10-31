import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import {
  DATE_RANGE_DAYS,
  DELAY_MAX_MS,
  DELAY_MIN_MS,
  DESCRIPTION_MAX_CHARS,
  MAX_DETAIL_ATTEMPTS,
  MAX_FAILED_HTML_PER_RUN,
  PAGE_TIMEOUT_MS,
} from "./config";
import type { JobDetails, JobSource, PendingJob, SavedLink } from "./lib/types";
import {
  findJobPostings,
  isBlockedPage,
  parseRelativeDate,
  sleepRandom,
} from "./lib/utils";
import {
  expireJob,
  getPendingJobs,
  markJobAttempt,
  updateJobDetails,
} from "./lib/supabase";
import {
  createRateLimitMessage,
  isRateLimitStatus,
  parseRetryAfter,
  RateLimitedError,
} from "./lib/rate-limit";
import * as glints from "./sources/glints";

export type LinkDetailSummary = {
  berhasil: number;
  gagal: number;
  errorPertama: string | null;
  dibatasi: boolean;
  retryAt: string | null;
};
let savedFailureHtmlCount = 0;

class ConfigurationRequiredError extends Error {}

export async function scrapePendingDetails(links: SavedLink[]): Promise<Map<string, LinkDetailSummary>> {
  const summaries = new Map<string, LinkDetailSummary>(
    links.map(({ id }) => [id, { berhasil: 0, gagal: 0, errorPertama: null, dibatasi: false, retryAt: null }]),
  );
  const jobs = await getPendingJobs(links);
  if (!jobs.length) return summaries;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "id-ID",
      timezoneId: "Asia/Jakarta",
      viewport: { width: 1440, height: 900 },
    });
    let sourceRateLimited: RateLimitedError | null = null;
    for (const job of jobs) {
      if (sourceRateLimited) {
        setLinkLimited(
          summaries.get(job.link_id),
          createRateLimitMessage(sourceRateLimited.status, sourceRateLimited.retryAt),
          sourceRateLimited.retryAt,
        );
        continue;
      }
      let saved = false;
      let limited: RateLimitedError | null = null;
      let lastError = "";
      const remainingAttempts = MAX_DETAIL_ATTEMPTS - job.detail_attempts;
      for (let attempt = 0; attempt < remainingAttempts; attempt += 1) {
        try {
          const details = await loadDetails(page, job);
          if (details) await persistDetails(job, details);
          saved = true;
          if (details) console.info(`[scraper] Detail berhasil: ${job.job_link}`);
          break;
        } catch (error) {
          if (error instanceof RateLimitedError) {
            limited = error;
            sourceRateLimited = error;
            lastError = createRateLimitMessage(error.status, error.retryAt);
            console.warn(`[scraper] Pembatasan saat membuka detail ${job.job_link}: ${lastError}`);
            break;
          }
          lastError = error instanceof Error ? error.message : String(error);
          await markJobAttempt(job, job.detail_attempts + attempt + 1, lastError);
          if (error instanceof ConfigurationRequiredError) {
            console.error(`[scraper] Data detail belum lengkap (${attempt + 1}/${remainingAttempts}): ${job.job_link}: ${lastError}`);
          } else {
            console.error(`[scraper] Detail gagal (${attempt + 1}/${remainingAttempts}): ${job.job_link}: ${lastError}`);
          }
          if (attempt + 1 < remainingAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
          }
        }
      }

      const summary = summaries.get(job.link_id);
      if (limited) {
        setLinkLimited(summary, lastError, limited.retryAt);
      } else if (summary) {
        if (saved) {
          summary.berhasil += 1;
        } else {
          summary.gagal += 1;
          if (!summary.errorPertama) {
            summary.errorPertama = lastError || "Batas percobaan detail sudah tercapai.";
          }
        }
      }
      if (!limited) {
        await sleepRandom(DELAY_MIN_MS, DELAY_MAX_MS);
      }
    }
  } finally {
    await browser.close();
  }
  return summaries;
}

async function loadDetails(page: Page, job: PendingJob): Promise<JobDetails | null> {
  const response = await page.goto(job.job_link, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  if (!response || !response.ok()) {
    const status = response?.status();
    if (response) await saveFailedHtml(job.source, await page.content());
    if (status !== undefined && isRateLimitStatus(status)) {
      throw new RateLimitedError(status, parseRetryAfter(response?.headers()["retry-after"] ?? null));
    }
    throw new Error(`Gagal membuka detail (${status ?? "tanpa respons"}) di ${job.job_link}.`);
  }
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await page.locator("body").waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
  const html = await page.content();
  if (isBlockedPage(html)) {
    await saveFailedHtml(job.source, html);
    throw new RateLimitedError(403, null);
  }

  const jsonLdDetails: Partial<JobDetails> = glints.extractDetailsFromJsonLd(html) ?? {};
  const nextDataDetails: Partial<JobDetails> = glints.extractDetailsFromNextData(html) ?? {};
  const existingDetails = mergeDetails(jsonLdDetails, nextDataDetails);
  const config = glints.glintsConfig;
  const { details: selectorDetails, postedAtText } = await readConfirmedSelectors(
    page,
    config.detailSelectors,
    existingDetails,
  );
  const merged: JobDetails = {
    job_title: firstText(jsonLdDetails.job_title, nextDataDetails.job_title, selectorDetails.job_title) ?? "",
    company_name: firstText(jsonLdDetails.company_name, nextDataDetails.company_name, selectorDetails.company_name),
    location: firstText(jsonLdDetails.location, nextDataDetails.location, selectorDetails.location),
    salary: firstText(jsonLdDetails.salary, nextDataDetails.salary, selectorDetails.salary),
    employment_type: firstText(jsonLdDetails.employment_type, nextDataDetails.employment_type, selectorDetails.employment_type),
    posted_at: jsonLdDetails.posted_at ?? nextDataDetails.posted_at ?? null,
    posted_at_source: jsonLdDetails.posted_at
      ? jsonLdDetails.posted_at_source ?? "exact"
      : nextDataDetails.posted_at
        ? nextDataDetails.posted_at_source ?? "exact"
        : "unknown",
    job_description: firstText(
      jsonLdDetails.job_description,
      nextDataDetails.job_description,
      selectorDetails.job_description,
    ),
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
    if (!merged.job_description) {
      const diagnostics = {
        jsonLdAda: findJobPostings(html).length > 0,
        nextDataAda: /<script\b[^>]*id=["']__NEXT_DATA__["']/i.test(html),
        panjangJsonLd: jsonLdDetails.job_description?.length ?? 0,
        panjangNextData: nextDataDetails.job_description?.length ?? 0,
        panjangSelector: selectorDetails.job_description?.length ?? 0,
      };
      console.error(`[scraper] Diagnosis deskripsi kosong untuk ${job.job_link}: ${JSON.stringify(diagnostics)}`);
    }
    await saveFailedHtml(job.source, html);
    const missing = [
      !merged.job_title && "judul lowongan",
      !merged.job_description && "deskripsi lowongan",
    ].filter(Boolean).join(" dan ");
    throw new ConfigurationRequiredError(`Detail ${missing} tidak ditemukan di ${job.job_link}. Periksa HTML debug dan selector ${job.source}.`);
  }
  merged.job_description = merged.job_description.slice(0, DESCRIPTION_MAX_CHARS);
  if (merged.posted_at && Date.parse(merged.posted_at) < Date.now() - DATE_RANGE_DAYS * 86_400_000) {
    await expireJob(job, "Tanggal posting sudah lebih dari 7 hari.");
    return null;
  }
  return merged;
}

function setLinkLimited(
  summary: LinkDetailSummary | undefined,
  message: string,
  retryAt: Date | null,
) {
  if (!summary) return;
  summary.dibatasi = true;
  summary.errorPertama ??= message;
  summary.retryAt ??= retryAt?.toISOString() ?? null;
}

function mergeDetails(
  first: Partial<JobDetails>,
  second: Partial<JobDetails>,
): Partial<JobDetails> {
  return {
    job_title: firstText(first.job_title, second.job_title) ?? undefined,
    company_name: firstText(first.company_name, second.company_name),
    location: firstText(first.location, second.location),
    salary: firstText(first.salary, second.salary),
    employment_type: firstText(first.employment_type, second.employment_type),
    posted_at: first.posted_at ?? second.posted_at,
    posted_at_source: first.posted_at ? first.posted_at_source : second.posted_at_source,
    job_description: firstText(first.job_description, second.job_description),
  };
}

function firstText(...values: Array<string | null | undefined>): string | null {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() ?? null;
}

async function saveFailedHtml(source: JobSource, html: string) {
  if (savedFailureHtmlCount >= MAX_FAILED_HTML_PER_RUN) return;
  const directory = path.join(process.cwd(), "debug", "failed");
  await mkdir(directory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(directory, `${source}-${timestamp}-${savedFailureHtmlCount + 1}.html`);
  await writeFile(file, html, "utf8");
  savedFailureHtmlCount += 1;
  console.info(`[scraper] HTML detail gagal disimpan untuk diagnosis: ${file}`);
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
    posted_at_source: details.posted_at_source,
    detail_status: "ok",
    detail_attempts: job.detail_attempts,
    last_error: null,
    scraped_at: new Date().toISOString(),
  });
}

async function readConfirmedSelectors(
  page: Page,
  selectors: Record<string, string>,
  existing: Partial<JobDetails>,
): Promise<{ details: Partial<JobDetails>; postedAtText: string | null }> {
  const existingValues: Record<string, boolean> = {
    title: Boolean(existing.job_title),
    company: Boolean(existing.company_name),
    location: Boolean(existing.location),
    salary: Boolean(existing.salary),
    employmentType: Boolean(existing.employment_type),
    description: Boolean(existing.job_description),
  };
  const fields: Record<string, string | null> = {};
  const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  for (const [field, selector] of Object.entries(selectors)) {
    if (!selector || existingValues[field]) continue;
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
  if (nextData) {
    try {
      roots.push(JSON.parse(nextData[1]));
    } catch {
      roots.push(null);
    }
  }

  const find = (value: unknown, fields: readonly string[], depth = 0): string | null => {
    if (depth > 30 || value === null || typeof value !== "object") return null;
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
