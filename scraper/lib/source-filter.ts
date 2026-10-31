import type { JobSource, SavedLink } from "./types";
import { sourceFromUrl } from "./utils";

export type ScrapeSourceSelection = "all" | JobSource;

export function parseScrapeSource(value: string | null | undefined): ScrapeSourceSelection {
  const selection = value?.trim().toLowerCase() || "all";
  if (selection === "all" || selection === "glints" || selection === "jobstreet") return selection;
  throw new Error("SCRAPE_SOURCE harus bernilai all, glints, atau jobstreet.");
}

export function filterLinksBySource<T extends Pick<SavedLink, "source">>(
  links: T[],
  selection: ScrapeSourceSelection,
): T[] {
  return selection === "all" ? links : links.filter((link) => link.source === selection);
}

export function resolveWorkflowSources(
  eventName: string,
  requestedSource: string | null | undefined,
  sourceUrl: string | null | undefined,
): JobSource[] {
  if (eventName === "schedule") return ["glints", "jobstreet"];
  if (sourceUrl?.trim()) {
    const source = sourceFromUrl(sourceUrl.trim());
    if (!source) throw new Error("URL sumber bukan berasal dari JobStreet atau Glints.");
    return [source];
  }
  const selection = parseScrapeSource(requestedSource);
  return selection === "all" ? ["glints", "jobstreet"] : [selection];
}
