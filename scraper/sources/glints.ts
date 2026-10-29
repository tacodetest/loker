import type { JobDetails, JobLinkCandidate } from "../lib/types";
import { cleanText, findJobPostings, normalizeJobUrl } from "../lib/utils";

export const glintsConfig = {
  listingLinkSelector: 'a[aria-label^="Job card title:"]',
  detailSelectors: {
    title: 'h1',
    company: '[data-testid="company-name"], a[href*="/companies/"]',
    location: '[data-testid="location"], [data-testid="job-location"]',
    salary: '[data-testid="salary"], [data-testid="salary-range"]',
    employmentType: '[data-testid="employment-type"], [data-testid="job-type"]',
    postedAt: '[data-testid="posted-date"]',
    description: '[data-testid="job-description"], [data-testid="job-detail-description"]',
  },
  dateFields: ["createdAt", "datePosted", "postedAt"] as const,
  updatedAtFields: ["updatedAt"] as const,
  relativeDatePattern: /\b(?:hari ini|kemarin|\d+\s*(?:menit|jam|hari|minggu|day|days|week|weeks)\s*(?:yang lalu|lalu|ago)?|30\+\s*(?:hari|days?))\b/i, // TODO: verify against captured Glints detail HTML.
  latestFilter: "", // TODO: confirm Glints' supported newest/date filter from the captured HTML.
};

export function normalizeSearchUrl(input: string) {
  const url = new URL(input);
  if (glintsConfig.latestFilter && !url.searchParams.has(glintsConfig.latestFilter)) {
    url.searchParams.set(glintsConfig.latestFilter, "7");
  }
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
    salary: formatSalary(salaryValue ?? salary?.value, text(salary?.currency)),
    employment_type: text(job.employmentType),
    posted_at: postedAt,
    posted_at_source: postedAt ? "exact" : "unknown",
    job_description: description,
  };
}

export function extractListingLinksFromBrowser(links: Array<{ href: string; postedAt?: string }>, baseUrl: string) {
  const unique = new Map<string, JobLinkCandidate>();
  for (const link of links) {
    const jobLink = normalizeJobUrl(link.href, baseUrl);
    if (jobLink) unique.set(jobLink, { job_link: jobLink, posted_at_hint: parseDate(link.postedAt) });
  }
  return [...unique.values()];
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

function formatSalary(value: unknown, currency: string | null): string | null {
  const salary = asObject(value);
  if (!salary) return text(value);
  const minimum = numericText(salary.minValue);
  const maximum = numericText(salary.maxValue);
  if (!minimum && !maximum) return text(salary.value);
  const range = minimum && maximum ? `${minimum}-${maximum}` : minimum ?? maximum;
  return currency && range ? `${range} ${currency}` : range;
}

function numericText(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("id-ID").format(value) : null;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return cleanText(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return value.map(text).find((item) => item !== null) ?? null;
  return null;
}
