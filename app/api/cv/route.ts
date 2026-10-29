import { request as httpsRequest } from "node:https";
import { connection, NextResponse } from "next/server";
import { getRequestUser, type AppUserId } from "@/lib/auth";
import { db } from "@/lib/supabase";

const bucketName = "private-cv";
const maxFileSize = 10 * 1024 * 1024;
const signedUrlLifetimeSeconds = 600;
const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Terjadi kesalahan saat mengakses CV.";
}

async function uploadStoredCv(url: string, path: string, bytes: Buffer, serviceRoleKey: string) {
  const target = new URL(url);
  target.pathname = `${target.pathname.replace(/\/$/, "")}/storage/v1/object/${bucketName}/${path}`;
  return await new Promise<void>((resolve, reject) => {
    const req = httpsRequest(target, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/pdf",
        "cache-control": "0",
        "content-length": String(bytes.length),
        "x-upsert": "true",
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if ((response.statusCode ?? 500) >= 400) reject(new Error(body || `Storage mengembalikan HTTP ${response.statusCode}.`));
        else resolve();
      });
    });
    req.on("error", reject);
    req.end(bytes);
  });
}

async function removeStoredCv(objectPath: string) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Konfigurasi Supabase tidak lengkap.");

  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucketName}/${encodedPath}`, {
    method: "DELETE",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    cache: "no-store",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error((await response.text()) || `Storage mengembalikan HTTP ${response.status}.`);
  }
}

async function findCvPath(supabase: ReturnType<typeof db>, userId: AppUserId) {
  const { data: files, error } = await supabase.storage
    .from(bucketName)
    .list(userId, { limit: 10, search: "cv.pdf" });
  if (error) throw new Error(error.message);
  if (files?.some((file) => file.name === "cv.pdf")) return `${userId}/cv.pdf`;
  if (userId === "taufik") {
    const { data: legacyFiles, error: legacyError } = await supabase.storage
      .from(bucketName)
      .list("", { limit: 10, search: "cv.pdf" });
    if (legacyError) throw new Error(legacyError.message);
    if (legacyFiles?.some((file) => file.name === "cv.pdf")) return "cv.pdf";
  }
  return null;
}

async function createCvResponse(
  supabase: ReturnType<typeof db>,
  objectPath: string,
  size: number | null,
  updatedAt: string | null,
  status = 200,
) {
  const { data, error } = await supabase.storage
    .from(bucketName)
    .createSignedUrl(objectPath, signedUrlLifetimeSeconds);
  if (error) throw new Error(error.message);

  return NextResponse.json({
    cv: {
      name: "CV.pdf",
      size,
      updatedAt,
      url: data.signedUrl,
    },
  }, { status, ...noStore });
}

export async function GET(req: Request) {
  await connection();
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Sesi login berakhir." }, { status: 401, ...noStore });

  try {
    const supabase = db();
    const objectPath = await findCvPath(supabase, user.id);
    if (!objectPath) return NextResponse.json({ cv: null }, noStore);
    const { data: files, error } = await supabase.storage
      .from(bucketName)
      .list(user.id, { limit: 10, search: "cv.pdf" });
    if (error) throw new Error(error.message);

    const cv = objectPath === "cv.pdf"
      ? (await supabase.storage.from(bucketName).list("", { limit: 10, search: "cv.pdf" }))
        .data?.find((file) => file.name === objectPath)
      : files?.find((file) => file.name === "cv.pdf");
    if (!cv) throw new Error("Metadata CV tersimpan tidak ditemukan.");

    const size = typeof cv.metadata?.size === "number" ? cv.metadata.size : null;
    return await createCvResponse(supabase, objectPath, size, cv.updated_at ?? cv.created_at ?? null);
  } catch (error) {
    const message = errorMessage(error);
    console.error("[cv] Gagal memuat CV:", message);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Sesi login berakhir." }, { status: 401, ...noStore });

  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxFileSize + 128 * 1024) {
    return NextResponse.json({ error: "Ukuran CV maksimal 10 MiB." }, { status: 413, ...noStore });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Formulir upload tidak valid." }, { status: 400, ...noStore });
  }

  const file = formData.get("file");
  if (typeof file === "string" || !file) {
    return NextResponse.json({ error: "Pilih file CV berformat PDF." }, { status: 400, ...noStore });
  }
  const supportedMimeTypes = ["application/pdf", "application/octet-stream", "binary/octet-stream"];
  if (!file.name.toLowerCase().endsWith(".pdf") || (file.type && !supportedMimeTypes.includes(file.type))) {
    return NextResponse.json({ error: "File harus berformat PDF." }, { status: 400, ...noStore });
  }
  if (file.size === 0 || file.size > maxFileSize) {
    return NextResponse.json({ error: "Ukuran CV harus lebih dari 0 dan maksimal 10 MiB." }, { status: 400, ...noStore });
  }

  const signature = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
  if (signature !== "%PDF-") {
    return NextResponse.json({ error: "Isi file tidak terdeteksi sebagai dokumen PDF yang valid." }, { status: 400, ...noStore });
  }

  try {
    const supabase = db();
    const objectPath = `${user.id}/cv.pdf`;
    const fileBytes = await file.arrayBuffer();
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Konfigurasi Supabase tidak lengkap.");
    const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
    await uploadStoredCv(supabaseUrl, encodedPath, Buffer.from(fileBytes), serviceRoleKey);

    const { error: analysisError } = await supabase
      .from("cv_analyses")
      .delete()
      .eq("owner_id", user.id);
    if (analysisError) {
      throw new Error(`CV berhasil disimpan, tetapi analisis lama gagal dihapus: ${analysisError.message}`);
    }

    return await createCvResponse(supabase, objectPath, file.size, new Date().toISOString(), 201);
  } catch (error) {
    const message = errorMessage(error);
    console.error("[cv] Gagal menyimpan CV:", message);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}

export async function DELETE(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Sesi login berakhir." }, { status: 401, ...noStore });

  try {
    const supabase = db();
    const objectPath = await findCvPath(supabase, user.id);
    if (objectPath) {
      await removeStoredCv(objectPath);

      if (await findCvPath(supabase, user.id)) {
        throw new Error("File CV masih tersimpan dan gagal dihapus.");
      }
    }

    const { error: analysisError } = await supabase
      .from("cv_analyses")
      .delete()
      .eq("owner_id", user.id);
    if (analysisError) throw new Error(analysisError.message);

    return jsonResponse({ ok: true });
  } catch (error) {
    const message = errorMessage(error) || "Gagal menghapus CV.";
    console.error("[cv] Gagal menghapus CV:", message);
    return jsonResponse({ error: message }, 500);
  }
}
