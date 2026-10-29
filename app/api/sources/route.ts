import { spawn } from "node:child_process";
import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { getRequestUser } from "@/lib/auth";
import { getSourceUrl } from "@/lib/source-url";
import { db } from "@/lib/supabase";

const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

function runLocalScrape(ownerId: string, sourceUrl: string) {
  if (process.env.NODE_ENV === "production" || (process.env.GITHUB_REPOSITORY && process.env.GITHUB_TOKEN)) return false;
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const scraper = spawn(command, ["run", "scrape"], {
    cwd: process.cwd(),
    env: { ...process.env, SCRAPE_OWNER_ID: ownerId, SCRAPE_SOURCE_URL: sourceUrl },
    shell: process.platform === "win32",
    stdio: "ignore",
    windowsHide: true,
  });
  scraper.on("error", (error) => {
    console.error("[sources] Gagal menjalankan scraper lokal:", error);
  });
  scraper.unref();
  return true;
}

async function dispatchImmediateScrape(ownerId: string, sourceUrl: string) {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !token) return null;

  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/workflows/scrape.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: process.env.GITHUB_REF_NAME || "main",
        inputs: { owner_id: ownerId, source_url: sourceUrl },
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GitHub Actions gagal menerima permintaan scrape (${response.status})${body ? `: ${body}` : ""}`);
  }
  return true;
}
const sourceBody = z.object({ url: z.string().trim().min(1).max(2048) });
const refreshBody = z.object({ url: z.string().trim().min(1).max(2048) });
const replaceBody = z.object({
  oldUrl: z.string().trim().min(1).max(2048),
  newUrl: z.string().trim().min(1).max(2048),
});

function message(error: unknown) {
  return error instanceof Error ? error.message : "Terjadi kesalahan yang tidak diketahui.";
}

async function ensureLegacySource(ownerId: string, url: string) {
  const { error } = await db().from("sources").upsert(
    { owner_id: ownerId, url },
    { onConflict: "owner_id,url", ignoreDuplicates: true },
  );
  if (error) throw new Error(`Gagal menyiapkan sumber: ${error.message}`);
}

export async function GET(request: Request) {
  await connection();
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sesi login berakhir." }, { status: 401, ...noStore });
  try {
    const supabase = db();
    const { data: sources, error } = await supabase.from("saved_links")
      .select("id, url, source, is_active, last_scraped_at, last_status, last_error")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const urls = (sources ?? []).map((source) => source.url);
    const counts: Record<string, number> = {};
    for (let offset = 0; urls.length; offset += 1000) {
      const { data: relations, error: relationError } = await supabase.from("job_sources")
        .select("source_url").eq("owner_id", user.id).in("source_url", urls)
        .range(offset, offset + 999);
      if (relationError) throw new Error(relationError.message);
      for (const relation of relations ?? []) {
        counts[relation.source_url] = (counts[relation.source_url] ?? 0) + 1;
      }
      if (!relations || relations.length < 1000) break;
    }
    return NextResponse.json({
      sources: (sources ?? []).map((source) => ({ ...source, job_count: counts[source.url] ?? 0 })),
    }, noStore);
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500, ...noStore });
  }
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sesi login berakhir." }, { status: 401, ...noStore });
  const body: unknown = await request.json().catch(() => null);
  const parsed = sourceBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Masukkan URL pencarian JobStreet atau Glints." }, { status: 400, ...noStore });
  const sourceUrl = getSourceUrl(parsed.data.url);
  if (!sourceUrl) return NextResponse.json({ error: "URL harus berasal dari JobStreet atau Glints." }, { status: 400, ...noStore });

  try {
    const url = sourceUrl.url.toString();
    const { data, error } = await db().from("saved_links").insert({
      owner_id: user.id,
      url,
      source: sourceUrl.source,
      is_active: true,
    }).select("id").single();
    if (error?.code === "23505") {
      return NextResponse.json({ error: "URL tersebut sudah tersimpan." }, { status: 409, ...noStore });
    }
    if (error) throw new Error(error.message);
    await ensureLegacySource(user.id, url);
    let scrapeTriggered = false;
    let scrapeWarning: string | null = null;
    try {
      scrapeTriggered = runLocalScrape(user.id, url);
      if (!scrapeTriggered) scrapeTriggered = (await dispatchImmediateScrape(user.id, url)) === true;
    } catch (error) {
      scrapeWarning = message(error);
      console.error("[sources] Gagal memicu scrape langsung:", scrapeWarning);
    }
    return NextResponse.json({
      ok: true,
      id: data.id,
      scrapeTriggered,
      warning: scrapeWarning ?? (!scrapeTriggered && (!process.env.GITHUB_REPOSITORY || !process.env.GITHUB_TOKEN)
        ? "Konfigurasi GitHub Actions belum tersedia; scrape menunggu jadwal berikutnya."
        : null),
    }, { status: 201, ...noStore });
  } catch (error) {
    const errorText = message(error);
    console.error("[sources] Gagal menyimpan URL pencarian:", errorText);
    return NextResponse.json({ error: errorText }, { status: 500, ...noStore });
  }
}

export async function PATCH(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sesi login berakhir." }, { status: 401, ...noStore });
  const body: unknown = await request.json().catch(() => null);
  const parsed = refreshBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "URL tautan yang akan diperbarui tidak valid." }, { status: 400, ...noStore });
  const sourceUrl = getSourceUrl(parsed.data.url);
  if (!sourceUrl) return NextResponse.json({ error: "URL harus berasal dari JobStreet atau Glints." }, { status: 400, ...noStore });

  try {
    const url = sourceUrl.url.toString();
    const { data: savedLink, error } = await db().from("saved_links")
      .select("id")
      .eq("owner_id", user.id)
      .eq("url", url)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!savedLink) return NextResponse.json({ error: "Tautan aktif tidak ditemukan di akun ini." }, { status: 404, ...noStore });

    const started = runLocalScrape(user.id, url)
      || (await dispatchImmediateScrape(user.id, url)) === true;
    if (!started) {
      return NextResponse.json({
        error: "Scrape otomatis belum dikonfigurasi. Atur GITHUB_REPOSITORY dan GITHUB_TOKEN untuk menjalankannya di server.",
      }, { status: 503, ...noStore });
    }

    return NextResponse.json({
      ok: true,
      message: "Permintaan scrape diterima. Proses berjalan di latar belakang; Anda boleh meninggalkan halaman ini.",
    }, noStore);
  } catch (error) {
    const errorText = message(error);
    console.error("[sources] Gagal memulai scrape manual:", errorText);
    return NextResponse.json({ error: errorText }, { status: 500, ...noStore });
  }
}

export async function PUT(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sesi login berakhir." }, { status: 401, ...noStore });
  const body: unknown = await request.json().catch(() => null);
  const parsed = replaceBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Data penggantian URL tidak valid." }, { status: 400, ...noStore });
  const oldSource = getSourceUrl(parsed.data.oldUrl);
  const newSource = getSourceUrl(parsed.data.newUrl);
  if (!oldSource || !newSource) {
    return NextResponse.json({ error: "URL harus berasal dari JobStreet atau Glints." }, { status: 400, ...noStore });
  }
  const oldUrl = oldSource.url.toString();
  const newUrl = newSource.url.toString();
  if (oldUrl === newUrl) return NextResponse.json({ error: "URL baru harus berbeda." }, { status: 400, ...noStore });

  try {
    const { error } = await db().rpc("replace_saved_link_url", {
      p_owner_id: user.id,
      p_old_url: oldUrl,
      p_new_url: newUrl,
      p_new_source: newSource.source,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true }, noStore);
  } catch (error) {
    const errorText = message(error);
    console.error("[sources] Gagal mengganti URL pencarian:", errorText);
    return NextResponse.json({ error: errorText }, { status: 500, ...noStore });
  }
}

export async function DELETE(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sesi login berakhir." }, { status: 401, ...noStore });
  const parsedUrl = getSourceUrl(new URL(request.url).searchParams.get("url"));
  if (!parsedUrl) return NextResponse.json({ error: "URL harus berasal dari JobStreet atau Glints." }, { status: 400, ...noStore });
  const sourceUrl = parsedUrl.url.toString();

  try {
    const { error } = await db().rpc("delete_saved_link", {
      p_owner_id: user.id,
      p_source_url: sourceUrl,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true }, noStore);
  } catch (error) {
    const errorText = message(error);
    console.error("[sources] Gagal menghapus tautan:", errorText);
    return NextResponse.json({ error: errorText }, { status: 500, ...noStore });
  }
}
