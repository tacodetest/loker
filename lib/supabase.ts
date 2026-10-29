import "server-only";
import { request as httpsRequest } from "node:https";
import { createClient } from "@supabase/supabase-js";

async function directFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const requestInput = input instanceof Request ? input : null;
  const url = new URL(requestInput?.url ?? String(input));
  const method = init?.method ?? requestInput?.method ?? "GET";
  const headers = new Headers(init?.headers ?? requestInput?.headers);
  const rawBody = init?.body ?? (requestInput && method !== "GET" && method !== "HEAD" ? requestInput.body : undefined);
  let body: string | Buffer | undefined;
  if (typeof rawBody === "string" || Buffer.isBuffer(rawBody)) {
    body = rawBody;
  } else if (rawBody instanceof Blob) {
    body = Buffer.from(await rawBody.arrayBuffer());
  } else if (rawBody instanceof URLSearchParams) {
    body = rawBody.toString();
  } else if (rawBody instanceof ArrayBuffer) {
    body = Buffer.from(rawBody);
  } else if (ArrayBuffer.isView(rawBody)) {
    body = Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  }

  return new Promise((resolve, reject) => {
    if (body && !headers.has("content-length") && url.pathname.includes("/storage/v1/object/")) {
      headers.set("content-length", String(Buffer.byteLength(body)));
    }
    const req = httpsRequest(url, { method, headers: Object.fromEntries(headers.entries()) }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on("end", () => {
        const status = res.statusCode ?? 500;
        const payload = [204, 205, 304].includes(status) ? null : Buffer.concat(chunks);
        resolve(new Response(payload, {
          status,
          statusText: res.statusMessage,
          headers: Object.fromEntries(Object.entries(res.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value!])),
        }));
      });
    });
    req.on("error", reject);
    req.end(typeof body === "string" || Buffer.isBuffer(body) ? body : undefined);
  });
}

export function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diisi");
  return createClient(url, key, {
    auth: { persistSession: false },
    global: {
      fetch: async (input, init) => {
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            return await directFetch(input, init);
          } catch (error) {
            lastError = error;
            if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
          }
        }
        throw lastError;
      },
    },
  });
}
