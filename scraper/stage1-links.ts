import { chromium, type Page } from "playwright";
import { DATE_RANGE_DAYS, DELAY_MAX_MS, DELAY_MIN_MS, MAX_PAGES_PER_LINK, PAGE_TIMEOUT_MS } from "./config";
import type { JobLinkCandidate, JobSource, SavedLink } from "./lib/types";
import { isBlockedPage, normalizeJobUrl, sleepRandom } from "./lib/utils";
import { replaceSourceJobs, scraperDb, upsertJobLinks } from "./lib/supabase";
import * as glints from "./sources/glints";
import * as jobstreet from "./sources/jobstreet";

type SiteAdapter = typeof jobstreet | typeof glints;
const adapters: Record<JobSource, SiteAdapter> = { jobstreet, glints };

export async function collectJobLinks(link: SavedLink): Promise<number> {
  const adapter = adapters[link.source];
  const baseUrl = link.source === "jobstreet"
    ? jobstreet.normalizeSearchUrl(link.url, DATE_RANGE_DAYS)
    : glints.normalizeSearchUrl(link.url);
  const initialUrl = new URL(baseUrl);
  const originalPage = initialUrl.searchParams.get("page");
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "id-ID",
      timezoneId: "Asia/Jakarta",
      viewport: { width: 1440, height: 900 },
    });
    const uniqueLinks = new Map<string, JobLinkCandidate>();
    for (let pageNumber = 1; pageNumber <= MAX_PAGES_PER_LINK; pageNumber += 1) {
      const pageUrl = new URL(baseUrl);
      if (pageNumber > 1 || originalPage) pageUrl.searchParams.set("page", String(pageNumber));
      const html = await loadHtml(page, pageUrl.toString());
      if (isBlockedPage(html)) throw new Error("Scraping dihentikan: halaman mendeteksi captcha atau pemblokiran.");

      let candidates = adapter.extractListingLinks(html, pageUrl.toString());
      const config = link.source === "jobstreet" ? jobstreet.jobstreetConfig : glints.glintsConfig;
      if (!candidates.length && config.listingLinkSelector) {
        const browserLinks = await page.locator(config.listingLinkSelector).evaluateAll((nodes) =>
          nodes.map((node) => ({ href: (node as HTMLAnchorElement).href })),
        );
        candidates = adapter.extractListingLinksFromBrowser(browserLinks, pageUrl.toString());
      }

      if (!candidates.length) {
        if (pageNumber === 1) {
          throw new Error(
            `Belum menemukan tautan lowongan di ${pageUrl}. Periksa HTML dengan npm run scrape:debug, lalu isi listingLinkSelector di scraper/sources/${link.source}.ts.`,
          );
        }
        break;
      }
      const previousSize = uniqueLinks.size;
      for (const candidate of candidates) uniqueLinks.set(candidate.job_link, candidate);
      if (uniqueLinks.size === previousSize) break;
      if (pageNumber < MAX_PAGES_PER_LINK) await sleepRandom(DELAY_MIN_MS, DELAY_MAX_MS);
    }

    const candidates = [...uniqueLinks.values()];
    const count = await upsertJobLinks(link, candidates);
    const freshJobUrls = candidates
      .map(({ job_link }) => normalizeJobUrl(job_link, link.url))
      .filter((jobUrl): jobUrl is string => Boolean(jobUrl));
    await replaceSourceJobs(link, freshJobUrls);
    await markStaleListingHints(link, candidates);
    return count;
  } finally {
    await browser.close();
  }
}

async function loadHtml(page: Page, url: string) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  if (!response || !response.ok()) throw new Error(`Gagal membuka halaman daftar (${response?.status() ?? "tanpa respons"}): ${url}`);
  await page.locator("body").waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
  return page.content();
}

export async function markStaleListingHints(link: SavedLink, candidates: JobLinkCandidate[]) {
  const cutoff = Date.now() - DATE_RANGE_DAYS * 86_400_000;
  const oldLinks = candidates
    .filter(({ posted_at_hint }) => posted_at_hint && Date.parse(posted_at_hint) < cutoff)
    .map(({ job_link }) => job_link);
  if (!oldLinks.length) return;
  const { error } = await scraperDb().from("jobs").update({
    detail_status: "expired",
    posted_at_source: "exact",
  }).eq("owner_id", link.owner_id).in("job_link", oldLinks);
  if (error) throw new Error(`Gagal melewati lowongan lama: ${error.message}`);
}
