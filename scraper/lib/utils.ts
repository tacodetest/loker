import type { JobLinkCandidate, JobSource } from "./types";

const trackingParameters = /^(utm_.+|type|ref|origin|source|tracking|traceinfo|campaign|gclid|fbclid)$/i;

export function sourceFromUrl(value: string): JobSource | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (host === "glints.com" || host.endsWith(".glints.com")) return "glints";
    return null;
  } catch {
    return null;
  }
}

export function normalizeJobUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port ||
      sourceFromUrl(url.toString()) !== sourceFromUrl(baseUrl)
    ) {
      return null;
    }
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (trackingParameters.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

export function limitUniqueJobLinks(candidates: JobLinkCandidate[], limit: number): JobLinkCandidate[] {
  const unique = new Map<string, JobLinkCandidate>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.job_link)) unique.set(candidate.job_link, candidate);
    if (unique.size >= limit) break;
  }
  return [...unique.values()];
}

export function cleanText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|section|article)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\n[ \t]+-/g, "\n-")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export async function sleepRandom(minMs: number, maxMs: number) {
  const delay = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
  await new Promise((resolve) => setTimeout(resolve, delay));
}

export async function retry<T>(work: () => Promise<T>, attempts: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function parseRelativeDate(value: string, now = new Date()): Date | null {
  const text = value.toLocaleLowerCase("id-ID").trim();
  const dated = text.match(/(\d{1,2})\s+(jan(?:uari)?|feb(?:ruari)?|mar(?:et)?|apr(?:il)?|mei|jun(?:i)?|jul(?:i)?|agu(?:stus)?|sep(?:tember)?|okt(?:ober)?|nov(?:ember)?|des(?:ember)?)\s+(\d{4})/);
  if (dated) {
    const months = ["jan", "feb", "mar", "apr", "mei", "jun", "jul", "agu", "sep", "okt", "nov", "des"];
    const month = months.findIndex((item) => dated[2].startsWith(item));
    if (month >= 0) return new Date(Number(dated[3]), month, Number(dated[1]));
  }
  if (/\b(today|hari ini|baru saja|just now)\b/.test(text)) return now;
  if (/\b(yesterday|kemarin)\b/.test(text)) return new Date(now.getTime() - 86_400_000);
  if (/\b(?:30\+|lebih dari 30)\s*(?:hari|days?)\b/.test(text)) {
    return new Date(now.getTime() - 31 * 86_400_000);
  }

  const match = text.match(/(\d+)\s*(menit|minute|minutes|jam|hour|hours|hari|day|days|minggu|week|weeks|bulan|month|months)\s*(?:yang lalu|lalu|ago)?/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  const days = /minggu|week/.test(unit) ? amount * 7
    : /bulan|month/.test(unit) ? amount * 30
      : /jam|hour|menit|minute/.test(unit) ? amount / 24
        : amount;
  return new Date(now.getTime() - days * 86_400_000);
}

export function findJobPostings(html: string): Array<Record<string, unknown>> {
  const jobs: Array<Record<string, unknown>> = [];
  const scripts = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, body] of scripts) {
    try {
      collectJobPostings(JSON.parse(body), jobs);
    } catch {
      continue;
    }
  }
  return jobs;
}

function collectJobPostings(value: unknown, jobs: Array<Record<string, unknown>>, depth = 0) {
  if (depth > 20 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectJobPostings(item, jobs, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
  if (types.includes("JobPosting")) jobs.push(record);
  for (const child of Object.values(record)) collectJobPostings(child, jobs, depth + 1);
}

export function isBlockedPage(html: string): boolean {
  return /\b(captcha|verify you are human|access denied|automated requests|unusual traffic)\b/i.test(html);
}
