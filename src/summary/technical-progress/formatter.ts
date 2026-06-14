import { getLocale, t } from "../../i18n/index.js";
import type { TechnicalDetailsPublisher, TechnicalDetailsPublishRequest } from "../../telegraph/details-publisher.js";
import { classifyTechnicalProgress } from "./classify.js";
import { buildTechnicalDetails } from "./details.js";
import { buildProgressMetric } from "./metrics.js";
import { buildProgressTitle } from "./title.js";
import type {
  TechnicalProgressCategory,
  TechnicalProgressClassification,
  TechnicalProgressOutcome,
  TechnicalProgressToolInfo,
} from "./types.js";

export interface TechnicalProgressFormatResult {
  text: string;
  format?: "html";
}

type TodoStatus = "completed" | "in_progress" | "cancelled" | string;

interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

const categoryIcons: Record<TechnicalProgressCategory, string> = {
  file_read: "📄",
  file_write: "✍️",
  file_edit: "✍️",
  file_create: "✍️",
  file_delete: "🗑️",
  patch: "🧩",
  command: "💻",
  project_search: "🔎",
  web_search: "🔎",
  web_read: "🌐",
  reasoning: "🧠",
  skill: "🧠",
  subagent: "🤖",
  mcp: "🔌",
  todo: "📝",
  network: "🌐",
  package: "📦",
  build: "🏗️",
  test: "🧪",
  generic: "⚙️",
};

export function formatTechnicalProgressSync(
  toolInfo: TechnicalProgressToolInfo,
): TechnicalProgressFormatResult {
  const classification = classifyWithEmptyOutcome(toolInfo);

  if (classification.category === "todo") {
    const todos = extractTodos(toolInfo);
    if (todos.length > 0) {
      return { text: formatTodos(todos) };
    }
  }

  // Reasoning shows only emoji + title, no action text
  if (classification.category === "reasoning") {
    const title = buildProgressTitle(toolInfo);
    return { text: `💭 ${title}` };
  }

  const icon = categoryIcons[classification.category];
  const action = t(readDirectoryActionKey(toolInfo, classification) ?? actionKey(classification));
  const title = buildProgressTitle(toolInfo);
  const rawMetric = buildProgressMetric(toolInfo);
  const metric = localizeMetric(rawMetric);
  const visibleMetric = shouldShowMetric(classification, toolInfo, rawMetric) ? ` (${metric})` : "";

  return { text: `${icon} ${action} — ${title}${visibleMetric}` };
}

export async function formatTechnicalProgressWithDetails(
  toolInfo: TechnicalProgressToolInfo,
  publisher: TechnicalDetailsPublisher,
  locale?: string,
): Promise<TechnicalProgressFormatResult> {
  const base = formatTechnicalProgressSync(toolInfo);
  const details = buildTechnicalDetails(toolInfo);

  if (!details) {
    return base;
  }

  const publishRequest: TechnicalDetailsPublishRequest = {
    title: base.text.replace(/\n.*/s, ""),
    body: details.body,
  };
  if (locale !== undefined) {
    publishRequest.locale = locale;
  }
  const url = await publisher.publish(publishRequest);

  if (!url) {
    const escapedBase = escapeTelegramHtml(base.text);
    const escapedBody = escapeTelegramHtml(details.body);

    if (toolInfo.tool === "todowrite") {
      return { text: `${escapedBase}:\n${escapedBody}`, format: "html" };
    }

    // Truncate spoiler body so total message stays within Telegram-safe
    // limit (3800 chars).  This also ensures splitLongText never breaks
    // the blockquote tags open, which would cause Telegram to reject the
    // message and the ToolCallStreamer to drop all subsequent tool
    // notifications for the session.
    const spoilerLimit = 3800;
    const openTag = "<blockquote expandable>";
    const closeTag = "</blockquote>";
    const overhead = escapedBase.length + "\n\n".length + openTag.length + closeTag.length;
    const maxBodyLen = Math.max(0, spoilerLimit - overhead);
    const truncatedBody =
      escapedBody.length > maxBodyLen
        ? `${escapedBody.slice(0, maxBodyLen - 1)}…`
        : escapedBody;

    return {
      text: `${escapedBase}\n\n${openTag}${truncatedBody}${closeTag}`,
      format: "html",
    };
  }

  return {
    text: `<a href="${escapeTelegramHtml(url)}">${escapeTelegramHtml(base.text)}</a>`,
    format: "html",
  };
}

function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function classifyWithEmptyOutcome(
  toolInfo: TechnicalProgressToolInfo,
): TechnicalProgressClassification {
  const classification = classifyTechnicalProgress(toolInfo);

  if (
    classification.category === "project_search" &&
    toolInfo.state.status !== "pending" &&
    toolInfo.state.status !== "running" &&
    toolInfo.metadata?.resultCount === 0
  ) {
    return { ...classification, outcome: "empty" };
  }

  return classification;
}

function actionKey(classification: TechnicalProgressClassification): Parameters<typeof t>[0] {
  const suffix = outcomeSuffix(classification.outcome);

  if (classification.phase === "running") {
    return `technical_progress.${classification.category}.running` as Parameters<typeof t>[0];
  }

  return `technical_progress.${classification.category}.${suffix}` as Parameters<typeof t>[0];
}

function readDirectoryActionKey(
  toolInfo: TechnicalProgressToolInfo,
  classification: TechnicalProgressClassification,
): Parameters<typeof t>[0] | undefined {
  if (classification.category !== "file_read" || !isDirectoryRead(toolInfo)) {
    return undefined;
  }

  if (classification.phase === "running") {
    return "technical_progress.directory_read.running" as Parameters<typeof t>[0];
  }

  return `technical_progress.directory_read.${outcomeSuffix(classification.outcome)}` as Parameters<typeof t>[0];
}

function isDirectoryRead(toolInfo: TechnicalProgressToolInfo): boolean {
  const metadataOutput = toolInfo.metadata?.output;
  const toolOutput = (toolInfo as TechnicalProgressToolInfo & { output?: unknown }).output;
  const output = typeof metadataOutput === "string" ? metadataOutput : toolOutput;
  return typeof output === "string" && /<type>\s*directory\s*<\/type>/i.test(output);
}

function outcomeSuffix(outcome: TechnicalProgressOutcome): "success" | "failure" | "empty" {
  return outcome;
}

function shouldShowMetric(
  classification: TechnicalProgressClassification,
  toolInfo: TechnicalProgressToolInfo,
  metric: string,
): boolean {
  if (metric.length === 0) {
    return false;
  }

  if (classification.category === "project_search") {
    return classification.outcome !== "empty" && toolInfo.metadata?.resultCount !== 0;
  }

  return true;
}

function extractTodos(toolInfo: TechnicalProgressToolInfo): TodoItem[] {
  const todos = toolInfo.metadata?.todos;
  if (!Array.isArray(todos)) {
    return [];
  }

  return todos.filter(isTodoItem);
}

function isTodoItem(value: unknown): value is TodoItem {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "content" in value &&
    "status" in value &&
    typeof value.id === "string" &&
    typeof value.content === "string" &&
    typeof value.status === "string"
  );
}

function formatTodos(todos: TodoItem[]): string {
  if (todos.every((todo) => todo.status === "completed" || todo.status === "cancelled")) {
    return t("technical_progress.todo.all_done");
  }

  return t("technical_progress.todo.updated", {
    count: todos.length,
    unit: localizeCountUnit(todos.length, "item"),
  });
}

function localizeMetric(metric: string): string {
  const match = metric.match(/^(\d+) (lines?|results?|tasks?)$/);
  if (!match) {
    return metric;
  }

  const count = Number(match[1]);
  const unit = match[2];

  if (unit.startsWith("line")) {
    return `${count} ${localizeCountUnit(count, "line")}`;
  }

  if (unit.startsWith("result")) {
    return `${count} ${localizeCountUnit(count, "result")}`;
  }

  return `${count} ${localizeCountUnit(count, "task")}`;
}

function localizeCountUnit(count: number, unit: "line" | "result" | "task" | "item"): string {
  if (getLocale() === "ru") {
    return russianCountUnit(count, unit);
  }

  const suffix = count === 1 ? "one" : "other";
  return t(`technical_progress.unit.${unit}.${suffix}` as Parameters<typeof t>[0]);
}

function russianCountUnit(count: number, unit: "line" | "result" | "task" | "item"): string {
  const absoluteCount = Math.abs(count);
  const lastTwoDigits = absoluteCount % 100;
  const lastDigit = absoluteCount % 10;
  const form = lastTwoDigits >= 11 && lastTwoDigits <= 14 ? "many" : lastDigit === 1 ? "one" : lastDigit >= 2 && lastDigit <= 4 ? "few" : "many";

  return t(`technical_progress.unit.${unit}.${form}` as Parameters<typeof t>[0]);
}
