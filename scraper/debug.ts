import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { PAGE_TIMEOUT_MS } from "./config";
import { findJobPostings } from "./lib/utils";
import * as glints from "./sources/glints";

async function main() {
  const searchUrl = process.env.DEBUG_GLINTS_SEARCH_URL;
  if (!searchUrl) throw new Error("Isi DEBUG_GLINTS_SEARCH_URL dengan URL pencarian Glints.");
  const url = new URL(searchUrl);
  if (url.hostname !== "glints.com" && !url.hostname.endsWith(".glints.com")) {
    throw new Error("URL pencarian debug harus memakai domain Glints.");
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
    const listingHtml = await capturePage(page, "listing", searchUrl, outputDirectory);
    let candidates = glints.extractListingLinks(listingHtml, searchUrl);
    if (!candidates.length && glints.glintsConfig.listingLinkSelector) {
      const browserLinks = await page.locator(glints.glintsConfig.listingLinkSelector).evaluateAll((nodes) =>
        nodes.map((node) => ({ href: (node as HTMLAnchorElement).href })),
      );
      candidates = glints.extractListingLinksFromBrowser(browserLinks, searchUrl, glints.extractInitialJobs(listingHtml));
    }
    const detailUrl = candidates[0]?.job_link;
    if (!detailUrl) throw new Error("Belum menemukan tautan detail Glints dari halaman pencarian.");
    await capturePage(page, "detail", detailUrl, outputDirectory);
  } finally {
    await browser.close();
  }
}

async function capturePage(
  page: import("playwright").Page,
  kind: "listing" | "detail",
  url: string,
  outputDirectory: string,
) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  if (!response?.ok()) throw new Error(`Debug Glints ${kind} gagal dibuka (${response?.status() ?? "tanpa respons"}) di ${url}.`);
  await page.locator("body").waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
  const html = await page.content();
  const file = path.join(outputDirectory, `glints-${kind}.html`);
  await writeFile(file, html, "utf8");
  const dateFields = [...new Set(html.match(/\b(?:createdAt|datePosted|postedAt|listedAt|dateTimeUtc|updatedAt|created_at|posted_at|updated_at)\b/g) ?? [])];
  console.info(`[debug] Glints ${kind}: ${file}`);
  console.info(`[debug] Data JobPosting JSON-LD: ${findJobPostings(html).length > 0}; data __NEXT_DATA__: ${/<script\b[^>]*id=["']__NEXT_DATA__["']/i.test(html)}; field tanggal terdeteksi: ${dateFields.join(", ") || "(tidak ada)"}`);
  return html;
}

main().catch((error: unknown) => {
  console.error(`[debug] Gagal menangkap HTML: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
