import { NextResponse } from "next/server";
import { analyzeResume, CvAnalysisError, extractResumeText } from "@/lib/cv-matching";
import { getRecentJobsForMatching } from "@/lib/jobs";
import { getRequestUser } from "@/lib/auth";
import { db } from "@/lib/supabase";

export const maxDuration = 60;

const bucketName = "private-cv";
const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Analisis CV gagal diproses.";
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
          const jobs = await getRecentJobsForMatching(user.id);
          if (!jobs.length) {
            return NextResponse.json({ error: "Belum ada lowongan JobStreet aktif dalam 7 hari terakhir." }, { status: 404, ...noStore });
          }
          const resumeText = await extractResumeText(new Uint8Array(await legacyFile.arrayBuffer()));
          const result = await analyzeResume(resumeText, jobs);
          return NextResponse.json(result, noStore);
        }
      }
      if (downloadError.message.toLowerCase().includes("not found")) {
        return NextResponse.json({ error: "Upload CV terlebih dahulu sebelum menjalankan analisis." }, { status: 404, ...noStore });
      }
      throw new Error(downloadError.message);
    }

    const jobs = await getRecentJobsForMatching(user.id);
    if (!jobs.length) {
      return NextResponse.json({ error: "Belum ada lowongan JobStreet aktif dalam 7 hari terakhir." }, { status: 404, ...noStore });
    }

    const resumeText = await extractResumeText(new Uint8Array(await file.arrayBuffer()));
    const result = await analyzeResume(resumeText, jobs);
    return NextResponse.json(result, noStore);
  } catch (error) {
    const message = errorMessage(error);
    console.error("[cv] Gagal menganalisis CV:", message);
    const status = error instanceof CvAnalysisError ? error.status : 500;
    return NextResponse.json({ error: message }, { status, ...noStore });
  }
}
