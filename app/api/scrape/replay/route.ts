import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { parseJobs, getAllowedSourceUrl } from "@/lib/scrape";
import { saveScrapedJobs } from "@/lib/scrape-store";
import { isAdmin } from "@/lib/supabase";

export async function POST(req: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Route replay hanya tersedia di development" }, { status: 404 });
  }
  if (!isAdmin(req)) return NextResponse.json({ error: "Kunci admin salah" }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  const url = body && typeof body === "object" ? (body as { url?: unknown }).url : null;
  const target = getAllowedSourceUrl(url);
  if (!target) {
    if (typeof url !== "string" || !url.trim()) {
      return NextResponse.json({ error: "Tautan sumber JobStreet atau Glints diperlukan untuk replay" }, { status: 400 });
    }
    return NextResponse.json({ error: "Hanya tautan JobStreet dan Glints yang diterima" }, { status: 400 });
  }

  try {
    const filePath = path.join(process.cwd(), ".cache", "last-extract.json");
    let response: unknown;
    try {
      response = JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return NextResponse.json(
          { error: "Data replay belum tersedia. Letakkan JSON respons ScrapeGraphAI di .cache/last-extract.json." },
          { status: 404 },
        );
      }
      if (error instanceof SyntaxError) {
        return NextResponse.json({ error: ".cache/last-extract.json bukan JSON yang valid" }, { status: 400 });
      }
      throw error;
    }

    const rows = parseJobs(response, target.toString());
    await saveScrapedJobs(rows, target.toString());
    return NextResponse.json({ count: rows.length, replay: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memproses data replay";
    console.error("[scrape:replay] Proses replay gagal:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
