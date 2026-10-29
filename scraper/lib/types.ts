export type JobSource = "jobstreet" | "glints";
export type AppUserId = "taufik" | "alya";
export type DetailStatus = "pending" | "ok" | "failed" | "expired";
export type PostedAtSource = "exact" | "estimated" | "unknown";

export type SavedLink = {
  id: string;
  owner_id: AppUserId;
  url: string;
  source: JobSource;
  is_active: boolean;
};

export type JobLinkCandidate = {
  job_link: string;
  posted_at_hint: string | null;
};

export type JobDetails = {
  job_title: string;
  company_name: string | null;
  location: string | null;
  salary: string | null;
  employment_type: string | null;
  posted_at: string | null;
  posted_at_source: PostedAtSource;
  job_description: string | null;
};

export type PendingJob = {
  job_link: string;
  link_id: string;
  owner_id: AppUserId;
  source: JobSource;
  detail_attempts: number;
  posted_at_hint: string | null;
};
