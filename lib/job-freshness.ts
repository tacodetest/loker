export function isPostedWithinWindow(
  postedTime: string | null,
  cutoff: Date,
  now: Date,
) {
  if (!postedTime) return false;
  const postedDate = new Date(postedTime);
  if (Number.isNaN(postedDate.getTime())) return false;
  return postedDate >= cutoff && postedDate <= now;
}

type DatedJob = {
  job_url: string;
  posted_time: string | null;
  posted_at?: string | null;
};

export function getUniqueRecentJobs<T extends DatedJob>(
  jobs: T[],
  now: Date,
  maxAgeDays: number,
) {
  const cutoff = new Date(now.getTime() - maxAgeDays * 86_400_000);
  const seenUrls = new Set<string>();

  return jobs.filter((job) => {
    if (seenUrls.has(job.job_url)) return false;
    if (!isPostedWithinWindow(job.posted_at ?? job.posted_time, cutoff, now)) return false;
    seenUrls.add(job.job_url);
    return true;
  });
}
