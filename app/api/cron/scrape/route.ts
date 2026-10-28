import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { AppUserId } from "@/lib/auth";
import { finishScrapeBatch } from "@/lib/finish-scrape-batch";
import { createFirecrawlBatch, getBatchScrapeStatus } from "@/lib/firecrawl";
import { db } from "@/lib/supabase";

export const maxDuration = 60;

const userIds: AppUserId[] = ["taufik", "alya"];

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return false;

  const submitted = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  return submitted.length === expected.length && timingSafeEqual(submitted, expected);
}

function getJakartaSlotKey(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(value("year"));
  const month = Number(value("month"));
  const day = Number(value("day"));
  const hour = Number(value("hour"));
  if (![year, month, day, hour].every(Number.isFinite)) {
    throw new Error("Tidak dapat menentukan jadwal waktu Asia/Jakarta.");
  }

  if (hour < 6) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+07:00`;
  }
  if (hour < 18) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00+07:00`;
  }

  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
  return `${nextDate.toISOString().slice(0, 10)}T00:00:00+07:00`;
}

async function claimScheduledRun(ownerId: AppUserId, slotKey: string) {
  const supabase = db();
  const { error: insertError } = await supabase.from("scheduled_scrape_runs").insert({
    owner_id: ownerId,
    slot_key: slotKey,
    status: "starting",
  });
  if (!insertError) return true;
  if (insertError.code !== "23505") {
    throw new Error(`Gagal mencatat jadwal scrape: ${insertError.message}`);
  }

  const { data: retryableRun, error: lookupError } = await supabase
    .from("scheduled_scrape_runs")
    .select("owner_id")
    .eq("owner_id", ownerId)
    .eq("slot_key", slotKey)
    .eq("status", "failed")
    .maybeSingle();
  if (lookupError) throw new Error(`Gagal memeriksa jadwal scrape: ${lookupError.message}`);
  if (!retryableRun) return false;

  const { data, error } = await supabase.from("scheduled_scrape_runs")
    .update({ status: "starting", batch_id: null, updated_at: new Date().toISOString() })
    .eq("owner_id", ownerId)
    .eq("slot_key", slotKey)
    .eq("status", "failed")
    .select("owner_id")
    .maybeSingle();
  if (error) throw new Error(`Gagal mencoba ulang jadwal scrape: ${error.message}`);
  return data !== null;
}

async function setScheduledRun(
  ownerId: AppUserId,
  slotKey: string,
  status: "started" | "skipped" | "failed",
  batchId?: string,
) {
  const { error } = await db().from("scheduled_scrape_runs")
    .update({
      status,
      batch_id: batchId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("owner_id", ownerId)
    .eq("slot_key", slotKey);
  if (error) throw new Error(`Gagal memperbarui catatan jadwal scrape: ${error.message}`);
}

async function startScheduledBatch(ownerId: AppUserId, slotKey: string, webhookUrl: string) {
  if (!await claimScheduledRun(ownerId, slotKey)) {
    return { ownerId, status: "already_started" as const, sourceCount: 0 };
  }

  const supabase = db();
  let batchId: string | null = null;
  try {
    const { data: activeBatch, error: activeBatchError } = await supabase.from("scrape_batches")
      .select("id, firecrawl_batch_id, requested_urls, replacements")
      .eq("owner_id", ownerId)
      .in("status", ["pending", "scraping"])
      .limit(1)
      .maybeSingle();
    if (activeBatchError) throw new Error(`Gagal memeriksa batch aktif: ${activeBatchError.message}`);
    if (activeBatch) {
      if (activeBatch.firecrawl_batch_id) {
        const progress = await getBatchScrapeStatus(
          activeBatch.firecrawl_batch_id,
          activeBatch.requested_urls,
        );
        if (progress.status !== "scraping") {
          await finishScrapeBatch({
            id: activeBatch.id,
            requested_urls: activeBatch.requested_urls,
            replacements: activeBatch.replacements as { from: string; to: string }[],
          }, ownerId, progress);
        } else {
          await setScheduledRun(ownerId, slotKey, "skipped");
          return { ownerId, status: "skipped_active_batch" as const, sourceCount: 0 };
        }
      } else {
        const { error: staleBatchError } = await supabase.from("scrape_batches")
          .update({
            status: "failed",
            outcome: { error: "Batch tidak memperoleh ID dari Firecrawl." },
            updated_at: new Date().toISOString(),
          })
          .eq("id", activeBatch.id)
          .eq("owner_id", ownerId);
        if (staleBatchError) {
          throw new Error(`Gagal menutup batch yang tidak lengkap: ${staleBatchError.message}`);
        }
      }
    }

    const { data: sources, error: sourcesError } = await supabase.from("sources")
      .select("url")
      .eq("owner_id", ownerId)
      .ilike("url", "%jobstreet.%")
      .order("created_at", { ascending: true })
      .limit(1001);
    if (sourcesError) throw new Error(`Gagal memuat tautan tersimpan: ${sourcesError.message}`);
    const urls = [...new Set((sources ?? []).map(({ url }) => url))];
    if (urls.length === 0) {
      await setScheduledRun(ownerId, slotKey, "skipped");
      return { ownerId, status: "no_saved_sources" as const, sourceCount: 0 };
    }
    if (urls.length > 1000) {
      throw new Error("Akun memiliki lebih dari 1.000 tautan; kurangi jumlah tautan sebelum scrape otomatis.");
    }

    batchId = randomUUID();
    const { error: insertError } = await supabase.from("scrape_batches").insert({
      id: batchId,
      owner_id: ownerId,
      requested_urls: urls,
      replacements: [],
      status: "pending",
      total: urls.length,
      completed: 0,
    });
    if (insertError) throw new Error(`Gagal membuat batch scrape: ${insertError.message}`);

    const firecrawlBatchId = await createFirecrawlBatch(urls, webhookUrl);
    const { error: updateError } = await supabase.from("scrape_batches")
      .update({
        firecrawl_batch_id: firecrawlBatchId,
        status: "scraping",
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId)
      .eq("owner_id", ownerId);
    if (updateError) throw new Error(`Gagal menyimpan ID batch Firecrawl: ${updateError.message}`);
    await setScheduledRun(ownerId, slotKey, "started", batchId);
    return { ownerId, status: "started" as const, sourceCount: urls.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scrape otomatis gagal.";
    if (batchId) {
      const { error: batchUpdateError } = await supabase.from("scrape_batches")
        .update({
          status: "failed",
          outcome: { error: message },
          updated_at: new Date().toISOString(),
        })
        .eq("id", batchId)
        .eq("owner_id", ownerId);
      if (batchUpdateError) {
        console.error("[cron] Gagal menandai batch sebagai gagal:", batchUpdateError.message);
      }
    }
    await setScheduledRun(ownerId, slotKey, "failed");
    throw error;
  }
}

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET belum dikonfigurasi." }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 401 });
  }

  const appBaseUrl = process.env.APP_BASE_URL;
  const webhookSecret = process.env.FIRECRAWL_WEBHOOK_SECRET;
  if (!appBaseUrl || !webhookSecret) {
    return NextResponse.json(
      { error: "APP_BASE_URL atau FIRECRAWL_WEBHOOK_SECRET belum dikonfigurasi." },
      { status: 503 },
    );
  }
  let webhookUrl: string;
  try {
    const appUrl = new URL(appBaseUrl);
    if (appUrl.protocol !== "https:" || !appUrl.hostname) throw new Error("APP_BASE_URL harus memakai HTTPS.");
    webhookUrl = new URL("/api/webhooks/firecrawl", appUrl).toString();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "APP_BASE_URL tidak valid." },
      { status: 503 },
    );
  }

  try {
    const slotKey = getJakartaSlotKey(new Date());
    const results = await Promise.all(userIds.map((ownerId) =>
      startScheduledBatch(ownerId, slotKey, webhookUrl),
    ));
    return NextResponse.json({ slot: slotKey, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scrape terjadwal gagal.";
    console.error("[cron] Gagal menjalankan scrape terjadwal:", message);
    return NextResponse.json({ error: "Scrape terjadwal gagal." }, { status: 500 });
  }
}
