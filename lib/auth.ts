import "server-only";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./supabase";

export const sessionCookieName = "loker_session";
export const sessionLifetimeSeconds = 30 * 60;

export type AppUserId = "taufik" | "alya";
export type AppUser = { id: AppUserId; name: string };

const users: Record<AppUserId, AppUser> = {
  taufik: { id: "taufik", name: "Taufik" },
  alya: { id: "alya", name: "Alya" },
};

function isAppUserId(value: unknown): value is AppUserId {
  return value === "taufik" || value === "alya";
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getPassword(userId: AppUserId) {
  const password = userId === "taufik"
    ? process.env.TAUFIK_PASSWORD
    : process.env.ALYA_PASSWORD;
  if (!password) throw new Error(`Password akun ${users[userId].name} belum dikonfigurasi di environment.`);
  return password;
}

export function verifyCredentials(username: string, password: string): AppUser | null {
  const normalizedUsername = username.trim().toLocaleLowerCase("id-ID");
  if (!isAppUserId(normalizedUsername)) return null;

  const expected = getPassword(normalizedUsername);
  const submittedHash = scryptSync(password, `loker-login:${normalizedUsername}:v1`, 64);
  const expectedHash = scryptSync(expected, `loker-login:${normalizedUsername}:v1`, 64);
  return timingSafeEqual(submittedHash, expectedHash) ? users[normalizedUsername] : null;
}

export async function createAppSession(userId: AppUserId) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const { data, error } = await db().rpc("create_app_session", {
    p_id: randomUUID(),
    p_user_id: userId,
    p_token_hash: tokenHash,
    p_expires_at: new Date(Date.now() + sessionLifetimeSeconds * 1000).toISOString(),
  });
  if (error) throw new Error(`Gagal membuat sesi login: ${error.message}`);
  return { token, created: data === true };
}

function readCookie(header: string | null) {
  if (!header) return null;
  const cookie = header.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookieName}=`));
  if (!cookie) return null;
  const value = cookie.slice(sessionCookieName.length + 1);
  return value && /^[A-Za-z0-9_-]{40,60}$/.test(value) ? value : null;
}

async function touchToken(token: string): Promise<AppUser | null> {
  const { data, error } = await db().rpc("touch_app_session", { p_token_hash: hashToken(token) });
  if (error) throw new Error(`Gagal memeriksa sesi login: ${error.message}`);
  return isAppUserId(data) ? users[data] : null;
}

export async function getRequestUser(request: Request) {
  const token = readCookie(request.headers.get("cookie"));
  return token ? touchToken(token) : null;
}

export async function getCurrentUser() {
  const token = (await cookies()).get(sessionCookieName)?.value;
  return token ? touchToken(token) : null;
}

export async function requireCurrentUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) {
    const { redirect } = await import("next/navigation");
    return redirect("/login");
  }
  return user;
}

export async function revokeRequestSession(request: Request) {
  const token = readCookie(request.headers.get("cookie"));
  if (!token) return;
  const { error } = await db().rpc("delete_app_session", { p_token_hash: hashToken(token) });
  if (error) throw new Error(`Gagal mengakhiri sesi login: ${error.message}`);
}

export async function refreshRequestSession(request: Request) {
  const token = readCookie(request.headers.get("cookie"));
  if (!token) return null;
  const user = await touchToken(token);
  return user ? { token, user } : null;
}
