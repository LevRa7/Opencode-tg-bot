import type { ToolMessageBatcher } from "../../summary/tool-message-batcher.js";
import { t } from "../../i18n/index.js";
import {
  formatTechnicalProgressSync,
  formatTechnicalProgressWithDetails,
} from "../../summary/technical-progress/formatter.js";
import type { TechnicalProgressToolInfo } from "../../summary/technical-progress/types.js";
import type { TechnicalDetailsPublisher } from "../../telegraph/details-publisher.js";
import type { TelegramTextFormat } from "./telegram-text.js";

interface ThinkingMessageOptions {
  hideThinkingMessages: boolean;
  message?: string;
}

type ThinkingBatcher = Pick<ToolMessageBatcher, "enqueue" | "sendTextNow">;

const SYNTHETIC_THINKING_PLACEHOLDERS = new Set([
  "bot.thinking",
  "thinking...",
  "думаю...",
  "pensando...",
  "denke...",
  "réflexion en cours...",
  "思考中...",
]);

function normalizeThinkingLine(line: string): string {
  return line
    .trim()
    .replace(/^(?:💭\s*)+/, "")
    .trim()
    .toLowerCase();
}

function isSyntheticThinkingPlaceholderLine(line: string): boolean {
  return SYNTHETIC_THINKING_PLACEHOLDERS.has(normalizeThinkingLine(line));
}

export function getVisibleReasoningText(reasoningText?: string): string | undefined {
  const visibleLines = (reasoningText ?? "")
    .split(/\r?\n/)
    .filter((line) => !isSyntheticThinkingPlaceholderLine(line));
  const visibleText = visibleLines.join("\n").trim();

  return visibleText || undefined;
}

/**
 * Extracts a clean title from the reasoning text.
 * Strips ordered-list markers (e.g. "1. ", "2) "), takes the first line
 * only (never bleeds into sub-lists), extracts the first sentence if
 * punctuation is present, and removes trailing colons / semicolons.
 */
export function extractReasoningTitle(reasoningText: string): string {
  const stripped = reasoningText.trimStart().replace(/^\s*\d+[.)]\s+/u, "");
  const firstLine = stripped.split(/\r?\n/)[0]?.trim() || "";
  if (!firstLine) return t("bot.thinking");

  const firstSentence = firstLine.match(/^[^.!?]*[.!?]/)?.[0]?.trim();
  const raw = firstSentence || firstLine;

  const cleaned = raw.replace(/\s*[;:]\s*$/, "");
  if (cleaned) return cleaned;
  return t("bot.thinking");
}

function buildReasoningToolInfo(
  title: string,
  reasoningText: string,
  status: "running" | "completed",
): TechnicalProgressToolInfo {
  return {
    sessionId: "thinking",
    messageId: "thinking",
    callId: "thinking",
    tool: "reasoning",
    title,
    state: { status },
    metadata: reasoningText.trim() ? { reasoningText } : undefined,
  } as TechnicalProgressToolInfo;
}

export function buildThinkingMessageHtml(title: string, reasoningText: string): string {
  return formatTechnicalProgressSync(buildReasoningToolInfo(title, reasoningText, "running")).text;
}

export function formatThinkingMessageWithReasoning(
  title: string,
  reasoningText: string,
): { text: string; format?: TelegramTextFormat } {
  return formatTechnicalProgressSync(buildReasoningToolInfo(title, reasoningText, "running"));
}

export function formatThinkingCompletionMessage(
  title: string,
  reasoningText: string,
): { text: string; format?: TelegramTextFormat } {
  return formatTechnicalProgressSync(buildReasoningToolInfo(title, reasoningText, "completed"));
}

export async function formatThinkingCompletionWithDetails(
  title: string,
  reasoningText: string,
  publisher: TechnicalDetailsPublisher,
): Promise<{ text: string; format?: TelegramTextFormat }> {
  return await formatTechnicalProgressWithDetails(
    buildReasoningToolInfo(title, reasoningText, "completed"),
    publisher,
  );
}

export function deliverThinkingMessage(
  sessionId: string,
  batcher: ThinkingBatcher,
  options: ThinkingMessageOptions,
): void {
  if (options.hideThinkingMessages) {
    return;
  }

  const message = options.message ?? t("bot.thinking");
  const formatted = formatThinkingMessageWithReasoning(message, "");
  batcher.sendTextNow(sessionId, formatted.text, "thinking_started", formatted.format);
}
