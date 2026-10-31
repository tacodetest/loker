export const JOBSTREET_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const RETRY_AT_MARKER = /\[retry-at:([^\]]+)\]/;

export class RateLimitedError extends Error {
  constructor(
    readonly status: number,
    readonly retryAt: Date | null,
    readonly collectedCount = 0,
  ) {
    super(`JobStreet membatasi permintaan (HTTP ${status}).`);
    this.name = "RateLimitedError";
  }
}

export function parseRetryAfter(
  value: string | null,
  now = new Date(),
): Date | null {
  if (!value?.trim()) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return new Date(now.getTime() + seconds * 1000);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function createRateLimitMessage(
  status: number,
  retryAt: Date | null,
  now = new Date(),
): string {
  const minimumRetryAt = new Date(now.getTime() + JOBSTREET_COOLDOWN_MS);
  const effectiveRetryAt = retryAt && retryAt > minimumRetryAt ? retryAt : minimumRetryAt;
  const estimate = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(effectiveRetryAt);
  return `JobStreet membatasi permintaan (HTTP ${status}). Scrape dihentikan dan data lama dipertahankan. Perkiraan coba lagi setelah ${estimate} WIB. [retry-at:${effectiveRetryAt.toISOString()}]`;
}

export function getRateLimitRetryAt(errorText: string | null | undefined): Date | null {
  const marker = errorText?.match(RETRY_AT_MARKER)?.[1];
  if (!marker) return null;
  const parsed = new Date(marker);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getJobStreetCooldownUntil(
  status: string | null | undefined,
  lastScrapedAt: string | null | undefined,
  errorText: string | null | undefined,
  now = new Date(),
): Date | null {
  if (status !== "dibatasi" || !lastScrapedAt) return null;
  const scrapedAt = new Date(lastScrapedAt);
  if (Number.isNaN(scrapedAt.getTime())) return null;
  const sixHourCooldown = new Date(scrapedAt.getTime() + JOBSTREET_COOLDOWN_MS);
  const retryAt = getRateLimitRetryAt(errorText);
  const cooldownUntil = retryAt && retryAt > sixHourCooldown ? retryAt : sixHourCooldown;
  return cooldownUntil > now ? cooldownUntil : null;
}

export function formatCooldownMessage(until: Date): string {
  const estimate = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(until);
  return `JobStreet sedang dalam jeda setelah pembatasan sebelumnya. Coba lagi setelah ${estimate} WIB.`;
}
