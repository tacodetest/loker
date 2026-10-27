import "server-only";
import { z } from "zod";

export const FirecrawlJobSchema = z.object({
  job_url: z.string().url(),
  job_title: z.string().trim().min(1),
  company_name: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  job_description: z.string().nullable().optional(),
  posted_time: z.string().nullable(),
});

export const FirecrawlExtractionSchema = z.object({ jobs: z.array(FirecrawlJobSchema) });
const ExtractionResultSchema = z.object({ jobs: z.array(z.unknown()) });
const BatchStartSchema = z.object({
  success: z.literal(true),
  id: z.string().min(1),
});

const firecrawlSchema = { ...z.toJSONSchema(FirecrawlExtractionSchema) };
delete firecrawlSchema.$schema;

export type FirecrawlJob = z.infer<typeof FirecrawlJobSchema>;
export type FirecrawlBatchStatus = {
  status: "scraping" | "completed" | "failed" | "cancelled";
  completed: number;
  total: number;
  jobsBySource: Record<string, FirecrawlJob[]>;
  errorsBySource: Record<string, string>;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function retryable(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 4) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
      });
      if (!retryable(response.status) || attempt === attempts - 1) return response;
      await response.body?.cancel();
      lastError = new Error(`Firecrawl HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
    }

    const delay = Math.min(500 * 2 ** attempt, 4000) + Math.floor(Math.random() * 200);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error(
    `Firecrawl tidak dapat dihubungi setelah ${attempts} percobaan: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function readJson(response: Response): Promise<JsonRecord> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Firecrawl mengirim respons bukan JSON (HTTP ${response.status}).`);
  }
  const record = asRecord(body);
  if (!response.ok || !record || record.success === false) {
    const message = record && typeof record.error === "string" ? `: ${record.error}` : "";
    throw new Error(`Firecrawl HTTP ${response.status}${message}`);
  }
  return record;
}

function apiKey() {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY belum diisi");
  return key;
}

export async function createFirecrawlBatch(urls: string[]) {
  if (!urls.length) throw new Error("Setidaknya satu URL diperlukan.");
  const key = apiKey();
  const response = await fetch("https://api.firecrawl.dev/v2/batch/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      urls,
      formats: [
        {
          type: "json",
          schema: firecrawlSchema,
          prompt:
            "Ekstrak semua lowongan kerja yang tampil pada halaman hasil pencarian. Untuk setiap lowongan, posted_time WAJIB diisi dengan teks persis dari label umur/tanggal yang tercetak di bagian paling bawah kartu lowongan, misalnya '1 hari yang lalu', '6 jam yang lalu', '10 jam yang lalu', atau '5 days ago'. Periksa setiap kartu satu per satu; jangan melewatkan label yang terlihat di bagian bawah. Hanya isi posted_time null jika label memang tidak ada atau tidak terbaca pada kartu itu. Jangan mengambil tanggal dari halaman detail, metadata halaman, atau kartu lowongan lain; jangan mengubah, menghitung ulang, atau menebak waktunya. Keluarkan juga job_title, company_name, location, dan job_description. Keluarkan job_url sebagai URL absolut ke halaman detail. Isi teks biasa dan jangan menebak data lainnya.",
        },
      ],
      onlyMainContent: true,
      maxAge: 10 * 60 * 1000,
      maxConcurrency: 5,
      ignoreInvalidURLs: false,
    }),
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  const body = await readJson(response);
  const parsed = BatchStartSchema.safeParse(body);
  if (!parsed.success) throw new Error("Firecrawl tidak mengembalikan ID batch yang valid.");
  return parsed.data.id;
}

function getSourceUrl(item: JsonRecord, onlyUrl?: string) {
  const metadata = asRecord(item.metadata);
  const value = metadata?.sourceURL ?? metadata?.url ?? item.sourceURL;
  if (typeof value === "string") return canonicalUrl(value);
  return onlyUrl ? canonicalUrl(onlyUrl) : null;
}

function readExtraction(item: JsonRecord) {
  let extracted = item.json ?? item.extract ?? item.extracted;
  if (typeof extracted === "string") {
    try {
      extracted = JSON.parse(extracted) as unknown;
    } catch {
      console.warn("[firecrawl] Hasil batch berisi JSON ekstraksi yang tidak valid.");
      return null;
    }
  }
  const parsed = ExtractionResultSchema.safeParse(extracted);
  if (!parsed.success) {
    console.warn("[firecrawl] Respons batch tidak mengikuti struktur { jobs: [...] }.");
    return null;
  }
  const jobs: FirecrawlJob[] = [];
  let skipped = 0;
  for (const candidate of parsed.data.jobs) {
    const job = FirecrawlJobSchema.safeParse(candidate);
    if (job.success && ["http:", "https:"].includes(new URL(job.data.job_url).protocol)) {
      jobs.push({
        ...job.data,
        company_name: job.data.company_name ?? null,
        location: job.data.location ?? null,
        job_description: job.data.job_description ?? null,
        posted_time: job.data.posted_time ?? null,
      });
    } else {
      skipped += 1;
    }
  }
  if (skipped) {
    console.warn(`[firecrawl] Mengabaikan ${skipped} hasil lowongan yang tidak valid.`);
    return null;
  }
  return jobs;
}

function validateNextUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "api.firecrawl.dev") {
    throw new Error("URL pagination Firecrawl tidak valid.");
  }
  return url.toString();
}

export async function getBatchScrapeStatus(
  batchId: string,
  sourceUrls: string[],
): Promise<FirecrawlBatchStatus> {
  const key = apiKey();
  let statusUrl = `https://api.firecrawl.dev/v2/batch/scrape/${encodeURIComponent(batchId)}`;
  let status = "scraping";
  let completed = 0;
  let total = sourceUrls.length;
  const jobsBySource: Record<string, FirecrawlJob[]> = {};
  const errorsBySource: Record<string, string> = {};
  const onlyUrl = sourceUrls.length === 1 ? sourceUrls[0] : undefined;
  let pageCount = 0;

  while (statusUrl) {
    if (++pageCount > 100) throw new Error("Hasil batch Firecrawl melebihi batas pagination.");
    const response = await fetchWithRetry(statusUrl, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = await readJson(response);
    if (typeof body.status === "string") status = body.status;
    if (typeof body.completed === "number") completed = body.completed;
    if (typeof body.total === "number") total = body.total;

    const data = Array.isArray(body.data) ? body.data : [];
    for (const value of data) {
      const item = asRecord(value);
      if (!item) continue;
      const sourceUrl = getSourceUrl(item, onlyUrl);
      if (!sourceUrl) continue;
      const jobs = readExtraction(item);
      if (!jobs) {
        errorsBySource[sourceUrl] = "Hasil structured JSON Firecrawl tidak valid; data lama tidak diubah.";
        continue;
      }
      jobsBySource[sourceUrl] = [...(jobsBySource[sourceUrl] ?? []), ...jobs];
    }

    statusUrl = typeof body.next === "string" && status !== "scraping"
      ? validateNextUrl(body.next)
      : "";
  }

  if (status === "completed" || status === "failed" || status === "cancelled") {
    try {
      const errorsResponse = await fetchWithRetry(
      `https://api.firecrawl.dev/v2/batch/scrape/${encodeURIComponent(batchId)}/errors`,
      { headers: { Authorization: `******` } },
    );
      const errorsBody = await readJson(errorsResponse);
      if (Array.isArray(errorsBody.errors)) {
        for (const value of errorsBody.errors) {
          const error = asRecord(value);
          if (typeof error?.url === "string") {
            errorsBySource[canonicalUrl(error.url)] =
              typeof error.error === "string" ? error.error : "Gagal mengambil halaman.";
          }
        }
      }
    } catch (error) {
      console.error(
        "[firecrawl] Gagal mengambil rincian error batch; hasil sukses tetap dapat disimpan:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const validStatuses = ["scraping", "completed", "failed", "cancelled"] as const;
  if (!validStatuses.includes(status as typeof validStatuses[number])) {
    throw new Error(`Status batch Firecrawl tidak dikenal: ${status}`);
  }

  return {
    status: status as FirecrawlBatchStatus["status"],
    completed,
    total,
    jobsBySource,
    errorsBySource,
  };
}
