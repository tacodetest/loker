import assert from "node:assert/strict";
import test from "node:test";
import { cleanText, findJobPostings, normalizeJobUrl, parseRelativeDate, sourceFromUrl } from "./utils";

test("source detection accepts JobStreet and Glints but rejects lookalike domains", () => {
  assert.equal(sourceFromUrl("https://id.jobstreet.com/jobs"), "jobstreet");
  assert.equal(sourceFromUrl("https://glints.com/id/opportunities"), "glints");
  assert.equal(sourceFromUrl("https://jobstreet.com.attacker.invalid/jobs"), null);
});

test("job URLs are canonicalized and tracking parameters are removed", () => {
  assert.equal(
    normalizeJobUrl("/job/123?type=standard&ref=search&utm_source=feed&lang=id", "https://id.jobstreet.com/search"),
    "https://id.jobstreet.com/job/123?lang=id",
  );
});

test("cleanText preserves paragraph and list boundaries", () => {
  assert.equal(cleanText("<p>Ringkasan</p><ul><li>Pertama</li><li>Kedua</li></ul>"), "Ringkasan\n- Pertama\n- Kedua");
});

test("relative dates produce an estimated date and reject unknown text", () => {
  const now = new Date("2026-10-29T00:00:00.000Z");
  assert.equal(parseRelativeDate("2 hari yang lalu", now)?.toISOString(), "2026-10-27T00:00:00.000Z");
  assert.equal(parseRelativeDate("30+ hari yang lalu", now)?.toISOString(), "2026-09-28T00:00:00.000Z");
  assert.equal(parseRelativeDate("tanggal tidak tersedia", now), null);
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
