import { requireCurrentUser } from "@/lib/auth";
import { CV_ANALYSIS_VERSION } from "@/lib/cv-matching";
import { db } from "@/lib/supabase";
import CvUploadPanel from "@/components/CvUploadPanel";

export const instant = false;

function isCurrentAiAnalysis(value: unknown): value is Record<string, unknown> {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && "method" in value
    && value.method === "ai"
    && "_analysisVersion" in value
    && value._analysisVersion === CV_ANALYSIS_VERSION;
}

export default async function CvPage() {
  const user = await requireCurrentUser();
  const { data, error } = await db()
    .from("cv_analyses")
    .select("analysis, analyzed_at")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`Gagal memuat hasil analisis CV: ${error.message}`);
  const savedAnalysis = isCurrentAiAnalysis(data?.analysis) ? data.analysis : null;

  return (
    <main className="main-content">
      <header className="page-title-row">
        <div>
          <p className="eyebrow">DOKUMEN PRIBADI</p>
          <h1>Upload CV</h1>
          <p>Simpan dan lihat CV PDF pribadi Anda.</p>
        </div>
      </header>
      <CvUploadPanel savedAnalysis={{
        analysis: savedAnalysis,
        analyzedAt: savedAnalysis ? data?.analyzed_at ?? null : null,
      }} />
    </main>
  );
}
