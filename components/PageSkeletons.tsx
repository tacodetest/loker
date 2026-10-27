type SkeletonBlockProps = {
  className: string;
};

function SkeletonBlock({ className }: SkeletonBlockProps) {
  return <span aria-hidden="true" className={`skeleton-block ${className}`} />;
}

function PageHeadingSkeleton({
  description = true,
  action = false,
}: {
  description?: boolean;
  action?: boolean;
}) {
  return (
    <header className="page-title-row">
      <div className="skeleton-heading">
        <SkeletonBlock className="skeleton-eyebrow" />
        <SkeletonBlock className="skeleton-title" />
        {description && <SkeletonBlock className="skeleton-description" />}
      </div>
      {action && <SkeletonBlock className="skeleton-back-action" />}
    </header>
  );
}

function JobCardSkeleton() {
  return (
    <li aria-hidden="true" className="job-card skeleton-job-card">
      <SkeletonBlock className="skeleton-age" />
      <div className="job-content skeleton-job-content">
        <SkeletonBlock className="skeleton-job-title" />
        <SkeletonBlock className="skeleton-job-meta" />
        <SkeletonBlock className="skeleton-job-salary" />
        <SkeletonBlock className="skeleton-job-date" />
      </div>
      <SkeletonBlock className="skeleton-action" />
    </li>
  );
}

export function DashboardSkeleton() {
  return (
    <main aria-busy="true" aria-label="Memuat ringkasan" className="main-content">
      <PageHeadingSkeleton />
      <section aria-hidden="true" className="stats-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="stat-card skeleton-stat" key={index}>
            <SkeletonBlock className="skeleton-stat-icon" />
            <div>
              <SkeletonBlock className="skeleton-stat-label" />
              <SkeletonBlock className="skeleton-stat-value" />
              <SkeletonBlock className="skeleton-stat-note" />
            </div>
          </div>
        ))}
      </section>
      <section aria-hidden="true" className="content-card overview-card">
        <div className="section-heading">
          <div className="skeleton-section-heading">
            <SkeletonBlock className="skeleton-section-title" />
            <SkeletonBlock className="skeleton-section-note" />
          </div>
          <SkeletonBlock className="skeleton-action" />
        </div>
        <ul className="job-list">
          {Array.from({ length: 3 }, (_, index) => <JobCardSkeleton key={index} />)}
        </ul>
      </section>
    </main>
  );
}

export function JobsSkeleton() {
  return (
    <main aria-busy="true" aria-label="Memuat daftar lowongan" className="main-content">
      <PageHeadingSkeleton />
      <section aria-hidden="true" className="content-card filters-card skeleton-filters">
        <SkeletonBlock className="skeleton-filter-search" />
        <div className="skeleton-filter-range">
          <SkeletonBlock className="skeleton-filter-label" />
          <SkeletonBlock className="skeleton-filter-select" />
        </div>
        <SkeletonBlock className="skeleton-filter-button" />
        <SkeletonBlock className="skeleton-filter-count" />
      </section>
      <ul aria-hidden="true" className="job-list skeleton-jobs-list">
        {Array.from({ length: 6 }, (_, index) => <JobCardSkeleton key={index} />)}
      </ul>
    </main>
  );
}

export function SourcesSkeleton() {
  return (
    <main aria-busy="true" aria-label="Memuat tautan sumber" className="main-content">
      <PageHeadingSkeleton />
      <section aria-hidden="true" className="sources-page-grid skeleton-sources">
        <div className="content-card upload-card">
          <div className="section-heading skeleton-source-heading">
            <div className="skeleton-section-heading">
              <SkeletonBlock className="skeleton-section-title" />
              <SkeletonBlock className="skeleton-section-note" />
            </div>
            <SkeletonBlock className="skeleton-step" />
          </div>
          <SkeletonBlock className="skeleton-field-label" />
          <SkeletonBlock className="skeleton-field" />
          <SkeletonBlock className="skeleton-filter-button" />
        </div>
        <div className="content-card source-table-card skeleton-source-list">
          <div className="section-heading skeleton-source-heading">
            <div className="skeleton-section-heading">
              <SkeletonBlock className="skeleton-section-title" />
              <SkeletonBlock className="skeleton-section-note" />
            </div>
          </div>
          {Array.from({ length: 4 }, (_, index) => (
            <div className="skeleton-source-row" key={index}>
              <SkeletonBlock className="skeleton-source-mark" />
              <div className="skeleton-source-details">
                <SkeletonBlock className="skeleton-source-title" />
                <SkeletonBlock className="skeleton-source-meta" />
                <SkeletonBlock className="skeleton-source-url" />
              </div>
              <div className="skeleton-source-actions">
                <SkeletonBlock className="skeleton-source-button" />
                <SkeletonBlock className="skeleton-source-button" />
                <SkeletonBlock className="skeleton-source-button" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export function JobDetailSkeleton() {
  return (
    <main aria-busy="true" aria-label="Memuat detail lowongan" className="main-content">
      <PageHeadingSkeleton description={false} action />
      <article aria-hidden="true" className="content-card job-detail-card skeleton-detail">
        <SkeletonBlock className="skeleton-job-meta" />
        <SkeletonBlock className="skeleton-detail-title" />
        <SkeletonBlock className="skeleton-detail-meta" />
        <SkeletonBlock className="skeleton-detail-salary" />
        <SkeletonBlock className="skeleton-detail-divider" />
        <SkeletonBlock className="skeleton-detail-heading" />
        <div className="skeleton-detail-copy">
          <SkeletonBlock className="skeleton-detail-line" />
          <SkeletonBlock className="skeleton-detail-line" />
          <SkeletonBlock className="skeleton-detail-line" />
          <SkeletonBlock className="skeleton-detail-line-short" />
        </div>
        <SkeletonBlock className="skeleton-filter-button" />
      </article>
    </main>
  );
}
