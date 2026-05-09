import type { TechnicalProgressToolInfo } from "./types.js";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function lineCount(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length;
}

function statusText(statusCode: number): string {
  if (statusCode >= 200 && statusCode < 300) {
    return `${statusCode} OK`;
  }
  return String(statusCode);
}

export function buildProgressMetric(toolInfo: Pick<TechnicalProgressToolInfo, "tool" | "input" | "metadata">): string {
  const metadata = toolInfo.metadata ?? {};

  if (typeof metadata.output === "string") {
    const summary = metadata.output.match(/\d+ failed, \d+ passed/)?.[0] ?? metadata.output.match(/\d+ passed/)?.[0];
    if (summary) return summary;
  }

  if (typeof metadata.statusCode === "number") {
    return statusText(metadata.statusCode);
  }

  if (typeof metadata.lines === "number") {
    return plural(metadata.lines, "line", "lines");
  }

  const filediff = metadata.filediff as { additions?: unknown; deletions?: unknown } | undefined;
  if (filediff && (filediff.additions || filediff.deletions)) {
    if (
      (filediff.additions !== undefined && typeof filediff.additions !== "number") ||
      (filediff.deletions !== undefined && typeof filediff.deletions !== "number")
    ) {
      return "";
    }
    const additions = filediff.additions ?? 0;
    const deletions = filediff.deletions ?? 0;
    return `+${additions} −${deletions}`;
  }

  if (typeof metadata.resultCount === "number") {
    return plural(metadata.resultCount, "result", "results");
  }

  if (typeof metadata.taskCount === "number") {
    return plural(metadata.taskCount, "task", "tasks");
  }

  const todos = metadata.todos as unknown[] | undefined;
  if (Array.isArray(todos)) {
    return plural(todos.length, "task", "tasks");
  }

  if (toolInfo.input && typeof toolInfo.input.content === "string") {
    return plural(lineCount(toolInfo.input.content), "line", "lines");
  }

  return "";
}
