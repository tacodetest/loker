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
  const rawDays = search.get("days");
  const parsedDays = rawDays === null ? undefined : Number(rawDays);
  const days = parsedDays !== undefined &&
      Number.isInteger(parsedDays) &&
      [1, 3, 7].includes(parsedDays)
    ? parsedDays
    : undefined;

  try {
    const result = await getJobsPage({ search: query, page, days });
    return NextResponse.json(result, noStore);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memuat lowongan.";
    console.error("[jobs] API daftar lowongan gagal:", message);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}
