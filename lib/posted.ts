const MIN = 60000, HOUR = 3600000, DAY = 86400000;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
};

export function parseOlderThanDays(text?: string | null) {
  if (!text) return null;
  const approximateDays = text.toLowerCase().match(
    /(?:more than|over|lebih dari)\s+(\d+|one|two|three|four|five|six|seven)\s+days?(?:\s+yang)?\s+ago|(?:lebih dari)\s+(\d+)\s+hari(?:\s+yang)?\s+lalu/,
  );
  if (!approximateDays) return null;
  const value = approximateDays[1] ?? approximateDays[2];
  return Number(value) || NUMBER_WORDS[value] || null;
}

// "3 hari yang lalu", "2d ago", "kemarin", "baru saja" -> Date perkiraan
export function parsePostedAt(text?: string | null, now = new Date()): Date | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/baru saja|just now|just posted|hari ini|today/.test(t)) return now;
  if (/kemarin|yesterday/.test(t)) return new Date(now.getTime() - DAY);
  const olderThanDays = parseOlderThanDays(t);
  if (olderThanDays) {
    return new Date(now.getTime() - (olderThanDays + 0.5) * DAY);
  }
  const m = t.match(/(\d+)\s*\+?\s*([a-z]+)/);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2];
  const unit = /^(minggu|weeks?|w$)/.test(u) ? 7 * DAY
    : /^(bulan|months?|mo$)/.test(u) ? 30 * DAY
    : /^(menit|minutes?|mins?|m$)/.test(u) ? MIN
    : /^(jam|hours?|hrs?|h$)/.test(u) ? HOUR
    : /^(hari|days?|d$)/.test(u) ? DAY
    : 0;
  return unit ? new Date(now.getTime() - n * unit) : null;
}
