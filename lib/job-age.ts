import { parsePostedTime } from "./posted";

const jakartaDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function calendarDay(value: Date) {
  const parts = jakartaDate.formatToParts(value);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return Date.UTC(year, month - 1, day);
}

export function getPostedAge(postedTime: string | null, scrapedAt: string) {
  const parsedDate = parsePostedTime(postedTime, scrapedAt);
  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return { label: postedTime?.trim() || "Hari tidak diketahui", className: "job-age job-age-unknown" };
  }

  const days = Math.max(0, Math.floor((calendarDay(new Date()) - calendarDay(parsedDate)) / 86_400_000));
  if (days === 0) {
    return { label: postedTime?.trim() || "Hari ini", className: "job-age job-age-fresh" };
  }

  return {
    label: postedTime?.trim() || `${days} hari lalu`,
    className: days <= 3 ? "job-age job-age-fresh" : "job-age",
  };
}
