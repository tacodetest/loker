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

export function isAppUserId(value: unknown): value is AppUserId {
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

function verifyLegacyPassword(userId: AppUserId, password: string, expected: string) {
  const salt = `loker-login:${userId}:v1`;
  const submittedHash = scryptSync(password, salt, 64);
  const expectedHash = scryptSync(expected, salt, 64);
  return timingSafeEqual(submittedHash, expectedHash);
}

function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function verifyPasswordHash(password: string, encodedHash: string) {
  const [algorithm, saltText, hashText] = encodedHash.split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;

  const salt = Buffer.from(saltText, "base64url");
  const expectedHash = Buffer.from(hashText, "base64url");
  if (salt.length !== 16 || expectedHash.length !== 64) return false;

  const submittedHash = scryptSync(password, salt, expectedHash.length);
  return timingSafeEqual(submittedHash, expectedHash);
}

async function getStoredPasswordHash(userId: AppUserId) {
  const { data, error } = await db()
    .from("app_users")
    .select("password_hash")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Gagal membaca akun login: ${error.message}`);
  return data?.password_hash ?? null;
}

export async function verifyCredentials(username: string, password: string): Promise<AppUser | null> {
  const normalizedUsername = username.trim().toLocaleLowerCase("id-ID");
  if (!isAppUserId(normalizedUsername)) return null;

  const user = users[normalizedUsername];
  const storedPasswordHash = await getStoredPasswordHash(user.id);
  if (storedPasswordHash) {
    return verifyPasswordHash(password, storedPasswordHash) ? user : null;
  }

  const legacyPassword = getPassword(user.id);
  if (!verifyLegacyPassword(user.id, password, legacyPassword)) return null;

  const { error } = await db().from("app_users").insert({
    id: user.id,
    name: user.name,
    password_hash: hashPassword(password),
  });
  if (!error) return user;
  if (error.code !== "23505") throw new Error(`Gagal menyimpan akun login: ${error.message}`);

  const racedPasswordHash = await getStoredPasswordHash(user.id);
  return racedPasswordHash && verifyPasswordHash(password, racedPasswordHash) ? user : null;
}

export async function changePassword(userId: AppUserId, currentPassword: string, newPassword: string) {
  const currentPasswordHash = await getStoredPasswordHash(userId);
  if (!currentPasswordHash) throw new Error("Akun belum tersimpan di database. Keluar lalu masuk kembali untuk menyiapkannya.");
  if (!verifyPasswordHash(currentPassword, currentPasswordHash)) return false;

  const { data, error } = await db()
    .from("app_users")
    .update({ password_hash: hashPassword(newPassword), updated_at: new Date().toISOString() })
    .eq("id", userId)
    .eq("password_hash", currentPasswordHash)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Gagal mengganti password: ${error.message}`);
  return data !== null;
}

export async function createAppSession(userId: AppUserId) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);

  // Replace the previous session so a login on a new device always succeeds,
  // even if the old device could not revoke its stale database session.
  const { error: replaceError } = await db().from("app_sessions").delete().eq("user_id", userId);
  if (replaceError) throw new Error(`Gagal mengganti sesi lama: ${replaceError.message}`);

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
