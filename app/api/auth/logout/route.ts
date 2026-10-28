import { NextResponse } from "next/server";
import { revokeRequestSession, sessionCookieName } from "@/lib/auth";

const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

export async function POST(request: Request) {
  let failure: string | null = null;
  try {
    await revokeRequestSession(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal mengakhiri sesi login.";
    console.error("[auth] Gagal logout:", message);
    failure = "Sesi server belum dapat dicabut; jika login kembali ditolak, tunggu maksimal 30 menit.";
  }
  const response = NextResponse.json(
    failure ? { error: failure } : { ok: true },
    { status: failure ? 503 : 200, ...noStore },
  );
  response.cookies.set(sessionCookieName, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
