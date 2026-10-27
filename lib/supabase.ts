import "server-only";
import { createClient } from "@supabase/supabase-js";

export function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diisi");
  return createClient(url, key, { auth: { persistSession: false } });
}

export function isAdmin(req: Request) {
  const key = process.env.ADMIN_KEY;
  return !!key && req.headers.get("x-admin-key") === key;
}
