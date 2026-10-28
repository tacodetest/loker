import { NextResponse } from "next/server";
import { analyzeResume, CvAnalysisError, extractResumeText } from "@/lib/cv-matching";
import { getRecentJobsForMatching } from "@/lib/jobs";
import { getRequestUser } from "@/lib/auth";
import { db } from "@/lib/supabase";
import type { AppUserId } from "@/lib/auth";

export const maxDuration = 60;

const bucketName = "private-cv";
const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Analisis CV gagal diproses.";
}

async function analyzeAndSave(userId: AppUserId, file: Blob) {
  const jobs = await getRecentJobsForMatching(userId);
  if (!jobs.length) {
    return NextResponse.json({ error: "Belum ada lowongan JobStreet aktif dalam 7 hari terakhir." }, { status: 404, ...noStore });
  }

  const resumeText = await extractResumeText(new Uint8Array(await file.arrayBuffer()));
  const analysis = await analyzeResume(resumeText, jobs);
  const analyzedAt = new Date().toISOString();
  const { error } = await db().from("cv_analyses").upsert({
    owner_id: userId,
    analysis,
    analyzed_at: analyzedAt,
  }, { onConflict: "owner_id" });
  if (error) throw new Error(`Analisis berhasil, tetapi hasilnya gagal disimpan: ${error.message}`);

  return NextResponse.json({ analysis, analyzedAt }, noStore);
}

export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Sesi login berakhir." }, { status: 401, ...noStore });

  try {
    const { data, error } = await db()
      .from("cv_analyses")
      .select("analysis, analyzed_at")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return NextResponse.json({
      analysis: data?.analysis ?? null,
      analyzedAt: data?.analyzed_at ?? null,
    }, noStore);
  } catch (error) {
    const message = errorMessage(error);
    console.error("[cv] Gagal memuat hasil analisis:", message);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Sesi login berakhir." }, { status: 401, ...noStore });
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY belum diatur di environment server." }, { status: 503, ...noStore });
  }

  try {
    const supabase = db();
    const objectPath = `${user.id}/cv.pdf`;
    const { data: file, error: downloadError } = await supabase.storage
      .from(bucketName)
      .download(objectPath);
    if (downloadError) {
      if (user.id === "taufik" && downloadError.message.toLowerCase().includes("not found")) {
        const { data: legacyFile, error: legacyError } = await supabase.storage.from(bucketName).download("cv.pdf");
        if (legacyError && !legacyError.message.toLowerCase().includes("not found")) {
          throw new Error(legacyError.message);
        }
        if (legacyFile) {
          return await analyzeAndSave(user.id, legacyFile);
        }
      }
      if (downloadError.message.toLowerCase().includes("not found")) {
        return NextResponse.json({ error: "Upload CV terlebih dahulu sebelum menjalankan analisis." }, { status: 404, ...noStore });
      }
      throw new Error(downloadError.message);
    }

    return await analyzeAndSave(user.id, file);
  } catch (error) {
    const message = errorMessage(error);
    console.error("[cv] Gagal menganalisis CV:", message);
    const status = error instanceof CvAnalysisError ? error.status : 500;
    return NextResponse.json({ error: message }, { status, ...noStore });
  }
}
