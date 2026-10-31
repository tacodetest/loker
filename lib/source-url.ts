export function getSourceUrl(value: unknown): { url: URL; source: "glints" } | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    const hostname = url.hostname.toLowerCase();
    if (hostname !== "glints.com" && !hostname.endsWith(".glints.com")) return null;
    url.hash = "";
    return { url, source: "glints" };
  } catch {
    return null;
  }
}
