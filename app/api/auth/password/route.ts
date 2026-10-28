import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { changePassword, getRequestUser } from "@/lib/auth";
import { db } from "@/lib/supabase";

const requestSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(12).max(1024),
});

const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

export async function POST(request: Request) {
  let user: Awaited<ReturnType<typeof getRequestUser>>;
  try {
    user = await getRequestUser(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sesi login tidak dapat diperiksa.";
    console.error("[auth] Gagal memeriksa sesi untuk perubahan password:", message);
    return NextResponse.json({ error: "Sesi login tidak dapat diperiksa." }, { status: 503, ...noStore });
  }
  if (!user) {
    return NextResponse.json({ error: "Sesi login berakhir. Silakan masuk kembali." }, { status: 401, ...noStore });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Password baru harus berisi minimal 12 karakter." },
      { status: 400, ...noStore },
    );
  }
  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return NextResponse.json(
      { error: "Password baru harus berbeda dari password saat ini." },
      { status: 400, ...noStore },
    );
  }

  const rateKey = createHash("sha256").update(`password-change:${user.id}`).digest("hex");
  try {
    const { data: allowed, error: rateError } = await db().rpc("consume_scrape_rate_limit", {
      p_rate_key: rateKey,
      p_limit: 5,
      p_window_seconds: 300,
    });
    if (rateError) throw new Error(`Gagal memeriksa batas perubahan password: ${rateError.message}`);
    if (allowed !== true) {
      return NextResponse.json(
        { error: "Terlalu banyak percobaan. Coba lagi dalam lima menit." },
        { status: 429, headers: { ...noStore.headers, "Retry-After": "300" } },
      );
    }

    const updated = await changePassword(user.id, parsed.data.currentPassword, parsed.data.newPassword);
    if (!updated) {
      return NextResponse.json({ error: "Password saat ini tidak sesuai." }, { status: 401, ...noStore });
    }
    return NextResponse.json({ ok: true }, noStore);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Password tidak dapat diganti.";
    console.error("[auth] Gagal mengganti password:", message);
    return NextResponse.json(
      { error: "Password tidak dapat diganti. Periksa konfigurasi server." },
      { status: 503, ...noStore },
    );
  }
}
