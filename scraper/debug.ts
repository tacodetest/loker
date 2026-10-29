import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { PAGE_TIMEOUT_MS } from "./config";
import type { JobSource } from "./lib/types";
import { findJobPostings, sourceFromUrl } from "./lib/utils";
import * as glints from "./sources/glints";
import * as jobstreet from "./sources/jobstreet";

const sites: JobSource[] = ["jobstreet", "glints"];
const adapters = { jobstreet, glints };

async function main() {
  const targets = sites.map((source) => ({
    source,
    searchUrl: process.env[`DEBUG_${source.toUpperCase()}_SEARCH_URL`],
  }));
  const configuredTargets = targets.filter(
    (target): target is typeof target & { searchUrl: string } => Boolean(target.searchUrl),
  );
  if (!configuredTargets.length) {
    throw new Error("Isi setidaknya satu URL pencarian di DEBUG_JOBSTREET_SEARCH_URL atau DEBUG_GLINTS_SEARCH_URL.");
  }

  const browser = await chromium.launch({ headless: true });
  const outputDirectory = path.join(process.cwd(), "debug");
  await mkdir(outputDirectory, { recursive: true });
  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "id-ID",
      timezoneId: "Asia/Jakarta",
      viewport: { width: 1440, height: 900 },
    });
    for (const { source, searchUrl } of configuredTargets) {
      if (sourceFromUrl(searchUrl) !== source) {
        throw new Error(`URL pencarian debug untuk ${source} harus memakai domain situs yang sesuai.`);
      }

      const listingHtml = await capturePage(page, source, "listing", searchUrl, outputDirectory);
      const adapter = adapters[source];
      let candidates = adapter.extractListingLinks(listingHtml, searchUrl);
      const config = source === "jobstreet" ? jobstreet.jobstreetConfig : glints.glintsConfig;
      if (!candidates.length && config.listingLinkSelector) {
        const browserLinks = await page.locator(config.listingLinkSelector).evaluateAll((nodes) =>
          nodes.map((node) => ({ href: (node as HTMLAnchorElement).href })),
        );
        candidates = adapter.extractListingLinksFromBrowser(browserLinks, searchUrl);
      }

      const detailUrl = candidates[0]?.job_link;
      if (!detailUrl) {
        throw new Error(
          `Belum menemukan tautan detail di halaman pencarian ${source}. Periksa ${source}-listing.html, lalu konfigurasi listingLinkSelector di scraper/sources/${source}.ts.`,
        );
      }
      await capturePage(page, source, "detail", detailUrl, outputDirectory);
    }
  } finally {
    await browser.close();
  }
}

async function capturePage(
  page: import("playwright").Page,
  source: JobSource,
  kind: "listing" | "detail",
  url: string,
  outputDirectory: string,
) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  if (!response?.ok()) throw new Error(`Debug ${source} ${kind} gagal dibuka (${response?.status() ?? "tanpa respons"}).`);
  await page.locator("body").waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
  const html = await page.content();
  const file = path.join(outputDirectory, `${source}-${kind}.html`);
  await writeFile(file, html, "utf8");
  const dateFields = [...new Set(html.match(/\b(?:createdAt|datePosted|postedAt|updatedAt|created_at|posted_at|updated_at)\b/g) ?? [])];
  console.info(`[debug] ${source} ${kind}: ${file}`);
  console.info(`[debug] JobPosting JSON-LD: ${findJobPostings(html).length > 0}; __NEXT_DATA__: ${/<script\b[^>]*id=["']__NEXT_DATA__["']/i.test(html)}; field tanggal terdeteksi: ${dateFields.join(", ") || "(tidak ada)"}`);
  return html;
}

main().catch((error: unknown) => {
  console.error(`[debug] Gagal menangkap HTML: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
