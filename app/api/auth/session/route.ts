import { NextResponse } from "next/server";
import { refreshRequestSession, sessionCookieName, sessionLifetimeSeconds } from "@/lib/auth";

const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

export async function POST(request: Request) {
  try {
    const session = await refreshRequestSession(request);
    if (!session) {
      return NextResponse.json({ error: "Sesi login berakhir. Silakan masuk kembali." }, { status: 401, ...noStore });
    }

    const response = NextResponse.json({ user: session.user }, noStore);
    response.cookies.set(sessionCookieName, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: sessionLifetimeSeconds,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memeriksa sesi login.";
    console.error("[auth] Gagal memperbarui sesi:", message);
    return NextResponse.json({ error: "Sesi login tidak dapat diperiksa." }, { status: 503, ...noStore });
  }
}
