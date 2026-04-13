import type { ToolMessageBatcher } from "../../summary/tool-message-batcher.js";
import { t } from "../../i18n/index.js";
import { escapeHtml } from "./reasoning-format.js";
import type { TelegramTextFormat } from "./telegram-text.js";
import { formatReasoningBlock } from "./reasoning-format.js";

interface ThinkingMessageOptions {
  hideThinkingMessages: boolean;
  message?: string;
}

type ThinkingBatcher = Pick<ToolMessageBatcher, "enqueue" | "sendTextNow">;

function formatThinkingMessage(message: string): { text: string; format: TelegramTextFormat } {
  return {
    text: `<blockquote><b>${escapeHtml(message)}</b></blockquote>`,
    format: "html",
  };
}

export function buildThinkingMessageHtml(title: string, reasoningText: string): string {
  const renderedReasoning = formatReasoningBlock(reasoningText);
  if (!renderedReasoning) {
    return `<blockquote><b>${escapeHtml(title)}</b></blockquote>`;
  }

  return `<blockquote><b>${escapeHtml(title)}</b></blockquote>\n\n<blockquote expandable>${renderedReasoning}</blockquote>`;
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
  const formatted = formatThinkingMessage(message);
  batcher.sendTextNow(sessionId, formatted.text, "thinking_started", formatted.format);
}
