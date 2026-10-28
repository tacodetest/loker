import { connection, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { clearLastExtractCache, getAllowedSourceUrl } from "@/lib/scrape";
import { removeSource } from "@/lib/scrape-store";

const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

export async function GET(request: Request) {
  await connection(); // pastikan selalu dijalankan saat ada request, tidak di-cache
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sesi login berakhir." }, { status: 401, ...noStore });
  try {
    const supabase = db();
    const { data, error } = await supabase
      .from("sources")
      .select("*")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const jobstreetSources = (data ?? []).filter((source) => getAllowedSourceUrl(source.url));
    const sourceUrls = jobstreetSources.map((source) => source.url);
    const counts: Record<string, number> = {};
    const linkedJobs = new Set<string>();
    let totalSourceJobs = 0;
    const pageSize = 1000;
    for (let offset = 0; sourceUrls.length > 0; offset += pageSize) {
      const { data: links, error: linksError } = await supabase
        .from("job_sources")
        .select("source_url, job_url")
        .eq("owner_id", user.id)
        .in("source_url", sourceUrls)
        .range(offset, offset + pageSize - 1);
      if (linksError) throw new Error(linksError.message);
      for (const link of links ?? []) {
        counts[link.source_url] = (counts[link.source_url] ?? 0) + 1;
        linkedJobs.add(link.job_url);
        totalSourceJobs += 1;
      }
      if (!links || links.length < pageSize) break;
    }
    return NextResponse.json({
      sources: jobstreetSources.map((source) => ({
        ...source,
        job_count: counts[source.url] ?? 0,
      })),
      total_job_count: linkedJobs.size,
      total_source_job_count: totalSourceJobs,
    }, noStore);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Gagal memuat" },
      { status: 500, ...noStore },
    );
  }
}

export async function DELETE(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Sesi login berakhir." }, { status: 401, ...noStore });
  const url = new URL(req.url).searchParams.get("url");
  const target = getAllowedSourceUrl(url);
  if (!target)
    return NextResponse.json({ error: "Hanya URL JobStreet yang dapat dihapus." }, { status: 400 });
  try {
    const deletedJobs = await removeSource(target.toString(), user.id);
    await clearLastExtractCache(user.id);
    return NextResponse.json({ ok: true, deletedJobs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal menghapus tautan.";
    console.error("[sources] Gagal menghapus tautan:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
