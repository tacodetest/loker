import CvUploadPanel from "@/components/CvUploadPanel";

export default function CvPage() {
  return (
    <main className="main-content">
      <header className="page-title-row">
        <div>
          <p className="eyebrow">DOKUMEN PRIBADI</p>
          <h1>Upload CV</h1>
          <p>Simpan dan lihat CV PDF pribadi Anda.</p>
        </div>
      </header>
      <CvUploadPanel />
    </main>
  );
}
