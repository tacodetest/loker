import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestUser } from "@/lib/auth";
import { createFirecrawlBatch, getBatchScrapeStatus } from "@/lib/firecrawl";
import { finishScrapeBatch, normalizedScrapeUrl, type SourceOutcome } from "@/lib/finish-scrape-batch";
import { getAllowedSourceUrl, saveLastExtract } from "@/lib/scrape";
import { db } from "@/lib/supabase";

export const maxDuration = 60;

const requestSchema = z.object({
  urls: z.array(z.string().trim().min(1).max(2048)).min(1).max(1000),
  replacements: z.array(z.object({
    from: z.string().trim().min(1).max(2048),
    to: z.string().trim().min(1).max(2048),
  })).max(1000).optional().default([]),
});

type BatchRow = {
  id: string;
  firecrawl_batch_id: string | null;
  requested_urls: string[];
  replacements: { from: string; to: string }[];
  status: "pending" | "scraping" | "done" | "failed";
  total: number;
  completed: number;
  outcome: { sources?: SourceOutcome[]; error?: string } | null;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Terjadi kesalahan yang tidak diketahui.";
}

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Sesi login berakhir." }, { status: 401 });
  if (!process.env.FIRECRAWL_API_KEY) {
    return NextResponse.json({ error: "FIRECRAWL_API_KEY belum diisi" }, { status: 500 });
  }

  const body: unknown = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Kirim 1 sampai 1.000 URL JobStreet dalam setiap permintaan." }, { status: 400 });
  }

  const urls = [...new Set(parsed.data.urls.map((value) => {
    const url = getAllowedSourceUrl(value);
    return url?.toString() ?? null;
  }))];
  if (urls.some((url) => url === null)) {
    return NextResponse.json({ error: "Hanya URL publik JobStreet yang diterima." }, { status: 400 });
  }
  const validUrls = urls.filter((url): url is string => url !== null);
  const replacements = parsed.data.replacements.map(({ from, to }) => ({
    from: getAllowedSourceUrl(from)?.toString() ?? null,
    to: getAllowedSourceUrl(to)?.toString() ?? null,
  }));
  if (
    replacements.some(({ from, to }) => !from || !to || from === to || !validUrls.includes(to))
  ) {
    return NextResponse.json({ error: "Data penggantian sumber tidak valid." }, { status: 400 });
  }

  const rateKey = createHash("sha256").update(`scrape:${user.id}`).digest("hex");
  try {
    const { data: allowed, error: rateError } = await db().rpc("consume_scrape_rate_limit", {
      p_rate_key: rateKey,
      p_limit: 5,
      p_window_seconds: 60,
    });
    if (rateError) throw new Error(rateError.message);
    if (allowed !== true) {
      return NextResponse.json(
        { error: "Batas scrape tercapai. Coba lagi dalam satu menit." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }

    const id = randomUUID();
    const { error: insertError } = await db().from("scrape_batches").insert({
      id,
      owner_id: user.id,
      requested_urls: validUrls,
      replacements,
      status: "pending",
      total: validUrls.length,
      completed: 0,
    });
    if (insertError) throw new Error(insertError.message);

    try {
      const firecrawlBatchId = await createFirecrawlBatch(validUrls);
      const { error: updateError } = await db()
        .from("scrape_batches")
        .update({
          firecrawl_batch_id: firecrawlBatchId,
          status: "scraping",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("owner_id", user.id);
      if (updateError) throw new Error(updateError.message);
      return NextResponse.json({ batchId: id, status: "pending", total: validUrls.length }, { status: 202 });
    } catch (error) {
      await db().from("scrape_batches")
        .update({
          status: "failed",
          outcome: { error: errorMessage(error) },
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("owner_id", user.id);
      throw error;
    }
  } catch (error) {
    const message = errorMessage(error);
    console.error("[scrape] Gagal memulai batch:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Sesi login berakhir." }, { status: 401 });
  const batchId = new URL(req.url).searchParams.get("batchId");

  try {
    if (!batchId) {
      const { data, error } = await db()
        .from("scrape_batches")
        .select("id, requested_urls, status, total, completed, created_at")
        .eq("owner_id", user.id)
        .in("status", ["pending", "scraping"])
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw new Error(error.message);
      return NextResponse.json({ batches: data ?? [] });
    }
    if (!/^[0-9a-f-]{36}$/i.test(batchId)) {
      return NextResponse.json({ error: "ID batch tidak valid." }, { status: 400 });
    }

    const { data, error } = await db()
      .from("scrape_batches")
      .select("id, firecrawl_batch_id, requested_urls, replacements, status, total, completed, outcome")
      .eq("id", batchId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Batch tidak ditemukan." }, { status: 404 });

    const batch = data as BatchRow;
    if (batch.status === "done" || batch.status === "failed") {
      return NextResponse.json({
        status: batch.status,
        total: batch.total,
        completed: batch.completed,
        sources: batch.outcome?.sources ?? [],
        error: batch.outcome?.error,
      });
    }
    if (!batch.firecrawl_batch_id) {
      return NextResponse.json({ status: "pending", total: batch.total, completed: batch.completed });
    }

    const progress = await getBatchScrapeStatus(batch.firecrawl_batch_id, batch.requested_urls);
    if (progress.status === "scraping") {
      const completed = Math.min(progress.completed, batch.total);
      const { error: updateError } = await db().from("scrape_batches")
        .update({ status: "scraping", completed, total: batch.total, updated_at: new Date().toISOString() })
        .eq("id", batch.id)
        .eq("owner_id", user.id);
      if (updateError) throw new Error(updateError.message);
      return NextResponse.json({ status: "scraping", total: batch.total, completed });
    }

    const result = await finishScrapeBatch(batch, user.id, progress);
    if (result.sources.length === 1 && result.sources[0].status === "done") {
      try {
        await saveLastExtract(JSON.stringify({
          jobs: progress.jobsBySource[normalizedScrapeUrl(result.sources[0].url)] ?? [],
        }), user.id);
      } catch (error) {
        console.error("[scrape] Gagal menyimpan cache replay lokal:", errorMessage(error));
      }
    }
    return NextResponse.json({
      status: result.status,
      total: batch.total,
      completed: result.sources.length,
      sources: result.sources,
    });
  } catch (error) {
    const message = errorMessage(error);
    console.error("[scrape] Gagal memeriksa batch:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
