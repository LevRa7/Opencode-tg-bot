import { t, getLocale } from "../i18n/index.js";
import type { FileChange } from "./types.js";

export const DEFAULT_CONTEXT_LIMIT = 200000;

export function formatTokenCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }

  if (count >= 1000) {
    return `${Math.round(count / 1000)}K`;
  }

  return count.toString();
}

export function formatModelDisplayName(
  providerID?: string | null,
  modelID?: string | null,
): string {
  if (providerID && modelID) {
    return `${providerID}/${modelID}`;
  }

  return t("pinned.unknown");
}

export function formatContextLine(tokensUsed: number, tokensLimit?: number | null): string {
  const safeLimit = typeof tokensLimit === "number" && tokensLimit > 0 ? tokensLimit : null;
  const percentage = safeLimit ? Math.round((tokensUsed / safeLimit) * 100) : 0;

  return t("pinned.line.context", {
    used: formatTokenCount(tokensUsed),
    limit: safeLimit ? formatTokenCount(safeLimit) : t("pinned.unknown"),
    percent: percentage,
  });
}

export function formatCostLine(cost: number): string {
  return t("pinned.line.cost", { cost: `$${cost.toFixed(2)}` });
}

/**
 * Formats the line range for a read operation: "(7 — 122)".
 * Falls back to line count "(122 lines)" when no offset is known.
 */
export function formatLineRange(change: FileChange): string {
  if (change.readOffset && change.readLimit) {
    return `(${change.readOffset} — ${change.readLimit})`;
  }
  // Fallback: total additions = lines read
  const count = change.additions || change.deletions || 0;
  if (count === 0) return "";
  const unit = getLocale() === "ru" ? russianLines(count) : count === 1 ? "line" : "lines";
  return `(${count} ${unit})`;
}

/**
 * Formats the diff stats for an edit/write/patch: "(+7 −2)".
 */
export function formatDiffStats(change: FileChange): string {
  const parts: string[] = [];
  if (change.additions > 0) parts.push(`+${change.additions}`);
  if (change.deletions > 0) parts.push(`−${change.deletions}`);
  return parts.length > 0 ? `(${parts.join(" ")})` : "";
}

function russianLines(count: number): string {
  const n = Math.abs(count);
  const last2 = n % 100;
  const last1 = n % 10;
  if (last2 >= 11 && last2 <= 14) return "строк";
  if (last1 === 1) return "строка";
  if (last1 >= 2 && last1 <= 4) return "строки";
  return "строк";
}
