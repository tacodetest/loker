import type { JobSource } from "@/scraper/lib/types";

const domains = {
  jobstreet: [
    "jobstreet.com", "jobstreet.com.au", "jobstreet.com.hk", "jobstreet.com.my",
    "jobstreet.com.ph", "jobstreet.com.sg", "jobstreet.com.vn", "jobstreet.co.id",
    "jobstreet.co.th", "jobstreet.co.nz",
  ],
  glints: ["glints.com"],
} as const;

export function getSourceUrl(value: unknown): { url: URL; source: JobSource } | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    const hostname = url.hostname.toLowerCase();
    const source = (Object.entries(domains) as Array<[JobSource, readonly string[]]>)
      .find(([, allowed]) => allowed.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)))?.[0];
    if (!source) return null;
    url.hash = "";
    return { url, source };
  } catch {
    return null;
  }
}
