import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isAppUserId } from "@/lib/auth";
import { finishScrapeBatch } from "@/lib/finish-scrape-batch";
import { getBatchScrapeStatus } from "@/lib/firecrawl";
import { db } from "@/lib/supabase";

export const maxDuration = 60;

function signatureIsValid(body: Uint8Array, signature: string | null, secret: string) {
  if (!signature) return false;
  const [algorithm, hash] = signature.split("=", 2);
  if (algorithm !== "sha256" || !hash || !/^[a-f0-9]{64}$/i.test(hash)) return false;

  const submitted = Buffer.from(hash, "hex");
  const expected = createHmac("sha256", secret).update(body).digest();
  return submitted.length === expected.length && timingSafeEqual(submitted, expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function POST(request: Request) {
  const secret = process.env.FIRECRAWL_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook Firecrawl belum dikonfigurasi." }, { status: 503 });
  }

  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (!signatureIsValid(rawBody, request.headers.get("x-firecrawl-signature"), secret)) {
    return NextResponse.json({ error: "Tanda tangan webhook tidak valid." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody)) as unknown;
  } catch {
    return NextResponse.json({ error: "Payload webhook bukan JSON valid." }, { status: 400 });
  }
  if (!isRecord(payload) || typeof payload.type !== "string" || typeof payload.id !== "string") {
    return NextResponse.json({ error: "Payload webhook tidak lengkap." }, { status: 400 });
  }
  if (!payload.type.startsWith("batch_scrape.") || !/(completed|failed)$/.test(payload.type)) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const { data, error } = await db().from("scrape_batches")
      .select("id, owner_id, firecrawl_batch_id, requested_urls, replacements, status")
      .eq("firecrawl_batch_id", payload.id)
      .maybeSingle();
    if (error) throw new Error(`Gagal mencari batch webhook: ${error.message}`);
    if (!data) return NextResponse.json({ ok: true, ignored: true });
    if (!isAppUserId(data.owner_id)) throw new Error("Akun pemilik batch tidak valid.");
    if (data.status === "done" || data.status === "failed") {
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }

    const batch = {
      id: data.id,
      requested_urls: data.requested_urls,
      replacements: data.replacements as { from: string; to: string }[],
    };
    const progress = await getBatchScrapeStatus(payload.id, batch.requested_urls);
    if (progress.status === "scraping") {
      return NextResponse.json({ error: "Batch Firecrawl belum selesai." }, { status: 503 });
    }

    const result = await finishScrapeBatch(batch, data.owner_id, progress);
    return NextResponse.json({ ok: true, status: result.status, sources: result.sources });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memproses webhook Firecrawl.";
    console.error("[firecrawl-webhook] Gagal memproses hasil batch:", message);
    return NextResponse.json({ error: "Hasil scrape belum berhasil disimpan." }, { status: 500 });
  }
}
