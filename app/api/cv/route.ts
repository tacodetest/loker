import { connection, NextResponse } from "next/server";
import { getRequestUser, type AppUserId } from "@/lib/auth";
import { db } from "@/lib/supabase";

const bucketName = "private-cv";
const maxFileSize = 10 * 1024 * 1024;
const signedUrlLifetimeSeconds = 600;
const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Terjadi kesalahan saat mengakses CV.";
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
  if (!file.name.toLowerCase().endsWith(".pdf") || (file.type && file.type !== "application/pdf")) {
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
    const { error } = await supabase.storage
      .from(bucketName)
      .upload(objectPath, file, {
        cacheControl: "0",
        contentType: "application/pdf",
        upsert: true,
      });
    if (error) throw new Error(error.message);

    return await createCvResponse(supabase, objectPath, file.size, new Date().toISOString(), 201);
  } catch (error) {
    const message = errorMessage(error);
    console.error("[cv] Gagal menyimpan CV:", message);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}
