import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanText,
  extractSeekAssignments,
  findJobPostings,
  findSeekListedAtById,
  limitUniqueJobLinks,
  normalizeJobUrl,
  parseRelativeDate,
  parseSeekJson,
  sourceFromUrl,
} from "./utils";
import { extractDetailsFromNextData, extractInitialJobs, extractListingLinksFromBrowser } from "../sources/glints";
import {
  extractDetailsFromJsonLd as extractJobStreetDetails,
  extractListingLinksFromBrowser as extractJobStreetLinks,
  jobstreetConfig,
  normalizeSearchUrl as normalizeJobStreetSearch,
} from "../sources/jobstreet";
import {
  createRateLimitMessage,
  isRateLimitStatus,
  getSourceCooldownUntil,
  getRateLimitRetryAt,
  parseRetryAfter,
} from "./rate-limit";
import { getUnsupportedSourceMessage, isSourceEnabled } from "./enabled-sources";

test("source detection accepts JobStreet and Glints but rejects lookalike domains", () => {
  assert.equal(sourceFromUrl("https://id.jobstreet.com/jobs"), "jobstreet");
  assert.equal(sourceFromUrl("https://glints.com/id/opportunities"), "glints");
  assert.equal(sourceFromUrl("https://jobstreet.com.attacker.invalid/jobs"), null);
});

test("hanya Glints aktif dan URL JobStreet ditolak dengan pesan operasional", () => {
  assert.equal(isSourceEnabled("glints"), true);
  assert.equal(isSourceEnabled("jobstreet"), false);
  assert.equal(getUnsupportedSourceMessage("glints"), null);
  assert.equal(getUnsupportedSourceMessage("jobstreet"), "Saat ini hanya Glints yang didukung.");
});

test("job URLs are canonicalized and tracking parameters are removed", () => {
  assert.equal(
    normalizeJobUrl("/job/123?type=standard&ref=search&utm_source=feed&lang=id", "https://id.jobstreet.com/search"),
    "https://id.jobstreet.com/job/123?lang=id",
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

test("cooldown JobStreet bertahan minimal enam jam dan menghormati Retry-After lebih lama", () => {
  const now = new Date("2026-10-31T00:00:00.000Z");
  const error = createRateLimitMessage("jobstreet", 429, new Date("2026-10-31T12:00:00.000Z"), now);
  assert.equal(getRateLimitRetryAt(error)?.toISOString(), "2026-10-31T12:00:00.000Z");
  assert.equal(
    getSourceCooldownUntil("jobstreet", "dibatasi", now.toISOString(), error, now)?.toISOString(),
    "2026-10-31T12:00:00.000Z",
  );
  assert.equal(
    getSourceCooldownUntil("jobstreet", "dibatasi", now.toISOString(), null, now)?.toISOString(),
    "2026-10-31T06:00:00.000Z",
  );
  assert.equal(getSourceCooldownUntil("jobstreet", "berhasil", now.toISOString(), error, now), null);
  assert.equal(
    getSourceCooldownUntil("jobstreet", "dibatasi", now.toISOString(), null, new Date("2026-10-31T07:00:00.000Z")),
    null,
  );
});

test("cooldown Glints bertahan minimal tiga jam dan Retry-After panjang dihormati", () => {
  const now = new Date("2026-10-31T00:00:00.000Z");
  const retryAt = new Date("2026-10-31T04:30:00.000Z");
  const message = createRateLimitMessage("glints", 429, retryAt, now);
  assert.equal(getRateLimitRetryAt(message)?.toISOString(), retryAt.toISOString());
  assert.equal(
    getSourceCooldownUntil("glints", "dibatasi", now.toISOString(), message, now)?.toISOString(),
    retryAt.toISOString(),
  );
  assert.equal(
    getSourceCooldownUntil("glints", "dibatasi", now.toISOString(), null, now)?.toISOString(),
    "2026-10-31T03:00:00.000Z",
  );
});

test("respons 403/429/503 menghentikan Glints tanpa mengubah kebijakan JobStreet yang dormant", () => {
  assert.equal(isRateLimitStatus("glints", 403), true);
  assert.equal(isRateLimitStatus("glints", 429), true);
  assert.equal(isRateLimitStatus("glints", 503), true);
  assert.equal(isRateLimitStatus("glints", 500), false);
  assert.equal(isRateLimitStatus("jobstreet", 403), false);
  assert.equal(isRateLimitStatus("jobstreet", 429), true);
});

test("JSON-LD parser returns only JobPosting records", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Warehouse Associate",
    url: "https://id.jobstreet.com/job/123",
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

test("batas 100 link menerapkan deduplikasi sebelum pemotongan", () => {
  const candidates = Array.from({ length: 130 }, (_, index) => ({
    job_link: `https://id.jobstreet.com/job/${Math.floor(index / 2)}`,
    posted_at_hint: null,
  }));
  const limited = limitUniqueJobLinks(candidates, 100);
  assert.equal(limited.length, 65);

  const uniqueCandidates = Array.from({ length: 130 }, (_, index) => ({
    job_link: `https://id.jobstreet.com/job/${index}`,
    posted_at_hint: null,
  }));
  assert.equal(limitUniqueJobLinks(uniqueCandidates, 100).length, 100);
});

test("data SEEK diparse termasuk undefined dan listedAt", () => {
  const html = `<script>window.SEEK_APOLLO_DATA = {"results":[{"id":"95579187","listedAt":{"dateTimeUtc":"2026-10-29T07:38:37.000Z"}}],"optional":undefined};</script>`;
  const assignments = extractSeekAssignments(html);
  assert.equal(assignments.length, 1);
  assert.deepEqual(parseSeekJson(assignments[0]), {
    results: [{ id: "95579187", listedAt: { dateTimeUtc: "2026-10-29T07:38:37.000Z" } }],
    optional: null,
  });
  assert.equal(
    findSeekListedAtById(html).get("95579187"),
    "2026-10-29T07:38:37.000Z",
  );
});

test("adapter JobStreet dapat diimpor dan menggunakan listedAt sebagai tanggal tautan", () => {
  const html = `<script>window.SEEK_APOLLO_DATA = {"results":[{"id":"95579187","listedAt":{"dateTimeUtc":"2026-10-29T07:38:37.000Z"}}]};</script>`;
  const links = extractJobStreetLinks([
    { href: "https://id.jobstreet.com/id/job/95579187" },
  ], "https://id.jobstreet.com/search", html);

  assert.equal(links[0].posted_at_hint, "2026-10-29T07:38:37.000Z");
  assert.equal(normalizeJobStreetSearch("https://id.jobstreet.com/search", 7), "https://id.jobstreet.com/search?daterange=7");
  assert.equal(jobstreetConfig.listingLinkSelector, 'a[data-testid="job-card-title"]');
  assert.equal(extractJobStreetDetails(`<script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: "Warehouse Associate",
    description: "<p>Deskripsi</p>",
  })}</script>`)?.job_description, "Deskripsi");
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
