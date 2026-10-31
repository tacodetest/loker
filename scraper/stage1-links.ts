import { chromium, type Page } from "playwright";
import {
  DATE_RANGE_DAYS,
  DELAY_MAX_MS,
  DELAY_MIN_MS,
  GLINTS_SCROLL_TIMEOUT_MS,
  JOBSTREET_DELAY_MAX_MS,
  JOBSTREET_DELAY_MIN_MS,
  MAX_LINKS_PER_SEARCH,
  MAX_PAGES_PER_LINK,
  PAGE_TIMEOUT_MS,
} from "./config";
import type { JobLinkCandidate, SavedLink } from "./lib/types";
import { isBlockedPage, limitUniqueJobLinks, normalizeJobUrl, sleepRandom } from "./lib/utils";
import { RateLimitedError, parseRetryAfter } from "./lib/rate-limit";
import { replaceSourceJobs, scraperDb, upsertJobLinks } from "./lib/supabase";
import * as glints from "./sources/glints";
import * as jobstreet from "./sources/jobstreet";

const browserOptions = {
  headless: true,
};

export async function collectJobLinks(link: SavedLink): Promise<number> {
  const searchUrl = link.source === "jobstreet"
    ? jobstreet.normalizeSearchUrl(link.url, DATE_RANGE_DAYS)
    : glints.normalizeSearchUrl(link.url);
  const browser = await chromium.launch(browserOptions);

  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "id-ID",
      timezoneId: "Asia/Jakarta",
      viewport: { width: 1440, height: 900 },
    });
    let candidates: JobLinkCandidate[];
    let rateLimited: RateLimitedError | null = null;
    if (link.source === "jobstreet") {
      const result = await collectJobStreetLinks(page, searchUrl);
      candidates = result.candidates;
      rateLimited = result.rateLimited;
    } else {
      candidates = await collectGlintsLinksByScroll(page, searchUrl);
    }
    if (!candidates.length) {
      if (rateLimited) throw rateLimited;
      throw new Error(`Tidak ada tautan detail lowongan yang ditemukan di ${searchUrl}. Data lama dipertahankan.`);
    }

    await upsertJobLinks(link, candidates);
    if (rateLimited) {
      rateLimited = new RateLimitedError(rateLimited.status, rateLimited.retryAt, candidates.length);
      throw rateLimited;
    }
    const freshJobUrls = candidates
      .map(({ job_link }) => normalizeJobUrl(job_link, link.url))
      .filter((jobUrl): jobUrl is string => Boolean(jobUrl));
    if (freshJobUrls.length < MAX_LINKS_PER_SEARCH) {
      await replaceSourceJobs(link, freshJobUrls);
    } else {
      console.info(`[scraper] Batas ${MAX_LINKS_PER_SEARCH} tautan tercapai untuk ${link.url}; tautan lama yang tidak terlihat tetap dipertahankan.`);
    }
    await markStaleListingHints(link, candidates);
    return candidates.length;
  } finally {
    await browser.close();
  }
}

async function collectJobStreetLinks(
  page: Page,
  searchUrl: string,
): Promise<{ candidates: JobLinkCandidate[]; rateLimited: RateLimitedError | null }> {
  const uniqueLinks = new Map<string, JobLinkCandidate>();
  let rateLimited: RateLimitedError | null = null;
  for (let pageNumber = 1; pageNumber <= MAX_PAGES_PER_LINK; pageNumber += 1) {
    const pageUrl = new URL(searchUrl);
    pageUrl.searchParams.set("page", String(pageNumber));
    let html: string;
    try {
      html = await loadHtml(page, pageUrl.toString(), "jobstreet");
    } catch (error) {
      if (!(error instanceof RateLimitedError)) throw error;
      rateLimited = error;
      break;
    }
    const links = await readListingAnchors(page, jobstreet.jobstreetConfig.listingLinkSelector);
    const candidates = jobstreet.extractListingLinksFromBrowser(links, pageUrl.toString(), html);
    if (!candidates.length) {
      if (pageNumber === 1) {
        throw new Error(
          `Belum menemukan tautan lowongan JobStreet di ${pageUrl}. Periksa HTML dengan npm run scrape:debug.`,
        );
      }
      break;
    }

    const previousSize = uniqueLinks.size;
    for (const candidate of candidates) {
      if (!uniqueLinks.has(candidate.job_link)) uniqueLinks.set(candidate.job_link, candidate);
      if (uniqueLinks.size === MAX_LINKS_PER_SEARCH) break;
    }
    if (uniqueLinks.size === MAX_LINKS_PER_SEARCH || uniqueLinks.size === previousSize) break;
    if (pageNumber < MAX_PAGES_PER_LINK) {
      await sleepRandom(JOBSTREET_DELAY_MIN_MS, JOBSTREET_DELAY_MAX_MS);
    }
  }
  return {
    candidates: limitUniqueJobLinks([...uniqueLinks.values()], MAX_LINKS_PER_SEARCH),
    rateLimited,
  };
}

export async function collectGlintsLinksByScroll(page: Page, searchUrl: string): Promise<JobLinkCandidate[]> {
  await loadHtml(page, searchUrl, "glints");
  const initialHtml = await page.content();
  const listedJobs = glints.extractInitialJobs(initialHtml);
  const initialAnchors = await readListingAnchors(page, glints.glintsConfig.listingLinkSelector);
  const uniqueLinks = new Map<string, JobLinkCandidate>();
  for (const candidate of glints.extractListingLinksFromBrowser(initialAnchors, searchUrl, listedJobs)) {
    uniqueLinks.set(candidate.job_link, candidate);
    if (uniqueLinks.size === MAX_LINKS_PER_SEARCH) break;
  }

  const seenAnchorHrefs = new Set(initialAnchors.map(({ href }) => href));
  let noGrowthCount = 0;
  const startedAt = Date.now();
  while (uniqueLinks.size < MAX_LINKS_PER_SEARCH && noGrowthCount < 3) {
    if (Date.now() - startedAt >= GLINTS_SCROLL_TIMEOUT_MS) {
      throw new Error(`Pengguliran Glints melewati batas waktu di ${searchUrl}. Hasil parsial tidak menggantikan data lama.`);
    }
    const previousCount = await page.locator(glints.glintsConfig.listingLinkSelector).count();
    const loadMore = page.getByRole("button", {
      name: /muat lebih banyak|lihat lebih banyak|load more|show more/i,
    }).first();
    if (await loadMore.count() && await loadMore.isVisible()) {
      await loadMore.click();
    } else {
      await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight * 0.8, 600)));
    }

    await page.waitForFunction(
      ({ selector, count }) => document.querySelectorAll(selector).length > count,
      { selector: glints.glintsConfig.listingLinkSelector, count: previousCount },
      { timeout: 2_000 },
    ).catch(() => undefined);
    const loadedAnchors = await readListingAnchors(page, glints.glintsConfig.listingLinkSelector);
    const newAnchors = loadedAnchors.filter(({ href }) => !seenAnchorHrefs.has(href));
    for (const { href } of loadedAnchors) seenAnchorHrefs.add(href);
    for (const candidate of glints.extractListingLinksFromBrowser(newAnchors, searchUrl, listedJobs, true)) {
      if (!uniqueLinks.has(candidate.job_link)) uniqueLinks.set(candidate.job_link, candidate);
      if (uniqueLinks.size === MAX_LINKS_PER_SEARCH) break;
    }
    noGrowthCount = loadedAnchors.length > previousCount ? 0 : noGrowthCount + 1;
    if (uniqueLinks.size < MAX_LINKS_PER_SEARCH && noGrowthCount < 3) {
      await sleepRandom(DELAY_MIN_MS, DELAY_MAX_MS);
    }
  }
  return limitUniqueJobLinks([...uniqueLinks.values()], MAX_LINKS_PER_SEARCH);
}

async function readListingAnchors(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((nodes) =>
    nodes.flatMap((node) => {
      const href = (node as HTMLAnchorElement).href;
      return href ? [{ href }] : [];
    }),
  );
}

async function loadHtml(page: Page, url: string, source: "jobstreet" | "glints") {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  if (!response || !response.ok()) {
    const status = response?.status();
    if (source === "jobstreet" && (status === 429 || status === 503)) {
      throw new RateLimitedError(status, parseRetryAfter(response?.headers()["retry-after"] ?? null));
    }
    if (status === 403) {
      throw new Error(
        `Situs menolak akses scraper (HTTP 403) di ${url}. Scraper tidak melewati pembatasan akses dan data lama dipertahankan.`,
      );
    }
    throw new Error(`Gagal membuka halaman daftar (${status ?? "tanpa respons"}): ${url}. Data lama dipertahankan.`);
  }
  await page.locator("body").waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
  const html = await page.content();
  if (isBlockedPage(html)) {
    throw new Error(`Halaman mendeteksi captcha atau pemblokiran di ${url}. Data lama dipertahankan.`);
  }
  return html;
}

export async function markStaleListingHints(link: SavedLink, candidates: JobLinkCandidate[]) {
  const cutoff = Date.now() - DATE_RANGE_DAYS * 86_400_000;
  const oldLinks = candidates
    .filter(({ posted_at_hint }) => posted_at_hint && Date.parse(posted_at_hint) < cutoff)
    .map(({ job_link }) => job_link);
  if (!oldLinks.length) return;
  const { error } = await scraperDb().from("jobs").update({
    detail_status: "expired",
  }).eq("owner_id", link.owner_id).in("job_link", oldLinks);
  if (error) throw new Error(`Gagal melewati lowongan lama: ${error.message}`);
}
