const MIN = 60000, HOUR = 3600000, DAY = 86400000;

// "3 hari yang lalu", "2d ago", "kemarin", "baru saja" -> Date perkiraan
export function parsePostedAt(text?: string | null, now = new Date()): Date | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/baru saja|just now|just posted|hari ini|today/.test(t)) return now;
  if (/kemarin|yesterday/.test(t)) return new Date(now.getTime() - DAY);
  const approximateDays = t.match(
    /(?:more than|over)\s+(\d+|one|two|three|four|five|six|seven)\s+days?\s+ago/,
  );
  if (approximateDays) {
    const numberWords: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
    };
    const value = Number(approximateDays[1]) || numberWords[approximateDays[1]];
    return new Date(now.getTime() - (value + 0.5) * DAY);
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
