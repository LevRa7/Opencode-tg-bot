import type { ToolMessageBatcher } from "../../summary/tool-message-batcher.js";
import { t } from "../../i18n/index.js";
import { escapeHtml, formatReasoningBlock } from "./reasoning-format.js";
import type { TelegramTextFormat } from "./telegram-text.js";

interface ThinkingMessageOptions {
  hideThinkingMessages: boolean;
  message?: string;
}

type ThinkingBatcher = Pick<ToolMessageBatcher, "enqueue" | "sendTextNow">;

export function buildThinkingMessageHtml(title: string, reasoningText: string): string {
  const renderedReasoning = formatReasoningBlock(reasoningText);
  if (!renderedReasoning) {
    return `<b>${escapeHtml(title)}</b>`;
  }

  return `<b>${escapeHtml(title)}</b>\n\n<blockquote expandable>${renderedReasoning}</blockquote>`;
}

/**
 * Format a thinking message with optional reasoning content.
 * The reasoning is rendered as an expandable quote block inside the thinking message.
 * When reasoningText is empty, returns only the title.
 */
export function formatThinkingMessageWithReasoning(
  title: string,
  reasoningText: string,
): { text: string; format: TelegramTextFormat } {
  const html = buildThinkingMessageHtml(title, reasoningText);
  return { text: html, format: "html" };
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
