import { connection, NextResponse } from "next/server";
import { db, isAdmin } from "@/lib/supabase";
import { clearLastExtractCache, getAllowedSourceUrl } from "@/lib/scrape";

const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

export async function GET() {
  await connection(); // pastikan selalu dijalankan saat ada request, tidak di-cache
  try {
    const supabase = db();
    const { data, error } = await supabase
      .from("sources")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const counts: Record<string, number> = {};
    const linkedJobs = new Set<string>();
    let totalSourceJobs = 0;
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data: links, error: linksError } = await supabase
        .from("job_sources")
        .select("source_url, job_url")
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
      sources: (data ?? []).map((source) => ({
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

export async function POST(req: Request) {
  if (!isAdmin(req))
    return NextResponse.json({ error: "Kunci admin salah" }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  const urls = body && typeof body === "object" && "urls" in body
    ? (body as { urls?: unknown }).urls
    : null;
  if (!Array.isArray(urls) || urls.some((url) => typeof url !== "string")) {
    return NextResponse.json({ error: "Kirim daftar URL sebagai array teks." }, { status: 400 });
  }
  if (urls.length > 100) {
    return NextResponse.json({ error: "Maksimal 100 URL dapat ditambahkan sekaligus." }, { status: 400 });
  }

  const unique = [...new Set((urls as string[]).map((url) => url.trim()).filter(Boolean))];
  const valid = unique
    .map((value) => ({ value, url: getAllowedSourceUrl(value) }))
    .filter((entry): entry is { value: string; url: URL } => entry.url !== null)
    .map((entry) => entry.url.toString());
  const invalid = unique.filter((value) => !getAllowedSourceUrl(value));

  if (!valid.length) {
    return NextResponse.json(
      { error: "Tidak ada URL JobStreet atau Glints yang valid.", added: 0, invalid },
      { status: 400 },
    );
  }

  try {
    const supabase = db();
    const { data: existing, error: existingError } = await supabase
      .from("sources")
      .select("url")
      .in("url", valid);
    if (existingError) throw new Error(existingError.message);

    const existingUrls = new Set((existing ?? []).map((source) => source.url));
    const newUrls = valid.filter((url) => !existingUrls.has(url));
    if (newUrls.length) {
      const { error } = await supabase
        .from("sources")
        .insert(newUrls.map((url) => ({ url })));
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({
      added: newUrls.length,
      existing: valid.length - newUrls.length,
      invalid,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal menyimpan tautan.";
    console.error("[sources] Gagal menambahkan daftar tautan:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!isAdmin(req))
    return NextResponse.json({ error: "Kunci admin salah" }, { status: 401 });
  const url = new URL(req.url).searchParams.get("url");
  if (!url)
    return NextResponse.json({ error: "Tautan kosong" }, { status: 400 });
  try {
    await clearLastExtractCache();
    const { data, error } = await db().rpc("delete_source_with_orphans", {
      p_source_url: url,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, deletedJobs: data ?? 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal menghapus tautan.";
    console.error("[sources] Gagal menghapus tautan:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
