import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanText,
  findJobPostings,
  limitUniqueJobLinks,
  normalizeJobUrl,
  parseRelativeDate,
  sourceFromUrl,
} from "./utils";
import { extractDetailsFromNextData, extractInitialJobs, extractListingLinksFromBrowser } from "../sources/glints";
import {
  createRateLimitMessage,
  isRateLimitStatus,
  getSourceCooldownUntil,
  getRateLimitRetryAt,
  parseRetryAfter,
} from "./rate-limit";
import { isPostedWithinWindow } from "../../lib/job-freshness";

test("daftar hanya menerima tanggal posting yang diketahui dan berada dalam tujuh hari", () => {
  const now = new Date("2026-10-31T12:00:00.000Z");
  const cutoff = new Date(now.getTime() - 7 * 86_400_000);
  assert.equal(isPostedWithinWindow("2026-10-31T11:00:00.000Z", cutoff, now), true);
  assert.equal(isPostedWithinWindow(cutoff.toISOString(), cutoff, now), true);
  assert.equal(isPostedWithinWindow("2026-10-24T11:59:59.999Z", cutoff, now), false);
  assert.equal(isPostedWithinWindow("2026-10-31T12:00:01.000Z", cutoff, now), false);
  assert.equal(isPostedWithinWindow(null, cutoff, now), false);
  assert.equal(isPostedWithinWindow("tanggal tidak valid", cutoff, now), false);
});

test("source detection accepts Glints and rejects other or lookalike domains", () => {
  assert.equal(sourceFromUrl("https://glints.com/id/opportunities"), "glints");
  assert.equal(sourceFromUrl("https://example.com/jobs"), null);
  assert.equal(sourceFromUrl("https://notglints.com/jobs"), null);
});

test("job URLs are canonicalized and tracking parameters are removed", () => {
  assert.equal(
    normalizeJobUrl("/id/opportunities/jobs/kepala-gudang?ref=search&utm_source=feed&lang=id", "https://glints.com/id/opportunities"),
    "https://glints.com/id/opportunities/jobs/kepala-gudang?lang=id",
  );
  assert.equal(
    normalizeJobUrl(
      "/id/opportunities/jobs/kepala-gudang/19b66931-d3fe-4c5a-a077-cdd52e8d4227?traceInfo=contoh&utm_referrer=explore",
      "https://glints.com/id/opportunities",
    ),
    "https://glints.com/id/opportunities/jobs/kepala-gudang/19b66931-d3fe-4c5a-a077-cdd52e8d4227",
  );
});

test("cleanText preserves paragraph and list boundaries", () => {
  assert.equal(cleanText("<p>Ringkasan</p><ul><li>Pertama</li><li>Kedua</li></ul>"), "Ringkasan\n- Pertama\n- Kedua");
});

test("relative dates produce an estimated date and reject unknown text", () => {
  const now = new Date("2026-10-29T00:00:00.000Z");
  assert.equal(parseRelativeDate("1 hari yang lalu", now)?.toISOString(), "2026-10-28T00:00:00.000Z");
  assert.equal(parseRelativeDate("2 hari yang lalu", now)?.toISOString(), "2026-10-27T00:00:00.000Z");
  assert.equal(parseRelativeDate("30+ hari yang lalu", now)?.toISOString(), "2026-09-28T00:00:00.000Z");
  assert.equal(parseRelativeDate("tanggal tidak tersedia", now), null);
});

test("Retry-After mendukung durasi detik dan tanggal HTTP", () => {
  const now = new Date("2026-10-31T00:00:00.000Z");
  assert.equal(parseRetryAfter("120", now)?.toISOString(), "2026-10-31T00:02:00.000Z");
  assert.equal(
    parseRetryAfter("Sat, 31 Oct 2026 08:00:00 GMT", now)?.toISOString(),
    "2026-10-31T08:00:00.000Z",
  );
  assert.equal(parseRetryAfter("tidak valid", now), null);
});

test("cooldown Glints bertahan minimal tiga jam dan Retry-After panjang dihormati", () => {
  const now = new Date("2026-10-31T00:00:00.000Z");
  const retryAt = new Date("2026-10-31T04:30:00.000Z");
  const message = createRateLimitMessage(429, retryAt, now);
  assert.equal(getRateLimitRetryAt(message)?.toISOString(), retryAt.toISOString());
  assert.equal(
    getSourceCooldownUntil("dibatasi", now.toISOString(), message, now)?.toISOString(),
    retryAt.toISOString(),
  );
  assert.equal(
    getSourceCooldownUntil("dibatasi", now.toISOString(), null, now)?.toISOString(),
    "2026-10-31T03:00:00.000Z",
  );
});

test("respons 403/429/503 menghentikan Glints", () => {
  assert.equal(isRateLimitStatus(403), true);
  assert.equal(isRateLimitStatus(429), true);
  assert.equal(isRateLimitStatus(503), true);
  assert.equal(isRateLimitStatus(500), false);
});

test("JSON-LD parser returns only JobPosting records", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Warehouse Associate",
    url: "https://glints.com/id/opportunities/jobs/123",
  })}</script>`;
  const jobs = findJobPostings(html);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, "Warehouse Associate");
});

test("Glints __NEXT_DATA__ mengurai descriptionJsonString dan field detail terkonfirmasi", () => {
  const descriptionJsonString = JSON.stringify({
    blocks: [
      { type: "unstyled", text: "Tanggung jawab gudang" },
      { type: "unordered-list-item", text: "Mengelola stok" },
      { type: "unstyled", text: "" },
    ],
  });
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: {
      pageProps: {
        initialData: {
          data: {
            title: "Kepala Gudang",
            descriptionJsonString,
            createdAt: "2026-10-31T06:54:42.101831Z",
            company: { displayName: "PT Contoh", name: "Contoh" },
            location: {
              formattedName: "Bubutan",
              parents: [{ formattedName: "Surabaya" }, { formattedName: "Jawa Timur" }],
            },
            type: "FULL_TIME",
            salaries: [{ minAmount: 4_000_000, maxAmount: 4_500_000, CurrencyCode: "IDR", salaryMode: "MONTH" }],
          },
        },
      },
    },
  })}</script>`;

  const details = extractDetailsFromNextData(html);
  assert.equal(details?.job_description, "Tanggung jawab gudang\n- Mengelola stok");
  assert.equal(details?.posted_at, "2026-10-31T06:54:42.101Z");
  assert.equal(details?.location, "Bubutan, Surabaya, Jawa Timur");
  assert.equal(details?.employment_type, "Full Time");
  assert.match(details?.salary ?? "", /4\.000\.000-4\.500\.000 IDR month/);
});

test("tautan listing Glints divalidasi terhadap id initialJobs dan membawa createdAt", () => {
  const html = `<script id="__NEXT_DATA__">${JSON.stringify({
    props: { pageProps: { initialJobs: { jobsInPage: [
      { id: "19b66931-d3fe-4c5a-a077-cdd52e8d4227", createdAt: "2026-10-31T06:54:42.101831Z" },
    ] } } },
  })}</script>`;
  const jobs = extractInitialJobs(html);
  const links = extractListingLinksFromBrowser([
    { href: "https://glints.com/id/opportunities/jobs/kepala-gudang/19b66931-d3fe-4c5a-a077-cdd52e8d4227" },
    { href: "https://glints.com/id/opportunities/jobs/rekomendasi/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  ], "https://glints.com/id/opportunities", jobs);

  assert.equal(links.length, 1);
  assert.equal(links[0].posted_at_hint, "2026-10-31T06:54:42.101Z");
});

test("batas 100 link Glints menerapkan deduplikasi sebelum pemotongan", () => {
  const candidates = Array.from({ length: 130 }, (_, index) => ({
    job_link: `https://glints.com/id/opportunities/jobs/${Math.floor(index / 2)}`,
    posted_at_hint: null,
  }));
  const limited = limitUniqueJobLinks(candidates, 100);
  assert.equal(limited.length, 65);

  const uniqueCandidates = Array.from({ length: 130 }, (_, index) => ({
    job_link: `https://glints.com/id/opportunities/jobs/${index}`,
    posted_at_hint: null,
  }));
  assert.equal(limitUniqueJobLinks(uniqueCandidates, 100).length, 100);
});

test("adapter Glints dapat diimpor dan mengekstrak JSON-LD JobPosting", async () => {
  const { extractDetailsFromJsonLd: extractGlintsDetails, normalizeSearchUrl } = await import("../sources/glints");
  const details = extractGlintsDetails(`<script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: "Staff Gudang",
    description: "<p>Deskripsi lowongan</p>",
    datePosted: "2026-10-30T00:00:00Z",
  })}</script>`);

  assert.equal(details?.job_title, "Staff Gudang");
  assert.equal(details?.job_description, "Deskripsi lowongan");
  assert.equal(normalizeSearchUrl("https://glints.com/id/opportunities"), "https://glints.com/id/opportunities");
});
