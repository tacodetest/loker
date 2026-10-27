export default function Loading() {
  return (
    <main aria-label="Memuat lowongan" className="mx-auto max-w-6xl space-y-8 px-5 py-10">
      <div className="space-y-3">
        <div className="h-4 w-36 animate-pulse rounded bg-slate-200" />
        <div className="h-10 w-2/3 animate-pulse rounded bg-slate-200" />
        <div className="h-5 w-1/2 animate-pulse rounded bg-slate-200" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5" key={index}>
            <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
            <div className="h-6 w-3/4 animate-pulse rounded bg-slate-200" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200" />
          </div>
        ))}
      </div>
    </main>
  );
}
