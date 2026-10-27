import { NextResponse } from "next/server";
import { getJobsPage } from "@/lib/jobs";

const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

export async function GET(req: Request) {
  const search = new URL(req.url).searchParams;
  const query = search.get("q")?.trim().slice(0, 100) ?? "";
  const cursor = search.get("cursor")?.slice(0, 4096) ?? undefined;

  try {
    const result = await getJobsPage({ search: query, cursor });
    return NextResponse.json(result, noStore);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memuat lowongan.";
    console.error("[jobs] API daftar lowongan gagal:", message);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}
