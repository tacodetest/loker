import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

export async function GET(req: Request) {
  const days = Math.min(
    Math.max(Number(new URL(req.url).searchParams.get("days")) || 3, 1),
    30,
  );
  const cutoff = Date.now() - days * 86400000;
  try {
    const { data, error } = await db()
      .from("jobs")
      .select("*")
      .order("posted_at", { ascending: false, nullsFirst: false })
      .limit(2000);
    if (error) throw new Error(error.message);
    const jobs = (data ?? []).filter(
      (j) => j.posted_at === null || Date.parse(j.posted_at) >= cutoff,
    );
    return NextResponse.json({ jobs }, noStore);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Gagal memuat" },
      { status: 500, ...noStore },
    );
  }
}
