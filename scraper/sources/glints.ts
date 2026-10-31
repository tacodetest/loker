import type { JobDetails, JobLinkCandidate } from "../lib/types";
import { cleanText, findJobPostings, normalizeJobUrl } from "../lib/utils";

export const glintsConfig = {
  listingLinkSelector: 'a[aria-label^="Job card title:"]',
  detailSelectors: {
    title: 'h1',
  },
  dateFields: ["createdAt", "datePosted", "postedAt"] as const,
  updatedAtFields: ["updatedAt"] as const,
  relativeDatePattern: /\b(?:hari ini|kemarin|\d+\s*(?:menit|jam|hari|minggu|day|days|week|weeks)\s*(?:yang lalu|lalu|ago)?|30\+\s*(?:hari|days?))\b/i,
  latestFilter: "", // TODO: confirm Glints' supported newest/date filter from the captured HTML.
};

export type GlintsListingJob = {
  id: string;
  createdAt: string | null;
};

type GlintsNextData = {
  props?: {
    pageProps?: {
      initialData?: { data?: unknown };
      initialJobs?: { jobsInPage?: unknown };
    };
  };
};

export function normalizeSearchUrl(input: string) {
  const url = new URL(input);
  if (glintsConfig.latestFilter && !url.searchParams.has(glintsConfig.latestFilter)) {
    url.searchParams.set(glintsConfig.latestFilter, "7");
  }
  return url.toString();
}

export function extractInitialJobs(html: string): GlintsListingJob[] {
  const jobs = parseNextData(html)?.props?.pageProps?.initialJobs?.jobsInPage;
  if (!Array.isArray(jobs)) return [];
  return jobs.flatMap((value) => {
    const record = asObject(value);
    if (!record || typeof record.id !== "string") return [];
    return [{ id: record.id, createdAt: parseDate(record.createdAt) }];
  });
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

export function extractListingLinksFromBrowser(
  links: Array<{ href: string }>,
  baseUrl: string,
  listedJobs: GlintsListingJob[] = [],
  includeUnlisted = false,
) {
  const unique = new Map<string, JobLinkCandidate>();
  const jobsById = new Map(listedJobs.map((job) => [job.id, job]));
  for (const link of links) {
    const jobLink = normalizeJobUrl(link.href, baseUrl);
    const id = jobLink?.match(/\/([0-9a-f]{8}-[0-9a-f-]{27,})(?:[/?#]|$)/i)?.[1];
    if (!jobLink || !id || (!includeUnlisted && !jobsById.has(id))) continue;
    unique.set(jobLink, { job_link: jobLink, posted_at_hint: jobsById.get(id)?.createdAt ?? null });
  }
  return [...unique.values()];
}

export function extractDetailsFromNextData(html: string): Partial<JobDetails> | null {
  const data = asObject(parseNextData(html)?.props?.pageProps?.initialData?.data);
  if (!data) return null;

  const description = parseDraftDescription(data.descriptionJsonString);
  const company = asObject(data.company);
  const location = asObject(data.location);
  const parents = Array.isArray(location?.parents)
    ? location.parents.map((value) => text(asObject(value)?.formattedName)).filter((value): value is string => Boolean(value))
    : [];
  const locationNames = [text(location?.formattedName), ...parents]
    .filter((value): value is string => Boolean(value));
  const salary = asObject(Array.isArray(data.salaries) ? data.salaries[0] : null);
  const postedAt = parseDate(data.createdAt);

  return {
    job_title: text(data.title) ?? undefined,
    company_name: text(company?.displayName) ?? text(company?.name),
    location: [...new Set(locationNames)].join(", ") || null,
    salary: formatSalaryFromNextData(salary),
    employment_type: formatEmploymentType(text(data.type)),
    posted_at: postedAt,
    posted_at_source: postedAt ? "exact" : "unknown",
    job_description: description,
  };
}

function parseNextData(html: string): GlintsNextData | null {
  const match = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as GlintsNextData;
  } catch {
    return null;
  }
}

function parseDraftDescription(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    const record = asObject(parsed);
    if (!Array.isArray(record?.blocks)) return null;
    const lines = record.blocks.flatMap((block) => {
      const item = asObject(block);
      if (typeof item?.text !== "string" || !item.text.trim()) return [];
      return [typeof item.type === "string" && item.type.includes("list-item")
        ? `- ${item.text.trim()}`
        : item.text.trim()];
    });
    return cleanText(lines.join("\n")) || null;
  } catch {
    return null;
  }
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function formatEmploymentType(value: string | null): string | null {
  if (!value) return null;
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatSalaryFromNextData(value: Record<string, unknown> | null): string | null {
  if (!value) return null;
  const minimum = numericText(value.minAmount);
  const maximum = numericText(value.maxAmount);
  if (!minimum && !maximum) return null;
  const range = minimum && maximum ? `${minimum}-${maximum}` : minimum ?? maximum;
  const currency = text(value.CurrencyCode);
  const frequency = text(value.salaryMode);
  return [range, currency, frequency?.toLowerCase()].filter(Boolean).join(" ");
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
