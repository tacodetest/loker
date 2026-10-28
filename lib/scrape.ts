import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type ScrapedJob = {
  job_url: string;
  title: string;
  company: string | null;
  location: string | null;
  salary: string | null;
  description: string | null;
  posted_time: string | null;
  source_url: string;
  site: string;
  last_seen_at: string;
  scraped_at: string;
};

type JsonRecord = Record<string, unknown>;

const JOB_ARRAY_KEYS = ["jobs", "job_results", "results", "items", "listings", "vacancies", "positions", "data", "result", "json", "output"];
const JOBSTREET_DOMAINS = [
  "jobstreet.com",
  "jobstreet.com.au",
  "jobstreet.com.hk",
  "jobstreet.com.my",
  "jobstreet.com.ph",
  "jobstreet.com.sg",
  "jobstreet.com.vn",
  "jobstreet.co.id",
  "jobstreet.co.th",
  "jobstreet.co.nz",
];
const FIELD_ALIASES = {
  title: ["job_title", "jobTitle", "title", "position", "position_title", "name"],
  company: ["company_name", "companyName", "company", "employer"],
  location: ["location", "location_name"],
  salary: ["salary", "salary_range"],
  description: ["job_description", "jobDescription", "description", "summary"],
  link: ["job_link", "jobLink", "job_url", "jobUrl", "url", "link", "apply_url"],
  postedTime: ["posted_time"],
} as const;

export function getAllowedSourceUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const hostname = url.hostname.toLowerCase();
    if (url.username || url.password || url.port) return null;
    const isJobstreet = JOBSTREET_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
    if (!isJobstreet) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function cleanLink(link: string | null, base: string) {
  if (!link) return null;
  try {
    const url = new URL(link, base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ["gclid", "fbclid", "referrer"].includes(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function findJobArray(value: unknown, depth = 0): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (depth > 8) return null;

  const record = asRecord(value);
  if (!record) {
    if (typeof value === "string") {
      try {
        return findJobArray(JSON.parse(value), depth + 1);
      } catch {
        return null;
      }
    }
    return null;
  }

  const keys = Object.keys(record);
  for (const expected of JOB_ARRAY_KEYS) {
    const key = keys.find((candidate) => candidate.toLowerCase() === expected);
    if (key) {
      const found = findJobArray(record[key], depth + 1);
      if (found) return found;
    }
  }
  for (const child of Object.values(record)) {
    const found = findJobArray(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readText(record: JsonRecord, aliases: readonly string[]): string | null {
  const values = new Map(Object.entries(record).map(([key, value]) => [normalizedKey(key), value]));
  for (const alias of aliases) {
    const value = values.get(normalizedKey(alias));
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function responseDescription(value: unknown) {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = String(value);
  }
  const keys = asRecord(value) ? Object.keys(value as JsonRecord).join(", ") : "(tidak ada)";
  const type = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  return `tipe ${type}, key level atas [${keys}], cuplikan: ${serialized.slice(0, 500)}`;
}

function plainText(value: string | null) {
  if (!value) return null;
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000) || null;
}

export function parseJobs(response: unknown, sourceUrl: string): ScrapedJob[] {
  const list = findJobArray(response);
  const candidates = list ?? [];
  const now = new Date();
  const seen = new Set<string>();
  const rows: ScrapedJob[] = [];

  for (const candidate of candidates) {
    const job = asRecord(candidate);
    if (!job) continue;

    const link = cleanLink(readText(job, FIELD_ALIASES.link), sourceUrl);
    const title = readText(job, FIELD_ALIASES.title);
    if (!link || !getAllowedSourceUrl(link) || !title || seen.has(link)) continue;
    seen.add(link);

    const postedTime = readText(job, FIELD_ALIASES.postedTime);
    rows.push({
      job_url: link,
      title,
      company: plainText(readText(job, FIELD_ALIASES.company)),
      location: readText(job, FIELD_ALIASES.location),
      salary: readText(job, FIELD_ALIASES.salary),
      description: plainText(readText(job, FIELD_ALIASES.description)),
      posted_time: postedTime,
      source_url: sourceUrl,
      site: new URL(link).hostname.replace(/^www\./, ""),
      last_seen_at: now.toISOString(),
      scraped_at: now.toISOString(),
    });
  }

  console.info(`[scrape] Lowongan terbaca: ${rows.length} dari ${candidates.length} kandidat`);
  if (!rows.length) {
    const detail = responseDescription(response);
    const asyncHint = /\b(status|request_id|task_id|process_id)\b/i.test(detail)
      ? " Respons mungkin masih berupa status/ID proses yang memerlukan polling."
      : "";
    throw new Error(
      `Tidak ada lowongan valid yang dapat dibaca (${candidates.length} kandidat).${asyncHint} Respons diterima: ${detail}`,
    );
  }
  return rows;
}

export async function saveLastExtract(responseText: string, ownerId: "taufik" | "alya") {
  if (process.env.NODE_ENV !== "development") return;
  const cacheDirectory = path.join(process.cwd(), ".cache");
  await mkdir(cacheDirectory, { recursive: true });
  await writeFile(path.join(cacheDirectory, `last-extract-${ownerId}.json`), responseText, "utf8");
}

export async function clearLastExtractCache(ownerId: "taufik" | "alya") {
  try {
    await unlink(path.join(process.cwd(), ".cache", `last-extract-${ownerId}.json`));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}
