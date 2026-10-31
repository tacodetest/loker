import { ENABLED_SOURCES } from "../config";
import type { JobSource } from "./types";

export function isSourceEnabled(source: JobSource): boolean {
  return ENABLED_SOURCES.includes(source);
}

export function getUnsupportedSourceMessage(source: JobSource): string | null {
  return isSourceEnabled(source) ? null : "Saat ini hanya Glints yang didukung.";
}
