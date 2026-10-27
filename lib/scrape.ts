import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parsePostedAt } from "./posted";

const PROMPT =
  "Ekstrak semua lowongan kerja dari halaman ini. Jangan menebak atau menyimpulkan tanggal posting; isi posted_text hanya jika tanggal atau teks waktu posting terlihat jelas, selain itu kosongkan. " +
  "Untuk setiap lowongan berikan: job_title, company_name, location, " +
  "salary (jika ada), job_description (ringkasan singkat), job_link (URL absolut ke halaman detail lowongan), dan " +
  "posted_text (teks waktu posting persis seperti tertulis di kartu lowongan, misalnya '3 hari yang lalu' atau '2d ago'; kosongkan jika tidak ada).";

const str = { type: "string" };
const SCHEMA = {
  type: "object",
  properties: {
    jobs: {
      type: "array",
      items: {
        type: "object",
        properties: { job_title: str, company_name: str, location: str, salary: str, job_description: str, job_link: str, posted_text: str },
        required: ["job_title", "job_link"],
      },
    },
  },
  required: ["jobs"],
};

export type ScrapedJob = {
  job_url: string;
  title: string;
  company: string | null;
  location: string | null;
  salary: string | null;
  description: string | null;
  posted_text: string | null;
  posted_at: string | null;
  source_url: string;
  site: string;
  last_seen_at: string;
};

type JsonRecord = Record<string, unknown>;

const JOB_ARRAY_KEYS = ["jobs", "job_results", "results", "items", "listings", "vacancies", "positions", "data", "result", "json", "output"];
const FIELD_ALIASES = {
  title: ["job_title", "jobTitle", "title", "position", "position_title", "name"],
  company: ["company_name", "companyName", "company", "employer"],
  location: ["location", "location_name"],
  salary: ["salary", "salary_range"],
  description: ["job_description", "jobDescription", "description", "summary"],
  link: ["job_link", "jobLink", "job_url", "jobUrl", "url", "link", "apply_url"],
  posted: ["posted_text", "postedText", "posting_date", "posted_at", "date_posted", "posted"],
} as const;

export function getAllowedSourceUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (!/(^|\.)(jobstreet\.[a-z.]+|glints\.com)$/.test(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function cleanLink(link: string | null, base: string) {
  if (!link) return null;
  try {
    const url = new URL(link, base);
    url.search = "";
    url.hash = "";
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
    if (!link || !title || seen.has(link)) continue;
    seen.add(link);

    const postedText = readText(job, FIELD_ALIASES.posted);
    rows.push({
      job_url: link,
      title,
      company: readText(job, FIELD_ALIASES.company),
      location: readText(job, FIELD_ALIASES.location),
      salary: readText(job, FIELD_ALIASES.salary),
      description: readText(job, FIELD_ALIASES.description),
      posted_text: postedText,
      posted_at: parsePostedAt(postedText, now)?.toISOString() ?? null,
      source_url: sourceUrl,
      site: new URL(link).hostname.replace(/^www\./, ""),
      last_seen_at: now.toISOString(),
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

async function saveLastExtract(responseText: string) {
  if (process.env.NODE_ENV !== "development") return;
  const cacheDirectory = path.join(process.cwd(), ".cache");
  await mkdir(cacheDirectory, { recursive: true });
  await writeFile(path.join(cacheDirectory, "last-extract.json"), responseText, "utf8");
}

export async function scrapeJobs(url: string): Promise<ScrapedJob[]> {
  const key = process.env.SGAI_API_KEY;
  if (!key) throw new Error("SGAI_API_KEY belum diisi");

  const controller = new AbortController();
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), 300_000);
  let response: Response;
  let responseText: string;

  try {
    response = await fetch("https://v2-api.scrapegraphai.com/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json", "SGAI-APIKEY": key },
      body: JSON.stringify({ url, prompt: PROMPT, schema: SCHEMA }),
      cache: "no-store",
      signal: controller.signal,
    });
    responseText = await response.text();
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error(`[scrape] ScrapeGraphAI HTTP status tidak tersedia; durasi ${durationMs}ms`);
    if (controller.signal.aborted) {
      throw new Error("ScrapeGraphAI tidak merespons dalam 5 menit; proses dibatalkan. Data sebelumnya tetap tersimpan. Coba lagi nanti.");
    }
    throw new Error(`Gagal menghubungi ScrapeGraphAI: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }

  const durationMs = Date.now() - startedAt;
  let body: unknown;
  try {
    body = JSON.parse(responseText);
  } catch {
    body = responseText;
  }
  const topLevel = asRecord(body);
  const responseType = Array.isArray(body) ? "array" : body === null ? "null" : typeof body;
  console.info(
    `[scrape] ScrapeGraphAI HTTP ${response.status}; durasi ${durationMs}ms; tipe ${responseType}; key level atas [${topLevel ? Object.keys(topLevel).join(", ") : ""}]`,
  );

  try {
    await saveLastExtract(responseText);
  } catch (error) {
    console.error("[scrape] Gagal menyimpan .cache/last-extract.json:", error);
    throw new Error(`Respons diterima, tetapi gagal menyimpan salinan lokal: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    throw new Error(`ScrapeGraphAI HTTP ${response.status}: ${responseText.slice(0, 500)}`);
  }
  if (typeof body === "string") {
    throw new Error(`Respons ScrapeGraphAI bukan JSON yang valid: ${responseText.slice(0, 500)}`);
  }
  return parseJobs(body, url);
}
