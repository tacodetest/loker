import { NextResponse } from "next/server";
import { getJobsPage } from "@/lib/jobs";

const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

export async function GET(req: Request) {
  const search = new URL(req.url).searchParams;
  const query = search.get("q")?.trim().slice(0, 100) ?? "";
  const rawPage = search.get("page");
  const parsedPage = rawPage === null ? undefined : Number(rawPage);
  const page = parsedPage !== undefined && Number.isInteger(parsedPage) && parsedPage > 0
    ? parsedPage
    : undefined;
  const rawPeriod = search.get("period");
  const period = rawPeriod === "today" || (rawPeriod === null && search.get("days") === "1")
    ? "today"
    : "all";

  try {
    const result = await getJobsPage({ search: query, page, period });
    return NextResponse.json(result, noStore);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memuat lowongan.";
    console.error("[jobs] API daftar lowongan gagal:", message);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}
