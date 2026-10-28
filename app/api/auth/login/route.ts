import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAppSession, sessionCookieName, sessionLifetimeSeconds, verifyCredentials } from "@/lib/auth";
import { db } from "@/lib/supabase";

const requestSchema = z.object({
  username: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(1024),
});

const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Masukkan username dan password." }, { status: 400, ...noStore });
  }

  const rateKey = createHash("sha256")
    .update(`login:${parsed.data.username.toLocaleLowerCase("id-ID")}`)
    .digest("hex");

  try {
    const { data: allowed, error: rateError } = await db().rpc("consume_scrape_rate_limit", {
      p_rate_key: rateKey,
      p_limit: 10,
      p_window_seconds: 60,
    });
    if (rateError) throw new Error(`Gagal memeriksa batas login: ${rateError.message}`);
    if (allowed !== true) {
      return NextResponse.json(
        { error: "Terlalu banyak percobaan login. Coba lagi satu menit lagi." },
        { status: 429, headers: { ...noStore.headers, "Retry-After": "60" } },
      );
    }

    const user = await verifyCredentials(parsed.data.username, parsed.data.password);
    if (!user) {
      return NextResponse.json({ error: "Username atau password salah." }, { status: 401, ...noStore });
    }

    const session = await createAppSession(user.id);
    if (!session.created) {
      return NextResponse.json(
        { error: `Akun ${user.name} sedang aktif di perangkat lain. Keluar dari sesi itu atau tunggu sampai sesi berakhir.` },
        { status: 409, ...noStore },
      );
    }

    const response = NextResponse.json({ user: { id: user.id, name: user.name } }, noStore);
    response.cookies.set(sessionCookieName, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: sessionLifetimeSeconds,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login tidak dapat diproses.";
    console.error("[auth] Gagal memproses login:", message);
    return NextResponse.json({ error: "Login tidak dapat diproses. Periksa konfigurasi server." }, { status: 503, ...noStore });
  }
}
