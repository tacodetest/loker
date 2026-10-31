import type { JobDetails, JobLinkCandidate } from "../lib/types";
import { cleanText, findJobPostings, findSeekListedAtById, normalizeJobUrl } from "../lib/utils";

export const jobstreetConfig = {
  listingLinkSelector: 'a[data-testid="job-card-title"]',
  detailSelectors: {
    title: '[data-automation="job-detail-title"]',
    company: '[data-automation="advertiser-name"]',
    location: '[data-automation="job-detail-location"]',
    salary: '[data-automation="job-detail-salary"], [data-automation="job-detail-salary-information"], span:has-text("Rp")',
    employmentType: '[data-automation="job-detail-work-type"]',
    postedAt: 'span:has-text("Diposting")',
    description: '[data-automation="jobAdDetails"]',
  },
  dateFields: ["createdAt", "datePosted", "postedAt", "listedAt", "dateTimeUtc"] as const,
  updatedAtFields: ["updatedAt"] as const,
  relativeDatePattern: /\b(?:hari ini|kemarin|\d+\s*(?:menit|jam|hari|minggu|day|days|week|weeks)\s*(?:yang lalu|lalu|ago)?|30\+\s*(?:hari|days?))\b/i,
};

export function normalizeSearchUrl(input: string, days: number) {
  const url = new URL(input);
  if (!url.searchParams.has("daterange")) url.searchParams.set("daterange", String(days));
  return url.toString();
}

export function extractListingLinks(html: string, baseUrl: string): JobLinkCandidate[] {
  const jobs = findJobPostings(html);
  const urls = new Map<string, JobLinkCandidate>();
  for (const job of jobs) {
    const rawUrl = typeof job.url === "string"
      ? job.url
      : typeof job.url === "object" && job.url !== null && "@id" in job.url
        ? String((job.url as { "@id": unknown })["@id"])
        : null;
    const url = normalizeJobUrl(rawUrl, baseUrl);
    if (url) urls.set(url, { job_link: url, posted_at_hint: parseDate(job.datePosted) });
  }
  return [...urls.values()];
}

export function extractListingLinksFromBrowser(
  links: Array<{ href: string; postedAt?: string }>,
  baseUrl: string,
  html: string,
) {
  const listedAtById = findSeekListedAtById(html);
  const unique = new Map<string, JobLinkCandidate>();
  for (const link of links) {
    const jobLink = normalizeJobUrl(link.href, baseUrl);
    if (!jobLink) continue;
    const jobId = jobLink.match(/\/job\/(\d+)(?:[/?#]|$)/i)?.[1];
    unique.set(jobLink, {
      job_link: jobLink,
      posted_at_hint: parseDate(link.postedAt) ?? (jobId ? listedAtById.get(jobId) ?? null : null),
    });
  }
  return [...unique.values()];
}

export function extractDetailsFromJsonLd(html: string): JobDetails | null {
  const job = findJobPostings(html)[0];
  if (!job) return null;

  const organization = asObject(job.hiringOrganization);
  const locationValue = Array.isArray(job.jobLocation) ? job.jobLocation[0] : job.jobLocation;
  const address = asObject(asObject(locationValue)?.address);
  const salary = asObject(job.baseSalary);
  const salaryValue = asObject(salary?.value);
  const description = typeof job.description === "string" ? cleanText(job.description) : null;
  const postedAt = parseDate(job.datePosted);
  const jobTitle = text(job.title);
  if (!jobTitle) return null;

  return {
    job_title: jobTitle,
    company_name: text(organization?.name),
    location: [text(address?.addressLocality), text(address?.addressRegion), text(address?.addressCountry)]
      .filter(Boolean).join(", ") || text(asObject(locationValue)?.name),
    salary: text(salaryValue?.value) ?? text(salary?.value),
    employment_type: text(job.employmentType),
    posted_at: postedAt,
    posted_at_source: postedAt ? "exact" : "unknown",
    job_description: description,
  };
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return cleanText(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return value.map(text).find((item) => item !== null) ?? null;
  return null;
}
