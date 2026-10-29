import { requireCurrentUser } from "@/lib/auth";
import { db } from "@/lib/supabase";
import CvUploadPanel from "@/components/CvUploadPanel";

export const instant = false;

export default async function CvPage() {
  const user = await requireCurrentUser();
  const { data, error } = await db()
    .from("cv_analyses")
    .select("analysis, analyzed_at")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`Gagal memuat hasil analisis CV: ${error.message}`);

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
        analysis: data?.analysis ?? null,
        analyzedAt: data?.analyzed_at ?? null,
      }} />
    </main>
  );
}
