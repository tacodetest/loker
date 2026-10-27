import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/supabase";
import { getAllowedSourceUrl, scrapeJobs } from "@/lib/scrape";
import { saveScrapedJobs } from "@/lib/scrape-store";

export const maxDuration = 330;

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Kunci admin salah" }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  const url = body && typeof body === "object" ? (body as { url?: unknown }).url : null;
  const target = getAllowedSourceUrl(url);
  if (!target) {
    if (typeof url !== "string" || !url.trim()) {
      return NextResponse.json({ error: "Tautan tidak valid" }, { status: 400 });
    }
    return NextResponse.json({ error: "Hanya tautan JobStreet dan Glints yang diterima" }, { status: 400 });
  }

  try {
    const rows = await scrapeJobs(target.toString());
    await saveScrapedJobs(rows, target.toString());
    return NextResponse.json({ count: rows.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gagal mengambil lowongan";
    console.error("[scrape] Proses scrape gagal:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
